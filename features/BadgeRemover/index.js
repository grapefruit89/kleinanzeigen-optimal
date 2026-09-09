// FEATURE: BadgeRemover (FELSENFEST -- hartverdrahtet, kein Toggle)
// INTENT:
//   Hervorhebungs-Chips (TOP, PRO, Besichtigt) auf Anzeigen-Karten niemals
//   anzeigen. Kein Feature-Flag, kein Menueeintrag: das ist Grundlagen-
//   Hygiene, kein zuschaltbares Feature.
// ANCHOR (2026-09-09 live, /s-wohnung-mieten/c203+...):
//   Chip = Leaf-Element, Erkennung ueber exakten TEXT + Karten-Kontext:
//     TOP:  div.rounded-small.bg-accent.px-xxsmall.py-xxxsmall.text-bodySmall.font-strong.text-onAccent
//           Wrapper: div.absolute.left-xsmall.top-xsmall.z-[2].flex.flex-row.gap-xxsmall
//     PRO:  div.mr-xsmall.inline-block.rounded-xsmall.bg-accent.px-xsmall.py-xsmall
//   Tailwind-Klassen sind Rauschen (Drift-gefaehrdet) -- der TEXT bleibt
//   stabil, deshalb text-basiert statt klassen-basiert.
//   BEWUSST NICHT im Set: "Neu" -- mehrdeutig (Anzeigentitel/Teaser koennen
//   woertlich "Neu" heissen), Fehltreffer-Risiko > Nutzen.
// WORKS WHEN:
//   Karten ohne TOP/PRO/Besichtigt-Chip gerendert werden, ohne dass das
//   Layout springt (Chip-Wrapper wird mit versteckt, nicht nur der Chip).
// BROKEN IF:
//   Ein Badge-Text taucht noch sichtbar auf (neuer Badge-Text -> BADGE_TEXTS
//   erweitern) ODER Karten-Inhalte verschwinden (Regel zu breit).
// DO NOT:
//   Elemente REMOVEN -- React/Astro besitzt die Knoten (siehe ProAdManager:
//   "CSS-hide statt remove()"). Nur Klasse setzen + <style> injizieren.
//   Klassen-basiert matchen (bg-accent etc.) -- zu breit, trifft Buttons.

(() => {
    const BADGE_TEXTS = new Set(['TOP', 'PRO', 'Besichtigt']);

    const style = document.createElement('style');
    style.id = 'ka-badge-remover-style';
    style.textContent = '.ka-badge-hidden { display: none !important; }';
    (document.head || document.documentElement).appendChild(style);

    function inCard(el) {
        // Chips leben auf Anzeigen-Karten; alles ausserhalb (Filterbar,
        // Ueberschriften, Teaser) bleibt unberuehrt -- Fehltreffer-Schutz.
        return !!el.closest('article');
    }

    function isBadgeEl(el) {
        return el.children.length === 0 &&
            BADGE_TEXTS.has(el.textContent.trim()) &&
            inCard(el);
    }

    function sweep() {
        let hits = 0;
        for (const el of document.querySelectorAll('article div, article span')) {
            if (el.classList.contains('ka-badge-hidden')) continue;
            // Layer 1: Chip selbst
            if (isBadgeEl(el)) {
                el.classList.add('ka-badge-hidden');
                hits++;
                continue;
            }
            // Layer 2: Wrapper, dessen einziger Inhalt Badge-Chips sind
            // (z.B. der absolute-positionierte flex-row-Wrapper um TOP)
            if (el.children.length > 0 && BADGE_TEXTS.has(el.textContent.trim())) {
                const allBadges = [...el.children].every(c =>
                    c.classList.contains('ka-badge-hidden') || isBadgeEl(c)
                );
                if (allBadges) {
                    el.classList.add('ka-badge-hidden');
                    hits++;
                }
            }
        }
        return hits;
    }

    // Debounced MutationObserver (400ms, wie alle anderen Module) -- der Sweep
    // veraendert selbst Klassen, ohne Debounce wuerde er sich endlos selbst
    // triggern. Beobachtet body subtree: Badges erscheinen auf allen Karten,
    // auch in nachgeladenen Listen.
    let timer = null;
    const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(sweep, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    sweep();
    console.log('[KA-BADGE-REMOVER] aktiv (TOP/PRO/Besichtigt)');
})();
