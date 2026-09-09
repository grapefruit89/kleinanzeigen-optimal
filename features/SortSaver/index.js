KAFeatureManager.register('SortSaver', () => {
    // Kleinanzeigen setzt die Sortierung nach Orts-/Filterwechsel auf den eigenen
    // Default ("Empfohlen") zurueck -- das ist Absicht der Seite, kein Bug. Ziel hier:
    // die zuletzt vom NUTZER gewaehlte Sortierung merken und danach die URL wieder
    // darauf setzen. Kein Nachklicken in der Sort-UI, kein MutationObserver auf
    // document.body -- beides war schon mehrfach Ursache von Freezes (ProAdManager,
    // HighResZoom, InPageMenu, RentalAnalyzer).
    //
    // Live am 29.08.2026 gegen die aktuelle Sortier-UI verifiziert
    // (#sortingField-selector-trigger / #sortingField-selector-dropdown-menu,
    // <li role="option"> ohne data-value -- die alte .srchresult-sorting/data-value
    // Selektorik der Vorgaengerversion trifft nicht mehr):
    //   Empfohlen        -> Segment "/sortierung:.../" verschwindet ganz
    //   Neueste          -> sortierung:neuste
    //   Niedrigster Preis-> sortierung:preis
    //   Hoechster Preis  -> sortierung:teuerste
    const SORT_STORAGE_KEY = 'kleinanzeigen_preferredSortOrder';
    const LABEL_TO_SEGMENT = {
        'Empfohlen': null,
        'Neueste': 'neuste',
        'Niedrigster Preis': 'preis',
        'Höchster Preis': 'teuerste',
    };
    const KNOWN_SEGMENTS = new Set(['neuste', 'preis', 'teuerste']);

    // i18n-feste Anker (2026-09-09 Upgrade): Das SortingControls-Astro-Island
    // legt die Optionen als WERTE offen -- Labels koennen sich aendern ("Preis
    // aufsteigend"), die Werte sind der API-Kontext (SORTING_DATE = der
    // sortType der Mobile-API). Reihenfolge der Suffixe: _DESC = teuerste.
    const VALUE_TO_SEGMENT = {
        'RECOMMENDED': null,
        'SORTING_DATE': 'neuste',
        'PRICE_AMOUNT': 'preis',
        'PRICE_AMOUNT_DESC': 'teuerste',
    };

    // Astro-Props dekodieren (gleiche Serialisierung wie resultAds, siehe
    // docs/kleinanzeigen-api.md §3) -> availableOptions [{value, text}]
    function islandOptions() {
        try {
            const sc = document.querySelector('astro-island[component-url*="SortingControls"]');
            if (!sc || !sc.getAttribute('props')) return null;
            const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const dec = (n) => {
                if (Array.isArray(n)) {
                    const [t, v] = n;
                    if (t === 0) return dec(v);
                    if (t === 1) return v.map(dec);
                    if (t === 2 || t === 3) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]));
                    return v;
                }
                if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, x]) => [k, dec(x)]));
                return n;
            };
            const props = dec(JSON.parse(unesc(sc.getAttribute('props'))));
            return Array.isArray(props.availableOptions) ? props.availableOptions : null;
        } catch (e) {
            return null;
        }
    }

    // Label -> Segment: ZUERST ueber die Island-Werte (drift-fest), Label-Map
    // bleibt als Fallback falls das Island fehlt/erweitert wird.
    function labelToSegment(label) {
        const opts = islandOptions();
        if (opts) {
            const hit = opts.find(o => o && o.text === label);
            if (hit && hit.value in VALUE_TO_SEGMENT) return VALUE_TO_SEGMENT[hit.value];
        }
        return (label in LABEL_TO_SEGMENT) ? LABEL_TO_SEGMENT[label] : undefined;
    }

    function extractSegment(url) {
        const m = url.match(/\/sortierung:([a-zA-Z]+)\//);
        return m ? m[1] : null;
    }

    function withSegment(url, segment) {
        try {
            const u = new URL(url);
            const parts = u.pathname.split('/').filter(Boolean).filter(p => !p.startsWith('sortierung:'));
            if (segment) {
                // Segment vor dem letzten Pfadteil einfuegen (das ist i.d.R. der
                // Kategorie/Standort-Code wie "c203l3331", ggf. mit "+filter" dran).
                parts.splice(Math.max(parts.length - 1, 0), 0, `sortierung:${segment}`);
            }
            u.pathname = '/' + parts.join('/');
            return u.toString();
        } catch (e) {
            console.error('[KA SortSaver] Fehler beim Bauen der URL:', e);
            return url;
        }
    }

    async function onUserPickedOption(label) {
        const segment = labelToSegment(label);
        if (segment === undefined) return; // unbekannte Option: nicht raten
        try {
            await KAStorage.set(SORT_STORAGE_KEY, segment);
            console.log('[KA SortSaver] Manuelle Sortierung gespeichert:', segment || '(Empfohlen)');
        } catch (e) {
            console.error('[KA SortSaver] Fehler beim Speichern:', e);
        }
    }

    // Klicks per Delegation auf document abfangen -- kein erneutes Verdrahten noetig,
    // wenn sich das Dropdown-Menu bei jedem Oeffnen neu aufbaut.
    document.addEventListener('click', (ev) => {
        try {
            const el = ev.target.closest('#sortingField-selector-dropdown-menu li[role="option"], .srchresult-sorting li.selectbox-option');
            if (!el) return;
            const label = el.textContent.trim();
            onUserPickedOption(label);
        } catch (e) {
            console.error('[KA SortSaver] Fehler im Klick-Handler:', e);
        }
    }, true);

    // Bewusst NICHT mit location.href initialisiert: sonst wuerde der allererste
    // Aufruf (voller Seiten-Reload nach Ortswechsel) immer uebersprungen, weil
    // "aktuelle URL === lastUrl" beim Start trivial wahr ist -- genau der Fall, in dem
    // Restore am dringendsten noetig ist. Gefunden 29.08.2026 beim Live-Test.
    let lastUrl = null;
    let applying = false;

    async function checkAndRestore() {
        if (applying) return;
        if (location.href === lastUrl) return;
        lastUrl = location.href;

        // Nur auf Kleinanzeigen-Suchseiten aktiv werden
        if (!/^\/s-/.test(location.pathname)) return;

        try {
            const saved = await KAStorage.get(SORT_STORAGE_KEY, undefined);
            if (saved === undefined) return; // Nutzer hat noch nie manuell gewaehlt
            if (saved !== null && !KNOWN_SEGMENTS.has(saved)) return; // unbekannter/alter Wert -- ignorieren statt raten

            const currentSegment = extractSegment(location.href);
            if (currentSegment === saved) return; // schon korrekt (auch: beide null)

            applying = true;
            const target = withSegment(location.href, saved);
            if (target === location.href) { applying = false; return; }
            console.log('[KA SortSaver] Stelle Sortierung wieder her:', saved || '(Empfohlen)');
            location.replace(target);
        } catch (e) {
            console.error('[KA SortSaver] Fehler beim Wiederherstellen:', e);
            applying = false;
        }
    }

    // Leichtgewichtiges Polling auf URL-Aenderungen statt MutationObserver: die Seite
    // routet Sortierung/Ortswechsel teils per pushState, was sich aus dem Isolated-World
    // eines Content-Scripts nicht zuverlaessig abfangen laesst. Ein reiner
    // String-Vergleich alle 500ms ist vernachlaessigbar teuer und beruehrt kein DOM.
    setInterval(checkAndRestore, 500);
    checkAndRestore();
});
