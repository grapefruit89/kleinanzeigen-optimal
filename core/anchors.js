// FEATURE: KAAAnchors (core/anchors.js)
// INTENT:
//   Live-Diagnose der Anker, auf denen die Features sitzen (Buddy-
//   "KbAnchors"-Muster, Abschau 2026-09-09, siehe docs/kleinanzeigen-api.md
//   §8 Fundus). Weniger ein Feature als ein Wartungswerkzeug: Ein Anker, der
//   nicht mehr matcht, wird so BEWEISBAR tot statt durch Doku vermutet.
// PRINZIP:
//   Jeder Anker hat Strategien in Prioritaetsreihenfolge:
//     'selektor'  -- CSS-Selektor (erster Treffer reicht hier, unlike Buddy:
//                    unsere Diagnose braucht den Status, nicht alle Treffer)
//     'inhalt'    -- Blatttext-Muster (z. B. "5 Ziffern = PLZ")
//   Erste Strategie, die einen Kandidaten mit bestandener pruefe() liefert,
//   gewinnt. Siegt NUR 'inhalt', ist der Selektor veraltet -> diagnose()
//   warnt (das ist der eigentliche Wert: Doku-BROKEN-IF wird live sichtbar).
// USE:
//   Console im Extension-Kontext:  KAAAnchors.diagnose()
//   -> console.table + Rueckgabe [{anker, via, ok, hinweis}]
// BROKEN IF:
//   diagnose() meldet FEHLT fuer einen Anker, dessen Feature trotzdem
//   arbeitet (dann ist die Anker-Doku hier falsch, nicht das Feature).
// DO NOT:
//   Nicht in den Runtime-Pfad der Features mischen -- die Features bleiben
//   unveraendert (Surgical Changes); dieses Modul ist NUR Diagnose.
var KAAAnchors = (typeof KAAAnchors !== 'undefined') ? KAAAnchors : (function () {
    'use strict';

    const RE_PLZ = /\b\d{5}\b/;                       // Parser: PLZ-Chip
    const RE_PREIS = /\b\d{1,3}(\.\d{3})* €/;         // Parser: Preis-Chip
    // IDENTISCH mit parser.js:54 (kein \b nach m² -- ² ist Non-Word-Char,
    // eine Boundary dahinter kann NIE matchen; Komma-Dezimalen inklusive)
    const RE_FLAECH = /(\d+(?:[.,]\d+)?)\s*(?:m²|m2|qm)/i;
    const TOP_SVG = 'M8.168 13H9.62';                 // ProAdManager: TOP-Glyph
    const RE_DETAIL = /\/s-anzeige\//;                // Detailseiten
    const RE_SUCHE = /^\/s-/;                         // Suchseiten

    // Die Anker, die die Features wirklich benutzen (Quelle: Header-Doku
    // der jeweiligen Feature-Dateien, Stand 2026-09-09).
    const ANCHORS = [
        {
            name: 'karte (article[data-adid])',
            zweck: 'Ergebniskarte Layer 1 (WasdNavigation/AdRecorder/Parser)',
            strategien: [
                ['selektor', 'article[data-adid]'],
                ['selektor', 'article[data-href]'],
            ],
        },
        {
            name: 'karte-link (a[href*="/s-anzeige/"])',
            zweck: 'Ergebniskarte Layer 4 Fallback (WasdNavigation)',
            strategien: [['selektor', 'a[href*="/s-anzeige/"]']],
        },
        {
            name: 'plz-chip (inhalt)',
            zweck: 'PLZ auf der Karte (parser.js Leaf-Chip-Strategie)',
            inhaltAbsicht: true, // per Design ohne Selektor: keine Warnung
            nurWenn: RE_SUCHE,
            strategien: [['inhalt', RE_PLZ, 'article[data-adid]']],
        },
        {
            name: 'preis-chip (inhalt)',
            zweck: 'Preis auf der Karte (parser.js Leaf-Chip-Strategie)',
            inhaltAbsicht: true,
            nurWenn: RE_SUCHE,
            strategien: [['inhalt', RE_PREIS, 'article[data-adid]']],
        },
        {
            name: 'flaeche-chip (inhalt)',
            zweck: 'm² auf der Karte (parser.js, Regex 1:1 gespiegelt)',
            inhaltAbsicht: true,
            nurWenn: RE_SUCHE,
            strategien: [['inhalt', RE_FLAECH, 'article[data-adid]']],
        },
        {
            name: 'top-glyph',
            zweck: 'TOP/Promoted-Erkennung (ProAdManager/BadgeRemover)',
            inhaltAbsicht: true, // SVG ODER Text-Badge: beides legitim
            nurWenn: RE_SUCHE,
            strategien: [
                ['selektor', `article[data-adid] path[d^="${TOP_SVG}"]`],
                ['inhalt', /^TOP$/, 'article[data-adid]'], // Text-Badge-Fallback
            ],
        },
        {
            name: 'detail-preis',
            zweck: 'Detailseite Preis (detail.js BelenConf-Kaskade)',
            nurWenn: RE_DETAIL,
            strategien: [
                ['selektor', '#viewad-price'],
                ['selektor', 'meta[itemprop="price"]'],
            ],
        },
        {
            name: 'detail-titel',
            zweck: 'Detailseite Titel (detail.js)',
            nurWenn: RE_DETAIL,
            strategien: [
                ['selektor', '#viewad-title'],
                ['selektor', 'h1'],
            ],
        },
        {
            name: 'sorting-island',
            zweck: 'Astro-Island SortingControls (SortSaver Werte-Anker)',
            strategien: [['selektor', 'astro-island[component-url*="SortingControls"]']],
        },
        {
            name: 'seite-pagination',
            zweck: 'Blaettern-Link /seite:N/ (WasdNavigation)',
            strategien: [['selektor', 'a[href*="/seite:"]']],
        },
        // Eigene UI (Feature-Output): diagnose prueft, dass sie existiert
        {
            name: 'ka-sqm-badge',
            zweck: 'RentalAnalyzer EUR/m2-Badge (ui.js)',
            strategien: [['selektor', '.ka-sqm-badge, .ka-sqm-badge-float']],
            optional: true,
        },
        {
            name: 'ka-deal-chip',
            zweck: 'Deal-Chip (ui.js)',
            strategien: [['selektor', '.ka-deal-chip']],
            optional: true,
        },
        {
            name: 'ka-rec-ui',
            zweck: 'AdRecorder-Widget',
            strategien: [['selektor', '#ka-rec-ui']],
            optional: true,
        },
        {
            name: 'ka-inpage-menu-btn',
            zweck: 'InPageMenu-Hamburger (document_start-Block)',
            strategien: [['selektor', '#ka-inpage-menu-btn']],
            optional: true,
        },
    ];

    function leafText(wurzel, muster) {
        // Blattelemente mit sichtbarem Text, der aufs Muster passt
        const alle = wurzel.querySelectorAll('*');
        for (const el of alle) {
            if (el.children.length !== 0) continue;
            const t = (el.textContent || '').trim();
            if (t && muster.test(t)) return el;
        }
        return null;
    }

    function suche(anker, wurzel) {
        for (const [via, wert, scope] of anker.strategien) {
            try {
                if (via === 'selektor') {
                    const hit = wurzel.querySelector(wert);
                    if (hit) return { el: hit, via };
                } else if (via === 'inhalt') {
                    const raum = scope ? wurzel.querySelector(scope) : wurzel;
                    if (!raum) continue;
                    const hit = leafText(raum, wert);
                    if (hit) return { el: hit, via };
                }
            } catch (e) { /* Selektor-Syntax etc.: Strategie ueberspringen */ }
        }
        return null;
    }

    function diagnose() {
        const zeilen = [];
        for (const anker of ANCHORS) {
            if (anker.nurWenn && !anker.nurWenn.test(location.pathname)) {
                zeilen.push({ anker: anker.name, via: 'übersprungen', zweck: anker.zweck, hinweis: 'andere Seitenart (nurWenn)' });
                continue;
            }
            const hit = suche(anker, document);
            let via = 'FEHLT';
            let hinweis = '';
            if (hit) {
                via = hit.via;
                if (hit.via === 'inhalt' && !anker.inhaltAbsicht) {
                    hinweis = '⚠ nur noch Inhalt-Strategie — Selektor veraltet';
                } else if (hit.via === 'inhalt') {
                    hinweis = 'per Design Inhalt-Strategie';
                }
            } else if (anker.optional) {
                via = 'fehlt (optional)';
                hinweis = 'Eigen-UI: Feature-Flag aus oder Feature auf dieser Seite inaktiv';
            } else {
                hinweis = '⚠ BROKEN IF — Feature trifft nichts mehr';
            }
            zeilen.push({ anker: anker.name, via, zweck: anker.zweck, hinweis });
        }
        console.table(zeilen);
        const fehl = zeilen.filter((z) => z.via === 'FEHLT');
        const nurInhalt = zeilen.filter((z) => z.hinweis.includes('nur noch Inhalt'));
        if (fehl.length) console.error(`[KAAAnchors] ${fehl.length} Anker FEHLT:`, fehl.map((f) => f.anker));
        if (nurInhalt.length) console.warn(`[KAAAnchors] ${nurInhalt.length} Anker nur noch via Inhalt (Selektor veraltet):`, nurInhalt.map((n) => n.anker));
        return zeilen;
    }

    return { diagnose, suche, ANCHORS };
})();
