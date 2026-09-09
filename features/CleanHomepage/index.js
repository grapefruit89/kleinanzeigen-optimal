// FEATURE: CleanHomepage (Opt-in, Flag feature_CleanHomepage)
// INTENT:
//   Homepage entschlacken: kuratierte Block-Sequenzen ("Fuer dich empfohlen",
//   "Unternehmensseiten in Deutschland") ausblenden. CSS-only geht nicht,
//   weil die h2-Texte der Anker sind (Tailwind-Klassen instabil, astro-island
//   exportieren fast alle nur "default") -- deshalb Text-Sweep wie im
//   ProAdManager-Fels.
// ANCHOR (2026-09-09 live, https://www.kleinanzeigen.de/):
//   h2-Texte exakt: "Fuer dich empfohlen", "Unternehmensseiten in
//   Deutschland". "Fuer dich empfohlen" hat eine eigene <section>; der
//   Unternehmens-Block haengt als Child-DIV direkt in einer grossen Section
//   (die sonst noch "Weitere Anzeigen" enthaelt -- NICHT die ganze Section
//   hidden!). Regel: closest('section'); wenn diese Section mehr als einen
//   h2 enthaelt, zum Section-Child hochlaufen, das den h2 umspannt.
//   Kategorien-Seitenleiste (#sidebar-category-heading) bewusst NICHT
//   angetastet -- Hauptnavigation (User-Absprache 09.09.2026).
// DO NOT:
//   Elemente REMOVEN -- Astro besitzt die Knoten. Nur Klasse setzen, CSS
//   macht display:none (style.css).

// Registrierung (Opt-in-Pflicht): run() liest ka_settings und setzt
// ka-feature-cleanhomepage am Body -- die CSS-Regeln in style.css greifen
// nur damit. Ohne register() lief das Feature als flag-freier Selbststarter.
KAFeatureManager.register('CleanHomepage', () => {
    const ZIEL_H2 = new Set([
        'Für dich empfohlen',
        'Unternehmensseiten in Deutschland',
    ]);

    function sweep() {
        for (const h2 of document.querySelectorAll('h2')) {
            const text = h2.textContent.trim();
            if (!ZIEL_H2.has(text)) continue;
            let block = h2.closest('section') || h2.closest('astro-island');
            if (!block) continue;
            // Section enthaelt mehrere h2 (uebergreifender Wrapper)? Dann
            // den kleinsten umschliessenden Section-Child-Knoten nehmen.
            if (block.querySelectorAll('h2').length > 1) {
                let el = h2;
                while (el.parentElement && el.parentElement !== block) el = el.parentElement;
                if (el.parentElement === block) block = el;
            }
            block.classList.add('ka-ch-block-hidden');
        }
    }

    // Debounced MutationObserver (400ms, wie ProAdManager) -- Astro-Hydration
    // rendert die Blocks spaet nach, SPA-Navigation sowieso.
    let timer = null;
    const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(sweep, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    sweep();
    console.log('[KA] CleanHomepage initialized (Text-Sweep fuer Homepage-Bloecke)');
});
