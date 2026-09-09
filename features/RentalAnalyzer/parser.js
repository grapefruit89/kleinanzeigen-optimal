// KARentalParser v2 (2026-09-09, P0-Rewrite)
// Der alte Parser kratzte Text-Heuristik ueber ALLE Elemente (p/span/div/a/li)
// und war doppelt kaputt: (a) TOP-Erkennung via toter Klasse .aditem-image--
// badges--badge-topad, (b) der Kontext-Scan traf Titel/Teaser.
//
// Die Karten sind seit dem Redesign UNIFORM ueber ALLE Immokategorien
// (live verifiziert 2026-09-09 auf c203/c208/c207/c277):
//   ["36251 Bad Hersfeld", "79 m² · 2 Zi.", "790 €", "Von Privat"]
//   ["71254 Ditzingen", "126 m² · 5 Zi.", "567.000 €", "Daniel Stumpp"]
//   ["83098 Brannenburg", "257 m²", "229.000 €", "Finestep Immobilien GmbH"]
// -> Leaf-Elemente mit stabilen INHALTEN (PLZ bleibt PLZ, m² bleibt m²),
//    Klasse-frei (KbAnchors-"inhalt"-Strategie, siehe docs/kleinanzeigen-api.md).
//    Kategorie-agnostisch: mietwohnung, haus-kaufen, grundstuecke, gewerbe...
//    "faktisch ueberall wo wir m2 sehen" (Nutzer-Anforderung).
const KARentalParser = {
    // Plausibilitaets-Grenzen (erweitert: Grundstuecke sind >500 m²!)
    MIN_PREIS: 100,
    MIN_FLACHE: 5,
    MAX_FLACHE: 5000,

    extract(ad) {
        try {
            const id = ad.getAttribute('data-adid');
            if (!id) return null;

            let price = null;      // numerischer Betrag
            let priceTyp = null;   // 'fest' | 'vb' | 'verschenken' | 'anfrage'
            let sqm = null;
            let plzFull = null;
            let sellerTyp = null;  // 'privat' | 'gewerblich' | null
            let isTop = false;
            let isTausch = false;

            // Nur LEAF-Elemente in kurzen Chips (<= 60 Zeichen) -- sonst trifft
            // der Regex immer der aeusserste Container (Titel/Teaser).
            const leaves = ad.querySelectorAll('p, span');
            for (const el of leaves) {
                if (el.children.length !== 0) continue;
                const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
                if (!text || text.length > 60) continue;
                const lower = text.toLowerCase();

                if (lower.includes('tausch')) isTausch = true;
                if (lower === 'top') isTop = true;
                if (lower === 'von privat') sellerTyp = 'privat';

                // PLZ+Ort-Chip: "36251 Bad Hersfeld"
                if (!plzFull) {
                    const m = text.match(/^(\d{5})\s+\D/);
                    if (m) plzFull = m[1];
                }
                // Flaeche-Chip: "79 m² · 2 Zi." / "257 m²"
                if (!sqm) {
                    const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m²|m2|qm)/i);
                    if (m) sqm = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
                }
                // Preis-Chip: "790 €" / "567.000 €" / "VB" / "Zu verschenken"
                if (priceTyp === null && /€|VB|verschenken/i.test(text)) {
                    const m = text.match(/([\d.,]+)\s*€/i);
                    if (m) {
                        price = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
                        priceTyp = /VB/i.test(text) ? 'vb' : 'fest';
                    } else if (/verschenken/i.test(text)) {
                        priceTyp = 'verschenken';
                    } else if (/VB/i.test(text)) {
                        priceTyp = 'vb_ohne_zahl';
                    } else {
                        priceTyp = 'anfrage';
                    }
                }
            }

            if (isTausch) return { id, isTop, skip: 'tausch' };
            if (isTop && !price) return { id, isTop: true, skip: 'top' };

            // Plausibilitaet: ohne echte Zahl kein Badge -- bewusst stumm statt raten
            if (!price || price < this.MIN_PREIS || priceTyp === 'verschenken') return null;
            if (!sqm || sqm < this.MIN_FLACHE || sqm > this.MAX_FLACHE) return null;

            return {
                id,
                price,
                sqm,
                pricePerSqm: price / sqm,
                plzFull: plzFull || '',
                sellerTyp,
                isTop,
                priceTyp: priceTyp || 'fest',
            };
        } catch (e) {
            console.error('[KA-PARSER] Fehler:', e);
            return null;
        }
    },
};
