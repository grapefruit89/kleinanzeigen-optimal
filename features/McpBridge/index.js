// FEATURE: McpBridge (v2.1, 2026-09-09 — Architektur-Fix)
// INTENT:
//   Nur noch get_page-Responder im Content-Script: Der WS-Client lebt jetzt
//   im SERVICE WORKER (core/bridge-sw.js) — SW stirbt sauber bei Reload,
//   keine Zombie-Kontexte mehr, kaApiQueued liegt direkt dort.
//   Dieses Modul antwortet auf chrome.tabs.sendMessage({action:'kaGetPage'})
//   vom SW (get_page-Tool) und sonst NICHTS. Opt-in bleibt feature_McpBridge.
// BROKEN IF:
//   "kein Responder": Flag aus ODER Seite nach Aktivierung nicht neu geladen.
// TOKEN-EFFIZIENZ:
//   snapshot = url/title/Karten-Kompaktsatz (default); 'html' = Voll-Dump
//   (teuerster moeglicher Response — bewusst Opt-in, siehe §9).
KAFeatureManager.register('McpBridge', () => {
    'use strict';

    const RE_PLZ = /^\d{5}\b/;
    const RE_PREIS = /\d{1,3}(\.\d{3})* €/;
    const RE_FLAECH = /\d+(?:[.,]\d+)?\s*m²/i;

    function snapshot(maxCards) {
        const karten = [...document.querySelectorAll('article[data-adid]')].slice(0, maxCards).map((art) => {
            const out = { id: art.getAttribute('data-adid') };
            const h = art.querySelector('h2, h3, [class*="title"]');
            if (h) out.titel = (h.textContent || '').trim().slice(0, 80);
            const leafs = [...art.querySelectorAll('*')].filter((e) => e.children.length === 0).map((e) => (e.textContent || '').trim()).filter(Boolean);
            for (const t of leafs) {
                if (RE_PLZ.test(t)) out.plz = t;
                else if (RE_FLAECH.test(t)) out.flaeche = t;
                else if (RE_PREIS.test(t)) out.preis = t;
                else if (/^TOP$/.test(t)) out.top = true;
                else if (/Von |Privat|GmbH|AG$/.test(t)) out.seller = t;
            }
            return out;
        });
        return {
            url: location.href.slice(0, 200),
            title: document.title.slice(0, 120),
            karten_gesamt: document.querySelectorAll('article[data-adid]').length,
            karten,
            hinweis: 'format:"html" liefert den Voll-Dump (teuer, bewusst Opt-in).',
        };
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request && request.action === 'kaGetPage') {
            try {
                if (request.format === 'html') {
                    sendResponse({ ok: true, data: document.documentElement.outerHTML });
                } else {
                    sendResponse({ ok: true, data: snapshot(request.maxCards || 10) });
                }
            } catch (e) {
                sendResponse({ ok: false, error: String((e && e.message) || e) });
            }
        }
        // Kein return true — sendResponse ist synchron hier.
    });
});
