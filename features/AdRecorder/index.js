// FEATURE: AdRecorder
// INTENT:
//   Aufnahmemodus fuer Suchen: REC-Button auf /s-.../ Seiten. Waehrend der
//   Aufnahme holt er fuer jede Karte der jeweils besuchten Seite die VOLL-
//   staendigen Felder per Mobile-API (ohne Bilder!) und sammelt sie in
//   chrome.storage.local. Navigiert der User mit A/D durch die Ergebnis-
//   seiten, wird auf jeder neuen Seite weitergesammelt. "Ende"-Stop schliesst
//   die Aufnahme ab und laedt die JSON-Datei in Downloads.
// REGELN (2026-09-09, Nutzer-Spezifikation):
//   - NUR Ergebnisse der EINGELEITETEN Suche befuellen die Aufnahme. Wechselt
//     der Nutzer auf eine andere Suche/Kategorie (Basis-URL ungleich),
//     stoppt die Aufnahme automatisch (Daten bleiben, Download moeglich).
//   - Keine Bilder/Medien im Datensatz (Platz + Datenschutz).
//   - Deduplizierung per Anzeigen-ID: jede Anzeige max. 1x pro Aufnahme.
// RATE-DISZIPLIN:
//   Sequentielle API-Calls (Background-Queue bremst selbst: 500-1000ms),
//   Budget-Grenze pro Aufnahme (REC_BUDGET) gegen Runaway; Background-Cap
//   (80/10min) greift darueber hinaus als letzter Schutz.
// ANCHOR (2026-09-09 live):
//   Karten: article[data-adid] (Layer 1, siehe WasdNavigation-Kaskade)
//   Basis-URL: pathname ohne /seite:N/-Segment vergleichen
// WORKS WHEN:
//   REC startet -> Anzahlen steigen beim Blättern; Stop -> .json in Downloads
//   mit _meta-Block (Suche, Zeitraum, Quelle, Counts).
// BROKEN IF:
//   Nach REC-Start keine Anzahlen trotz sichtbarer Karten (Feature-Flag aus
//   oder KAApi-Kontext weg -> "Extension neu laden"-Hinweis im Widget)
//   ODER Aufnahme stoppt beim normalen Seitenwechsel (Basis-URL-Vergleich
//   zu streng: sortierung:*-Segmente sind Teil derselben Suche).

(() => {
    // Die Module laufen im selben Isolated-World; Storage/KAApi kommen aus
    // core/Storage.js + core/kaApi.js (Manifest-Reihenfolge garantiert das).
    if (typeof KAStorage === 'undefined' || typeof KAApi === 'undefined') return;

    const REC_BUDGET = 300;      // max Anzeigen pro Aufnahme (Runaway-Schutz)
    const STATE_KEY = 'ka_recorder';

    const RE = /seite:(\d+)/;
    function searchBase() {
        // Basis der Suche: pathname ohne seite:N -- sortierung:* bleibt drin
        // (gleiche Suche, andere Sortierung = trotzdem dieselbe Such-Sicht)
        return window.location.pathname.replace(/\/seite:\d+/g, '');
    }

    function cardIdsOnPage() {
        return [...document.querySelectorAll('article[data-adid]')]
            .map(a => a.getAttribute('data-adid'))
            .filter(Boolean);
    }

    function stripAd(ad) {
        // Ohne Bilder/Medien (Nutzerspezifikation); description behalten.
        const out = { ...ad };
        delete out.pictures;
        return out;
    }

    async function enrichMissing(stateIn, ui) {
        // Frischen Stand lesen: zwischen Aufrufen kann eine andere Seite /
        // ein paralleler Aufruf die Aufnahme schon erweitert haben (Race).
        const stored = await KAStorage.get(STATE_KEY);
        const state = (stored && stored.order) ? stored : stateIn;
        const ids = cardIdsOnPage().filter(id => !state.ads[id]);
        const budgetLeft = REC_BUDGET - state.order.length;
        const todo = ids.slice(0, Math.max(0, budgetLeft));
        if (!todo.length) return;

        let skipped = false;
        for (const id of todo) {
            const resp = await KAApi.getAd(id);
            if (resp.ok && resp.ad) {
                state.ads[id] = stripAd(resp.ad);
                state.order.push(id);
                ui.update(state);
            } else {
                skipped = true;
                if (/Cap|Drossel/i.test(resp.error || '')) break; // Budget-Stop
            }
        }
        state.lastPage = window.location.pathname;
        state.updatedAt = new Date().toISOString();
        await KAStorage.set(STATE_KEY, state);
        if (skipped) ui.note('Einige Anzeigen übersprungen (API-Budget) — weitere Seiten trotzdem erfassbar.');
        ui.update(state);
    }

    function buildExport(state) {
        return {
            _meta: {
                format: 'ka-ad-recording/v1',
                quelle: 'kleinanzeigen mobile-api (api.kleinanzeigen.de)',
                such_url: state.searchUrl,
                such_basis: state.searchBase,
                gestartet_am: state.startedAt,
                beendet_am: new Date().toISOString(),
                aktualisiert_am: state.updatedAt,
                anzahl_ads: state.order.length,
                budget_grenze: REC_BUDGET,
                hinweis: 'Vollstaendige Anzeigenobjekte OHNE Bilder; Preise normiert; GPS + Seller-Daten aus Feld-API',
            },
            ads: state.order.map(id => state.ads[id]),
        };
    }

    function download(state) {
        const blob = new Blob([JSON.stringify(buildExport(state), null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const slug = (state.searchBase.match(/^\/s-([a-z0-9-]+)/i) || [null, 'suche'])[1];
        a.href = url;
        a.download = `KA_Recording_${slug}_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function createWidget() {
        const existing = document.getElementById('ka-rec-ui');
        if (existing) existing.remove();
        const ui = { update: () => {}, note: () => {} };

        // Kontext-Tod-Erkennung (2026-09-09, Live-Debug): Nach einem Extension-
        // Reload laufen alte Seiten weiter, ihre chrome.*-Aufrufe sterben mit
        // "Extension context invalidated" -- das Widget zeigte vorher STUMME
        // Totzustände (Klick tat "nichts"). Jetzt fangen wir es und sagen es.
        const isCtxDead = (e) => /context invalidated/i.test(String((e && e.message) || e));
        const die = (where) => {
            statusEl.textContent = `⚠️ Extension wurde neu geladen -- Seite bitte einmal neu laden, dann funktioniert die Aufnahme. (${where})`;
        };

        const box = document.createElement('div');
        box.id = 'ka-rec-ui';
        box.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:99999;background:#1c1c1c;color:#fff;padding:10px 12px;border-radius:8px;font:13px system-ui;box-shadow:0 2px 10px rgba(0,0,0,.4);min-width:220px;';
        box.innerHTML = `
            <div style="font-weight:700;margin-bottom:6px;">⏺ Such-Aufnahme</div>
            <div id="ka-rec-status" style="margin-bottom:6px;white-space:pre-line;"></div>
            <button id="ka-rec-main" style="padding:5px 10px;border:0;border-radius:4px;background:#c0392b;color:#fff;cursor:pointer;">REC starten</button>
            <button id="ka-rec-stop" style="display:none;margin-left:6px;padding:5px 10px;border:0;border-radius:4px;background:#444;color:#fff;cursor:pointer;">■ Ende &amp; Download</button>
            <button id="ka-rec-seller" style="display:none;margin-left:6px;padding:5px 10px;border:0;border-radius:4px;background:#8e44ad;color:#fff;cursor:pointer;">🔎 Seller-Check</button>
            <button id="ka-rec-close" style="float:right;background:none;border:0;color:#888;cursor:pointer;font-size:14px;">×</button>
        `;
        document.body.appendChild(box);

        const statusEl = box.querySelector('#ka-rec-status');
        const mainBtn = box.querySelector('#ka-rec-main');
        const stopBtn = box.querySelector('#ka-rec-stop');
        const sellerBtn = box.querySelector('#ka-rec-seller');
        box.querySelector('#ka-rec-close').onclick = () => box.remove();

        ui.note = (msg) => { statusEl.dataset.note = msg; };
        ui.update = (state) => {
            const n = state.order.length;
            if (state.recording) {
                mainBtn.style.display = 'none';
                stopBtn.style.display = 'inline-block';
                sellerBtn.style.display = n > 0 ? 'inline-block' : 'none';
                statusEl.textContent = `REC aktiv\n${n} Anzeigen gesammelt`;
                const note = statusEl.dataset.note;
                if (note) statusEl.textContent += `\n${note}`;
            } else if (n > 0) {
                mainBtn.style.display = 'inline-block';
                mainBtn.textContent = 'REC starten (neue Aufnahme)';
                stopBtn.style.display = 'inline-block';
                stopBtn.textContent = 'Download (letzte Aufnahme)';
                sellerBtn.style.display = 'inline-block';
                statusEl.textContent = `Aufnahme bereit\n${n} Anzeigen bereit zum Download`;
            } else {
                mainBtn.style.display = 'inline-block';
                stopBtn.style.display = 'none';
                sellerBtn.style.display = 'none';
                statusEl.textContent = 'Bereit — REC startet Aufnahme\ndieser Suche (A/D-Navigation läuft mit)';
            }
        };

        // Seller-Check (Feature 4, 2026-09-09): Seller-Profile auf ANFRAGE pro
        // Aufnahme -- 1 API-Call pro Anzeige, Background-Cap bremst automatisch.
        // Erzeugt verkaeufer_profil + betrug_verdacht je Datensatz.
        sellerBtn.onclick = async () => {
            try {
                const state = await KAStorage.get(STATE_KEY);
                if (!state || !state.order.length) return;
                sellerBtn.disabled = true;
                let checked = 0, suspicious = 0;
                for (const id of state.order) {
                    const ad = state.ads[id];
                    // API-normalisierte Records (normalizeAd) tragen seller.userId;
                    // DOM/Fallback-Records verkaeufer.user_id -- beides akzeptieren
                    const sellerId = (ad && ad.seller && ad.seller.userId) || (ad && ad.verkaeufer && ad.verkaeufer.user_id);
                    if (!ad || !sellerId) continue;
                    if (ad.verkaeufer_profil) { checked++; continue; }
                    const resp = await KAApi.sellerProfile(sellerId);
                    if (resp.ok && resp.profile) {
                        const p = resp.profile;
                        ad.verkaeufer_profil = {
                            historische_ads: p.counters ? p.counters.historicalAds : null,
                            online_ads: p.counters ? p.counters.onlineAds : null,
                            followers: p.counters ? p.counters.followers : null,
                            reply_rate: p.replyRate,
                            reply_speed: p.replySpeed,
                        };
                        // Betrugs-Signal zentral (kaApiNormalize, Rate-basiert):
                        // lange Private-Accounts mit niedriger Rate bleiben sauber
                        const acct = ((ad.seller && ad.seller.accountType) || (ad.verkaeufer && ad.verkaeufer.typ) || '').toUpperCase();
                        const flag = (typeof computeCommercialSuspicion === 'function')
                            ? computeCommercialSuspicion(acct, p.counters, p.since)
                            : null;
                        if (flag) {
                            ad.betrug_verdacht = flag.reason + ' (historisch ' + flag.historical
                                + ' / online ' + flag.online + (flag.perYear != null ? ' / ' + flag.perYear + '/Jahr' : '') + ')';
                            suspicious++;
                        }
                        checked++;
                        statusEl.textContent = `Seller-Check: ${checked}/${state.order.length}${suspicious ? ' · 🚩 ' + suspicious : ''}`;
                    }
                }
                await KAStorage.set(STATE_KEY, state);
                sellerBtn.disabled = false;
                statusEl.textContent = `Seller-Check fertig: ${checked} geprüft, ${suspicious} 🚩 verdächtig`;
            } catch (e) {
                if (/context invalidated/i.test(String(e.message))) {
                    statusEl.textContent = '⚠️ Extension neu geladen — Seite bitte neu laden.';
                }
                sellerBtn.disabled = false;
            }
        };

        mainBtn.onclick = async () => {
            try {
                await KAStorage.set(STATE_KEY, {
                    recording: true,
                    searchBase: searchBase(),
                    searchUrl: window.location.href,
                    startedAt: new Date().toISOString(),
                    updatedAt: null,
                    ads: {},
                    order: [],
                });
                const state = await KAStorage.get(STATE_KEY);
                ui.update(state);
                enrichMissing(state, ui).catch((e) => { if (isCtxDead(e)) die('REC'); });
            } catch (e) {
                if (isCtxDead(e)) die('REC');
                else statusEl.textContent = 'Fehler beim Start: ' + e.message;
            }
        };

        stopBtn.onclick = async () => {
            try {
                const state = await KAStorage.get(STATE_KEY);
                if (!state || !state.order.length) return;
                state.recording = false;
                await KAStorage.set(STATE_KEY, state);
                download(state);
                ui.update(state);
            } catch (e) {
                if (isCtxDead(e)) die('Stop');
            }
        };

        return ui;
    }

    async function onSearchPage() {
        const ui = createWidget();
        let state = await KAStorage.get(STATE_KEY, { recording: false, ads: {}, order: [] });
        state.ads = state.ads || {};
        state.order = state.order || [];

        // Basis-Vergleich: andere Suche als beim REC-Start -> automatisch stoppen
        if (state.recording && state.searchBase && state.searchBase !== searchBase()) {
            state.recording = false;
            state.autoStopped = 'Suche gewechselt: ' + searchBase();
            await KAStorage.set(STATE_KEY, state);
            ui.note('Automatisch gestoppt — Suche gewechselt. Daten bleiben erhalten.');
        }

        ui.update(state);

        // Läuft eine Aufnahme UND wir sind noch auf derselben Suche -> Seite einsammeln
        if (state.recording && state.searchBase === searchBase()) {
            enrichMissing(state, ui);
        }

        // SPA/Loaded-Mutations: neue Karten nachladen (debounced, 400ms Muster)
        let timer = null;
        new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
                try {
                    const s = await KAStorage.get(STATE_KEY);
                    if (s && s.recording && s.searchBase === searchBase()) {
                        enrichMissing(s, ui).catch((e) => { if (isCtxDead(e)) die('Beobachter'); });
                    }
                } catch (e) {
                    if (isCtxDead(e)) die('Beobachter');
                }
            }, 400);
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (/^\/s-/.test(window.location.pathname)) {
        onSearchPage();
    }
})();
