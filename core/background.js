importScripts('Storage.js', 'kaApiNormalize.js', 'bridge-sw.js');

// ------------------------------------------------------------------
// FELSENFEST: Tracker-Blocker (2026-09-09)
// DNR-Regelsatz ruleset_1 (49 Regeln, AdTech/Telemetrie-Domains inkl.
// KAs eigenem sgtm-legacy) ist UNBEDINGT aktiv. Kein Schalter:
// manifest "enabled": true, hier bedingungslose Aktivierung, Popup/
// InPageMenu-Eintraege entfernt. Nur Deinstallation beendet das Blocking.
// ------------------------------------------------------------------
chrome.declarativeNetRequest
    .updateEnabledRulesets({ enableRulesetIds: ['ruleset_1'] })
    .then(() => console.log('[KA Background] Tracker-Blocker FEST aktiviert (49 Regeln)'))
    .catch((e) => console.error('[KA Background] Ruleset-Aktivierung fehlgeschlagen:', e));

// ------------------------------------------------------------------
// SidePanel als Zentrale (2026-09-09, P1-Roadmap): Toolbar-Button öffnet
// das Panel (Popup entfällt), Panel fix auf der RECHTEN Seite. Guarded:
// setOptions 'side' braucht neuere Chrome-Versionen (>=131); bei Fehlern
// default-seite bleibt einfach links/rechts nach Browser-Sitte.
// ------------------------------------------------------------------
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => console.log('[KA Background] SidePanel: Toolbar-Button oeffnet Panel'))
    .catch((e) => console.error('[KA Background] SidePanel-Behavior fehlgeschlagen:', e));
try {
    chrome.sidePanel
        .setOptions({ side: 'right' })
        .then(() => console.log('[KA Background] SidePanel: Seite RECHTS fixiert'))
        .catch((e) => console.warn('[KA Background] SidePanel side=right nicht unterstuetzt:', e.message));
} catch (e) {
    console.warn('[KA Background] SidePanel-API nicht verfuegbar:', e.message);
}

// ------------------------------------------------------------------
// Mobile-API-Client (2026-09-09, Discovery siehe docs/kleinanzeigen-api.md)
// Die Android-App-API (api.kleinanzeigen.de/api) braucht keine Session --
// statische App-Credentials reichen. Der Service-Worker fetcht CORS-frei
// (host_permissions: api.kleinanzeigen.de), Content-Scripts duerfen es
// nicht -> deshalb Message-Bridge.
//
// Rate-Limit-Disziplin (nach der mydealz-Methodik):
//   - serielle Queue, randomisierte Hoeflichkeitspause zwischen Requests
//   - Retry/Backoff NUR transient (408/429/5xx/Netzwerk), 403/404 sofort aufgeben
//   - Retry-After-Header schlaegt Eigen-Backoff
//   - Obergrenze: 80 Requests / 10 Minuten (Sliding-Counter) gegen Runaway
//   - Response-Typ geprueft: HTML statt JSON gilt als erkannter Fehler
// ------------------------------------------------------------------
const KA_API_BASE = 'https://api.kleinanzeigen.de/api';
const KA_API_BASIC_AUTH = 'Basic YW5kcm9pZDpUYVI2MHBFdHRZ'; // Android-App-Credentials (oeffentlich dokumentiert, siehe Doku)
const KA_API_UA = 'okhttp/4.10.0';
const KA_API_MAX_PER_WINDOW = 80;
const KA_API_WINDOW_MS = 10 * 60 * 1000;

const kaApiState = {
    queue: Promise.resolve(),
    lastRequestAt: 0,
    windowStart: Date.now(),
    windowCount: 0,
};

function kaApiDelay() {
    // 500-1000ms zwischen API-Requests (die App aehnliches Tempo, unten
    // an gepflegten Suchmashines angelehnt; groszuegig gegen Drossel)
    return new Promise(r => setTimeout(r, 500 + Math.random() * 500));
}

async function kaApiRaw(path, params) {
    // Window-Cap
    const now = Date.now();
    if (now - kaApiState.windowStart > KA_API_WINDOW_MS) {
        kaApiState.windowStart = now;
        kaApiState.windowCount = 0;
    }
    if (kaApiState.windowCount >= KA_API_MAX_PER_WINDOW) {
        throw new Error(`KA-API Request-Cap erreicht (${KA_API_MAX_PER_WINDOW}/${KA_API_WINDOW_MS / 60000}min)`);
    }

    // Hoeflichkeitspause: seit dem letzten Request mindestens kaApiDelay()
    const sinceLast = Date.now() - kaApiState.lastRequestAt;
    const minGap = 500 + Math.random() * 500;
    if (sinceLast < minGap) await new Promise(r => setTimeout(r, minGap - sinceLast));

    const url = new URL(KA_API_BASE + path);
    for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    // HANG-SCHUTZ (2026-09-09, Live-Debug): fetch ohne Timeout kann bei
    // Verbindungsproblemen ewig haengen und die SERIELLE QUEUE fuer alle
    // nachfolgenden Calls blockieren (beobachtet: Message-Timeout, keine
    // Response mehr). Abort nach 15s -> transient-fehler mit Retry.
    const aborter = new AbortController();
    const abortTimer = setTimeout(() => aborter.abort(), 15000);

    let res;
    try {
        res = await fetch(url.toString(), {
            headers: {
                'Authorization': KA_API_BASIC_AUTH,
                'User-Agent': KA_API_UA,
                'Accept': 'application/json',
            },
            signal: aborter.signal,
        });
    } catch (e) {
        clearTimeout(abortTimer);
        const err = new Error('KA-API Netzwerkfehler/Timeout (15s Abort): ' + e.message);
        err.transient = true;
        throw err;
    }
    clearTimeout(abortTimer);
    kaApiState.lastRequestAt = Date.now();
    kaApiState.windowCount++;

    // 200 + HTML-Erkennung (Portal-Drossel-Muster aus der Methodik)
    const text = await res.text();
    if (res.ok && text.trim().startsWith('<')) {
        const err = new Error('KA-API lieferte HTML statt JSON (Drosselung?)');
        err.transient = true;
        throw err;
    }
    if (res.status === 408 || res.status === 429 || res.status >= 500) {
        const err = new Error(`KA-API transient ${res.status}`);
        err.transient = true;
        err.retryAfterMs = res.headers.get('Retry-After') ? Number(res.headers.get('Retry-After')) * 1000 : null;
        throw err;
    }
    if (res.status === 403 || res.status === 404) {
        const err = new Error(`KA-API ${res.status} (endgueltig, kein Retry)`);
        err.fatal = true;
        err.status = res.status;
        throw err;
    }
    if (!res.ok) {
        const err = new Error(`KA-API HTTP ${res.status}`);
        err.transient = res.status < 500;
        throw err;
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        const err = new Error('KA-API Response ist kein gueltiges JSON');
        err.fatal = true;
        throw err;
    }
}

async function kaApiWithRetry(path, params, maxRetries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await kaApiRaw(path, params);
        } catch (e) {
            lastErr = e;
            if (e.fatal || !e.transient || attempt === maxRetries) throw e;
            const backoff = e.retryAfterMs || 800 * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, backoff));
        }
    }
    throw lastErr;
}

// Serielle Queue: alle API-Requests laufen nacheinander durch, nie parallel
function kaApiQueued(path, params, maxRetries) {
    const run = kaApiState.queue.then(() => kaApiWithRetry(path, params, maxRetries));
    // Queue nie an einem Fehler festhaengen lassen
    kaApiState.queue = run.catch(() => {});
    return run;
}

// ------------------------------------------------------------------
// TTL-Cleanup (2026-09-09, P0-Roadmap): Der SW stirbt nach ~30s, deshalb
// Cleanup via chrome.alarms (12h-Periode, weckt den SW). Raeumt:
//   ka_recorder   -- Aufnahme 7 Tage nach letzter Aktivitaet (nach dem
//                    Download bleibt der Datensatz sonst endlos liegen)
//   ka_enrich_cache -- Eintraege aelter als 7 Tage TTL
// Dedup/Frische der aktiven Features bleibt unangetastet; geloescht wird
// nur, was ueber die TTL hinaus niemand mehr braucht.
// ------------------------------------------------------------------
const KA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KA_CLEANUP_ALARM = 'ka_ttl_cleanup';

async function kaTtlCleanup() {
    const now = Date.now();
    const rec = await KAStorage.get('ka_recorder');
    if (rec && rec.order && rec.order.length && rec.recording !== true) {
        const stamp = Date.parse(rec.updatedAt || rec.startedAt || '');
        if (stamp && now - stamp > KA_TTL_MS) {
            await KAStorage.set('ka_recorder', { recording: false, ads: {}, order: [] });
            console.log('[KA Background] ka_recorder geraeumt (TTL 7d nach letzter Aktivitaet)');
        }
    }
    const cache = await KAStorage.get('ka_enrich_cache');
    if (cache && typeof cache === 'object') {
        let dropped = 0;
        for (const [id, v] of Object.entries(cache)) {
            if (v && v.fetchedAt && now - v.fetchedAt > KA_TTL_MS) {
                delete cache[id];
                dropped++;
            }
        }
        if (dropped) {
            await KAStorage.set('ka_enrich_cache', cache);
            console.log(`[KA Background] ka_enrich_cache: ${dropped} Eintraege abgelaufen (TTL 7d)`);
        }
    }
}

chrome.alarms.create(KA_CLEANUP_ALARM, { periodInMinutes: 720 });
chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === KA_CLEANUP_ALARM) kaTtlCleanup().catch((e) => console.error('[KA Background] Cleanup-Fehler:', e));
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Download-Brücke (P0-Roadmap, chrome.downloads statt Blob-a.click):
    // Content-Scripts duerfen die downloads-API nicht aufrufen -> Message.
    // Fehlerfall: Content-Script faellt auf sein a.click()-Verfahren zurueck.
    if (request.action === 'kaDownload' && request.url) {
        chrome.downloads.download({ url: request.url, filename: request.filename, saveAs: false }, (id) => {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ ok: true, id });
            }
        });
        return true;
    }
    if (request.action === 'kaApiGetAd') {
        kaApiQueued(`/ads/${request.id}.json`, {})
            .then(raw => sendResponse({ ok: true, ad: normalizeAdResponse(raw) }))
            .catch(e => sendResponse({ ok: false, error: e.message, fatal: !!e.fatal }));
        return true; // async sendResponse
    }
    if (request.action === 'kaApiSearch') {
        kaApiQueued('/ads.json', request.params || {})
            .then(raw => sendResponse({ ok: true, ads: normalizeSearchResponse(raw) }))
            .catch(e => sendResponse({ ok: false, error: e.message, fatal: !!e.fatal }));
        return true;
    }
    if (request.action === 'kaApiSellerProfile') {
        // users/public ist camelCase ohne JAXB-Envelope -> raw direkt
        kaApiQueued(`/users/public/${request.userId}/profile.json`, {})
            .then(raw => sendResponse({ ok: true, profile: normalizeSellerProfile(raw) }))
            .catch(e => sendResponse({ ok: false, error: e.message, fatal: !!e.fatal }));
        return true;
    }
    if (request.action === 'kaApiSellerAds') {
        // Weitere aktive Anzeigen des Verkaeufers derselben JAXB-Envelope-Form
        // wie die Suche -> normalizeSearchResponse() passt.
        kaApiQueued(`/ads/seller-other-ads/${request.adId}.json`, {})
            .then(raw => sendResponse({ ok: true, ads: normalizeSearchResponse(raw) }))
            .catch(e => sendResponse({ ok: false, error: e.message, fatal: !!e.fatal }));
        return true;
    }
    if (request.action === 'kaApiViews') {
        kaApiQueued(`/v2/counters/ads/vip/${request.adId}`, {})
            .then(raw => sendResponse({ ok: true, views: normalizeViewCount(raw) }))
            .catch(e => sendResponse({ ok: false, error: e.message, fatal: !!e.fatal }));
        return true;
    }
    // --- Referenz-Endpunkte (kleinanzeigen-agent-MCP-Tool-Nachbau, 2026-09-09)
    // Baum/Schema-Antworten werden roh durchgereicht (kein JAXB-Envelope).
    if (request.action === 'kaApiCategories') {
        kaApiQueued('/categories.json', {})
            .then(raw => sendResponse({ ok: true, data: raw }))
            .catch(e => sendResponse({ ok: false, error: e.message, fatal: !!e.fatal }));
        return true;
    }
    if (request.action === 'kaApiCategoryMeta') {
        kaApiQueued(`/ads/metadata/${request.categoryId}.json`, {})
            .then(raw => sendResponse({ ok: true, data: raw }))
            .catch(e => sendResponse({ ok: false, error: e.message, fatal: !!e.fatal }));
        return true;
    }
    if (request.action === 'kaApiCategorySearchMeta') {
        kaApiQueued(`/ads/search-metadata/${request.categoryId}.json`, {})
            .then(raw => sendResponse({ ok: true, data: raw }))
            .catch(e => sendResponse({ ok: false, error: e.message, fatal: !!e.fatal }));
        return true;
    }
    if (request.action === 'kaApiLocationSearch') {
        // top-locations mit q-Filter oder depth=0 fuer die Topstaedte
        kaApiQueued('/locations/top-locations.json', {
            depth: request.depth != null ? request.depth : 0,
            q: request.q,
        })
            .then(raw => sendResponse({ ok: true, data: raw }))
            .catch(e => sendResponse({ ok: false, error: e.message, fatal: !!e.fatal }));
        return true;
    }
    if (request.action === 'kaApiLocation') {
        kaApiQueued(`/locations/${request.locationId}.json`, {})
            .then(raw => sendResponse({ ok: true, data: raw }))
            .catch(e => sendResponse({ ok: false, error: e.message, fatal: !!e.fatal }));
        return true;
    }
});
