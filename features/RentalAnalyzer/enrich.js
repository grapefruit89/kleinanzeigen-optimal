// FEATURE: RentalEnrichment (On-Demand-Enrichment mit Budget-Konzept)
// INTENT:
//   W/S-Fokus-Karte (WasdNavigation setzt .ka-ad-focused) bekommt per
//   Mobile-API Nachveredelung am EUR/m²-Badge: GPS, Seller-Profil inkl.
//   Betrugs-Signal (Gewerbe-im-Privat-Gewand), View-Counter, Anzeige-Alter,
//   Preisreduktion. "Auf Anfrage pro Karte" statt Bulk -- Budget-Konzept:
//   nur die FOKUSSIERTE Karte, Dedup ueber Cache, 1-2 Calls pro Keypress.
// BUDGET (2026-09-09):
//   - Dedup: Cache in chrome.storage.local (ka_enrich_cache, TTL 7 Tage),
//     jede ID wird max. 1x angefragt
//   - Session-Cap: max 40 Enrich-Calls pro Seitenladevorgang (Runaway-Schutz)
//   - Background-Cap (80/10min) greift darueber hinaus
//   - getAd + views + sellerProfile = max 3 Calls pro neuer Karte, nur bei
//     Fokus-Wechsel (User-gesteuert, nie automatisch ueber alle Karten)
// ANCHOR (2026-09-09 live):
//   Fokus: .ka-ad-focused (WasdNavigation navigateAds)
//   Badge: .ka-sqm-badge (KAUI.markAd)
// WORKS WHEN:
//   Karte mit W/S fokussieren -> Badge-Zeile zeigt nach ~1-2s Details
// BROKEN IF:
//   Zeile bleibt auf "Lade Details" (API-Cap erreicht -> im Tooltip steht
//   der Fehler) ODER kein Badge da (Karte ist keine erkannte Miete)

(() => {
    if (typeof KAStorage === 'undefined' || typeof KAApi === 'undefined' || typeof KAUI === 'undefined') return;

    const CACHE_KEY = 'ka_enrich_cache';
    const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const SESSION_BUDGET = 40;
    let sessionCalls = 0;

    function getFocusedCard() {
        return document.querySelector('.ka-ad-focused');
    }

    function getCardId(article) {
        return article && (article.getAttribute('data-adid')
            || (article.querySelector('article[data-adid]') || {}).dataset?.adid
            || null);
    }

    async function loadCache() {
        const c = await KAStorage.get(CACHE_KEY, {});
        // TTL-Hygiene beim Laden
        const now = Date.now();
        for (const id in c) {
            if (!c[id] || now - (c[id].fetchedAt || 0) > CACHE_TTL_MS) delete c[id];
        }
        return c;
    }

    function ageDaysSince(startDateTime) {
        if (!startDateTime) return null;
        // TZ ohne Doppelpunkt ("+0200") zerreisst Date.parse -> normalisieren
        const norm = String(startDateTime).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
        const t = Date.parse(norm);
        if (isNaN(t)) return null;
        return Math.max(0, Math.round((Date.now() - t) / 86400000));
    }

    function computeFlags(info) {
        // Betrugs-/Anomalie-Heuristik zentral in kaApiNormalize (Rate-basiert,
        // fair gegen langjaehrige Privat-Accounts). Seed = Profil-since.
        const seller = info.seller || {};
        const p = info.profile || {};
        const flag = (typeof computeCommercialSuspicion === 'function')
            ? computeCommercialSuspicion(seller.accountType, p.counters, p.since || seller.since)
            : null;
        if (flag) info.suspicious = flag;
        // Verstaubt: viele Views + lange online = ueberteuert
        if (info.views != null && info.views > 50 && info.ageDays != null && info.ageDays > 14) {
            info.stale = true;
        }
        return info;
    }

    async function enrichFocused() {
        if (sessionCalls >= SESSION_BUDGET) return;
        const article = getFocusedCard();
        if (!article) return;
        const id = getCardId(article);
        if (!id) return;
        const card = article.matches('article') ? article : article.querySelector('article') || article;
        if (!card.querySelector('.ka-sqm-badge')) return; // keine erkannte Miete -> kein Call

        const cache = await loadCache();
        if (cache[id]) {
            KAUI.updateEnrichment(card, cache[id]);
            return;
        }

        KAUI.setEnrichmentPending(card);
        sessionCalls++;

        try {
            // Call 1: Voll-Detail (GPS, Seller, Preisreduktion)
            const resp = await KAApi.getAd(id);
            if (!resp.ok || !resp.ad) {
                const line = card.querySelector('.ka-enrich-line');
                if (line) line.textContent = 'API: ' + (resp.error || 'unbekannter Fehler');
                return;
            }
            const ad = resp.ad;
            const info = {
                location: ad.location,
                seller: ad.seller,
                price: ad.price,
                startDateTime: ad.startDateTime,
                ageDays: ageDaysSince(ad.startDateTime),
            };

            // Call 2: View-Counter (Nachfrage-/Verhandlungssignal)
            const vr = await KAApi.views(id);
            info.views = vr.ok && vr.views ? vr.views.views : null;

            // Call 3: Seller-Profil (Counters -> Betrugs-Signal)
            if (ad.seller && ad.seller.userId) {
                const pr = await KAApi.sellerProfile(ad.seller.userId);
                info.profile = pr.ok ? pr.profile : null;
            }

            computeFlags(info);
            cache[id] = { ...info, fetchedAt: Date.now() };
            const all = await KAStorage.get(CACHE_KEY, {});
            all[id] = cache[id];
            await KAStorage.set(CACHE_KEY, all);
            // Karte FRISCH referenzieren -- React re-rendert Karten zwischendurch
            // und unsere alte Node-Referenz haengt dann im Leeren (2026-09-09
            // im Live-Debug beobachtet: Cache gefuellt, Badge blieb auf Pending).
            const fresh = getFocusedCard();
            const freshId = fresh && getCardId(fresh);
            KAUI.updateEnrichment((freshId === id && fresh.matches('article')) ? fresh : (fresh || article), info);
        } catch (e) {
            const line = card.querySelector('.ka-enrich-line');
            if (line) line.textContent = 'Enrichment-Fehler: ' + e.message;
        }
    }

    function watchFocus() {
        let timer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(enrichFocused, 250);
        });
        observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }

    watchFocus();
    console.log('[KA-RENTAL-ENRICH] aktiv (On-Demand, Budget', SESSION_BUDGET, 'Calls/Seite)');
})();
