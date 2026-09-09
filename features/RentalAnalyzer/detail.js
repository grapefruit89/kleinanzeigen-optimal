// FEATURE: Detail-SQM (2026-09-09, aus der "fuer Immos"-Extension-Analyse)
// INTENT:
//   Auf Detailseiten (/s-anzeige/) EUR/m² direkt unter dem Preis anzeigen --
//   die Listen-Seite macht das der RentalAnalyzer, die Detailseite hatte
//   bisher NICHTS. Kaskade fuer Preis/Fläche mit Strukturdaten VOR Heuristik:
//     Preis: BelenConf ad_price -> meta[itemprop=price] -> #viewad-price
//     Fläche: BelenConf qm_d -> #viewad-details-Zeile "Wohnfläche" -> Body-Regex
//   (Quellen: Kleinanzeigen-fuer-Immos ID bojipegcomhjkmbhebabhdofgilpcjcd
//   + live BelenConf-Verifikation 2026-09-09, siehe docs/kleinanzeigen-api.md §3c)
// WORKS WHEN:
//   Detailseite zeigt "X EUR/m2" unter dem Preis; mit >=5 DB-Eintraegen zur
//   PLZ kommt Median-Kontext dazu (Deal-Chip wie in der Liste).
// ANCHOR (2026-09-09 live):
//   window.BelenConf.universalAnalyticsOpts.dimensions (ad_price, qm_d: in
//   dimension108), meta[itemprop=price], #viewad-price, #viewad-details
//   .addetailslist--detail (Label "wohnflaeche"), #viewad-locality (PLZ)
// PLAUSIBILITAET (RentalAnalyzer-Regeln): Preis >= 100 EUR, Flaeche 5-500 m2

(() => {
    if (!/^\/s-anzeige\//.test(window.location.pathname)) return;
    if (typeof KAStorage === 'undefined' || typeof KAStats === 'undefined') return;

    const belen = (window.BelenConf && window.BelenConf.universalAnalyticsOpts
        && window.BelenConf.universalAnalyticsOpts.dimensions) || {};

    function getPrice() {
        // 1. Strukturdatum aus der Tracking-Config (redesign-sicher)
        if (belen.ad_price) {
            const p = parseFloat(belen.ad_price);
            if (!isNaN(p) && p >= 100) return p;
        }
        // 2. SEO-meta (Strukturdatum)
        const meta = document.querySelector('meta[itemprop="price"]');
        if (meta && meta.content) {
            const p = parseFloat(meta.content.replace(',', '.'));
            if (!isNaN(p) && p >= 100) return p;
        }
        // 3. Preis-Element (DOM-Notanker)
        const node = document.getElementById('viewad-price');
        if (node) {
            const p = parseFloat(node.textContent.replace(/\s/g, '').replace(/[€.]/g, '').replace(',', '.'));
            if (!isNaN(p) && p >= 100) return p;
        }
        return null;
    }

    function getArea() {
        // 1. BelenConf: dimension108 enthaelt "qm_d:143.00" (live verifiziert)
        const d108 = String(belen.dimension108 || '');
        const m = d108.match(/qm_d:(\d+(?:\.\d+)?)/);
        if (m) {
            const a = parseFloat(m[1]);
            if (!isNaN(a) && a >= 5 && a <= 500) return a;
        }
        // 2. Attributtabelle: Zeile mit Label "Wohnflaeche"
        const rows = document.querySelectorAll('#viewad-details .addetailslist--detail');
        for (const li of rows) {
            const label = (li.childNodes[0] && li.childNodes[0].textContent || '').trim().toLowerCase();
            if (label.includes('wohnfläche') || label.includes('wohnflaeche')) {
                const val = (li.querySelector('.addetailslist--detail--value') || {}).textContent || '';
                const m = val.replace(/\./g, '').match(/(\d+(?:[.,]\d+)?)\s*m²/i);
                if (m) {
                    const a = parseFloat(m[1].replace(',', '.'));
                    if (!isNaN(a) && a >= 5 && a <= 500) return a;
                }
            }
        }
        // 3. Body-Regex (Notanker, genau der von "fuer Immos")
        const bm = document.body.textContent.match(/(\d{2,4}(?:[.,]\d+)?)\s*m²/);
        if (bm) {
            const a = parseFloat(bm[1].replace(',', '.'));
            if (!isNaN(a) && a >= 5 && a <= 500) return a;
        }
        return null;
    }

    function getPlz() {
        // BelenConf selected_location_name IST die PLZ (live: "77749")
        if (belen.selected_location_name && /^\d{5}$/.test(belen.selected_location_name)) {
            return belen.selected_location_name;
        }
        const loc = document.getElementById('viewad-locality');
        if (loc) {
            const m = loc.textContent.match(/\b(\d{5})\b/);
            if (m) return m[1];
        }
        return null;
    }

    async function inject() {
        const price = getPrice();
        const area = getArea();
        if (!price || !area || area <= 0) return; // nichts raten -- bewusst stumm

        const sqm = price / area;
        const host = document.getElementById('viewad-price');
        if (!host || document.getElementById('ka-detail-sqm')) return;

        const badge = document.createElement('div');
        badge.id = 'ka-detail-sqm';
        badge.textContent = `${Math.round(sqm).toLocaleString('de-DE')} €/m²`;
        badge.style.cssText = 'margin-top:4px;padding:2px 6px;border-radius:3px;'
            + 'background:#2342b2;color:#fff;display:inline-block;font-size:0.9em;font-weight:bold;';

        // Median-Kontext aus der rental_db (>=5 Eintraege zur PLZ-Präfix) --
        // Deal-Chip wie in der Liste, gleiche 80%-Schwelle
        try {
            const db = await KAStorage.get('rental_db', { ads: {} });
            const plz = getPlz();
            const prefix = plz ? plz.substring(0, 4) : null;
            const prices = prefix
                ? Object.values(db.ads).filter(a => a.plz && a.plz.startsWith(prefix)).map(a => a.p)
                : [];
            if (prices.length >= 5) {
                const stats = KAStats.calculate(prices);
                badge.textContent += ` · Median ${Math.round(stats.median).toLocaleString('de-DE')} €/m² (${prices.length} in DB)`;
                if (sqm <= stats.median * 0.8) {
                    badge.style.background = '#1d8a3f';
                    badge.textContent += ` · DEAL −${Math.round((1 - sqm / stats.median) * 100)}%`;
                }
            }
        } catch (e) { /* Kontext-Tod etc. -- Badge ohne Kontext bleibt stehen */ }

        host.parentNode.insertBefore(badge, host.nextSibling);
        console.log('[KA-DETAIL-SQM]', Math.round(sqm), 'EUR/m2 (Preis', price, '/ Flaeche', area, 'm2)');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(inject, 300));
    } else {
        setTimeout(inject, 300);
    }
})();
