// FEATURE: ProAdManager (FELSENFEST -- hartverdrahtet, kein Toggle)
// INTENT:
//   Suchliste sauber halten: Liberty/GPT-Filler-Slots (graue Luecken) und
//   komplett gewerbliche Anzeigen (PRO-/TOP-Badge) ausblenden. Kein
//   Feature-Flag, kein Menueeintrag, kein Dashboard mehr (2026-09-09
//   entschlackt -- der alte Zaehler-Button ist entfallen).
// ANCHOR (2026-09-09 live, /s-wohnung-mieten/c203+...):
//   Karten: article[data-adid], Wrapper-<li> via closest('li')
//   Filler: li:has(div[id^="srpb-result-list"]|.liberty-hide-unfilled|
//           div[id^="google_ads_iframe"])
//   Liberty-Slots generisch (09.09.2026): div[data-liberty-position-name] =
//   immer ein Ad-Container (home-billboard 250px-Luecke auf der Homepage,
//   Sky-Scraper, srpb) -> style.css blendet sie klassenlos aus. Der div ist
//   clientseitig injiziert (SSR hat nur Sky), deshalb reine CSS-Regel statt
//   Sweep-Klassen.
//   TOP-Badge: Leaf mit Text "TOP" in der Karte (Wrapper: flex-row gap-
//              xxsmall, live verifiziert via BadgeRemover-Audit)
//   PRO-Badge: Leaf mit Text "PRO" in der Karte ODER a[href^="/pro/"]
//   29.08.2026: 7 von 34 <li> in #srchrslt-adtable sind reine Filler-Slots
//   ohne eigene Ad-Karte -- deshalb Filler separat scannen, NICHT nur
//   article[data-adid] als Startpunkt nehmen.
// WORKS WHEN:
//   Keine grauen Luecken und keine TOP/PRO-kitschierten Karten mehr in der
//   Ergebnisliste, keine home-billboard-Luecke auf der Homepage.
// BROKEN IF:
//   Graue Luecken bleiben sichtbar (neuer Filler-Selector -> erweitern) ODER
//   regulare Anzeigen verschwinden (Badge-Erkennung zu breit -> text-
//   basierte Leaf-Erkennung duerfen nicht auf Titel/Teaser fallen: "TOP"/
//   "PRO" als woertlicher Anzeigentitel wuerde fahrlaessig ausgeblendet).
// DO NOT:
//   Elemente REMOVEN -- React/Astro besitzt die Knoten. Nur Klassen setzen,
//   CSS macht display:none (style.css, gated auf body.ka-feature-
//   proadmanager -- diese Klasse wird hier immer gesetzt).

(() => {
    document.body.classList.add('ka-feature-proadmanager');

    const BADGE_TEXTS = new Set(['TOP', 'PRO']);

    const fillerSelector = 'li:has(div[id^="srpb-result-list"]), li:has(.liberty-hide-unfilled), li:has(div[id^="google_ads_iframe"])';

    function hasPaidBadge(ad) {
        // a[href^="/pro/"] = sicherer Anker; Text-Badges nur als Leaf innerhalb
        // der Karte zaehlen (Titel/Teaser sind selbst Leaf-Elemente, wuerden
        // sonst bei woertlichem "PRO"/"TOP" im Titel faelschlich treffen --
        // deshalb children.length === 0 UND Klassen-Heuristik accent/strong).
        if (ad.querySelector('a[href^="/pro/"]')) return true;
        for (const el of ad.querySelectorAll('div, span')) {
            if (el.children.length !== 0) continue;
            const text = el.textContent.trim();
            if (!BADGE_TEXTS.has(text)) continue;
            const cls = (el.className || '').toString();
            if (/bg-accent|font-strong/.test(cls)) return true;
        }
        // SVG-Glyph-Fallback (Quelle: r-unruh/kleinanzeigen-filter, 2026 live):
        // TOP rendert in manchen Kategorien als SVG statt Text -- der Glyph-Pfad
        // zeichnet die Buchstaben "TOP". Start des Pfads reicht als Anker.
        const TOP_GLYPH_PATH = 'M8.168 13H9.62';
        if (ad.querySelector(`path[d^="${TOP_GLYPH_PATH}"]`)) return true;
        return false;
    }

    function sweep() {
        let fillers = 0, paid = 0;
        document.querySelectorAll(fillerSelector).forEach(li => {
            if (!li.classList.contains('ka-pad-filler-hidden')) {
                li.classList.add('ka-pad-filler-hidden');
            }
            fillers++;
        });

        for (const ad of document.querySelectorAll('article[data-adid]')) {
            const li = ad.closest('li');
            if (!li || li.classList.contains('ka-pad-filler-hidden')) continue;
            if (hasPaidBadge(ad)) {
                li.classList.add('ka-pro-hidden');
                paid++;
            } else {
                li.classList.remove('ka-pro-hidden');
            }
        }
        return { fillers, paid };
    }

    // Debounced MutationObserver (400ms, wie alle anderen Module) -- der Sweep
    // veraendert selbst Klassen, ohne Debounce wuerde er sich endlos selbst
    // triggern. Beobachtet body subtree, damit SPA-Navigation und Nachladen
    // abgedeckt sind.
    let timer = null;
    const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(sweep, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    sweep();
    console.log('[KA-PRO-ADMANAGER] aktiv (Filler-Slots + TOP/PRO-Anzeigen ausgeblendet)');
})();
