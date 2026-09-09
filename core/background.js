importScripts('Storage.js', 'kaApiNormalize.js');

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

    const res = await fetch(url.toString(), {
        headers: {
            'Authorization': KA_API_BASIC_AUTH,
            'User-Agent': KA_API_UA,
            'Accept': 'application/json',
        },
    });
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
});
