// FEATURE: WasdNavigation
// INTENT:
//   Tastatur-Navigation auf Suchergebnisseiten: A/D blaettert Seiten,
//   W/S springt zwischen sichtbaren Anzeigen-Karten (scrollt + markiert).
// WORKS WHEN:
//   Auf /s-.../ scrollt S zur naechsten Karte und fuegt ka-ad-focused hinzu.
// ANCHOR (2026-09-09 live, seite /s-wohnung-mieten/c203+...swap_s:nein):
//   Karten:  article[data-adid] (W/S) -- 27 Treffer
//   Seiten:  a[aria-label="Nächste"|"Zurück"] (A/D, war schon robust)
//   Folgeseiten-Format: /s-<slug>/seite:N/<filter-segmente> -- seite:N sitzt
//   direkt NACH dem Slug ( NICHT am Ende), z.B.
//   /s-wohnung-mieten/seite:2/c203+wohnung_mieten.swap_s:nein
// REDUNDANZ (bewusste Ueberlappung gegen Klassen-Drift, 2026-09-09):
//   A/D-Kaskade: aria-label -> title+data-url -> URL-Segment-Bump (DOM-frei!)
//   W/S-Kaskade: article[data-adid] -> article[data-href] -> article mit
//                a[href*="/s-anzeige/"] -> nackte s-anzeige-Links
// BROKEN IF:
//   S/W bewegt den Fokus nicht trotz mehrerer sichtbarer Karten auf der Seite
//   ODER zweimal S hintereinander landet beide Male auf derselben Karte
//        (Index-Reset-Regression, gefunden 29.08.2026)
// DO NOT:
//   article.aditem als Karten-Anker nutzen -- 0 Treffer seit dem Tailwind-
//   Redesign, siehe DataExport/ProAdManager fuer denselben Anker.

const KANavigation = {
    currentIndex: -1,
    visibleAds: [],

    // Kleinanzeigen rendert den Nächste/Zurück-Button je nach Zustand unterschiedlich:
    // - meistens als <a aria-label="Nächste"|"Zurück" href="..."> -- normal klickbar.
    // - manchmal (z.B. am Rand der "..."-Pagination) als <span title="Nächste"|"Zurück"
    //   data-url="..." aria-hidden="true"> -- KEIN echter Link, .click() tut nichts,
    //   man muss selbst zur data-url navigieren.
    // Primär: aria-label / title. Fallback: alte Klassen/Text-Suche als Sicherheitsnetz,
    // falls Kleinanzeigen die Struktur nochmal ändert.
    // 29.08.2026 live verifiziert: a[aria-label="Nächste"] existiert nach wie vor --
    // dieser Teil war schon robust gebaut (Attribut statt Klasse) und ist unveraendert.
    // Kaskade 1: aria-label (live verifiziert, Attribut statt Klasse = drift-sicher)
    // Kaskade 2: title + data-url (Rand der "..."-Pagination, kein echter Link)
    // Kaskade 3: Legacy-Klassen (Sicherheitsnetz, aktuell 0 Treffer)
    // Kaskade 4: Textsuche (aktuell 0 Treffer: "Nächste" steckt nur im aria-label)
    // Kaskade 5: URL-Segment-Bump in navigatePages() -- komplett DOM-frei
    findPaginationElement(kind) {
        const label = kind === 'next' ? 'Nächste' : 'Zurück';

        const byAria = document.querySelector(`a[aria-label="${label}"]`);
        if (byAria) return byAria;

        const byTitleDataUrl = document.querySelector(`[title="${label}"][data-url]`);
        if (byTitleDataUrl) return byTitleDataUrl;

        // Legacy-Fallback (alte Kleinanzeigen-Struktur)
        const legacySelector = kind === 'next' ? '.pagination-next' : '.pagination-prev';
        const legacyEl = document.querySelector(legacySelector);
        if (legacyEl) return legacyEl;

        return Array.from(document.querySelectorAll('a')).find(el => el.innerText?.includes(label)) || null;
    },

    // Redundanz: seite:N aus der URL selbst rechnen, unabhaengig von der DOM-
    // Pagination. Format 2026-09-09: seite:N direkt nach dem Slug, z.B.
    // /s-wohnung-mieten/seite:2/c203+filter. findPaginationElement() liefert
    // fuer seite:N+1 manchmal keinen Link (letzte "..."-Gruppe), die URL kennt
    // die Folgeseite trotzdem.
    pageSegmentUrl(pageNum) {
        try {
            const u = new URL(window.location.href);
            const parts = u.pathname.split('/').filter(Boolean).filter(p => !p.startsWith('seite:'));
            if (pageNum > 1) {
                parts.splice(1, 0, `seite:${pageNum}`); // nach dem Slug, vor Filtern
            }
            u.pathname = '/' + parts.join('/');
            return u.toString();
        } catch (e) {
            return null;
        }
    },

    currentPage() {
        const m = window.location.pathname.match(/seite:(\d+)/);
        return m ? parseInt(m[1], 10) : 1;
    },

    // Hoechste verlinkte Seite aus dem DOM -- nur als Cap gegen Runaway-Navi
    // in unbekannte leere Folgeseiten. 0 = unbekannt, dann ohne Cap fahren.
    maxLinkedPage() {
        let max = 0;
        for (const a of document.querySelectorAll('a[href*="seite:"]')) {
            const m = (a.getAttribute('href') || '').match(/seite:(\d+)/);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        }
        return max;
    },

    navigatePages(direction) {
        // Guard: URL-Bump nur auf Suchseiten (/s-...). Ueberall sonst wuerde
        // z.B. /seite:2 an die Homepage kleben.
        if (!/^\/s-/.test(window.location.pathname)) return;
        const el = this.findPaginationElement(direction > 0 ? 'next' : 'prev');
        if (el) { this.navigateTo(el); return; }

        // DOM-freier Fallback: Seite an der URL hoch/unterzaehlen
        const current = this.currentPage();
        if (direction > 0) {
            const max = this.maxLinkedPage();
            if (max && current >= max) return; // letzte verlinkte Seite erreicht
            const next = this.pageSegmentUrl(current + 1);
            if (next) window.location.href = next;
        } else if (current > 1) {
            const prev = this.pageSegmentUrl(current - 1);
            if (prev) window.location.href = prev;
        }
    },

    // true = Navigation ausgeloest, false = Nichts zu holen (Faellt auf
    // navigatePages() durch)
    navigateTo(el) {
        if (!el) return false;
        const href = el.getAttribute && el.getAttribute('href');
        if (href) {
            el.click();
            return true;
        }
        const dataUrl = el.getAttribute && el.getAttribute('data-url');
        if (dataUrl) {
            window.location.href = dataUrl;
            return true;
        }
        // Letzter Versuch: normaler Klick, falls die Seite einen eigenen Handler hat
        if (el.click) { el.click(); return true; }
        return false;
    },

    init() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            const key = e.key.toLowerCase();

            // --- Pagination (A/D) ---
            if (key === 'd') { // Nächste Seite
                this.navigateTo(this.findPaginationElement('next')) || this.navigatePages(1);
            } else if (key === 'a') { // Vorherige Seite
                this.navigateTo(this.findPaginationElement('prev')) || this.navigatePages(-1);
            }

            // --- Ad-Navigation (W/S) ---
            this.updateVisibleAds();
            if (this.visibleAds.length === 0) return;
            if (key === 's') { // Runter
                this.navigateAds(1);
            } else if (key === 'w') { // Hoch
                this.navigateAds(-1);
            }
        });
    },

    // Karten-Kaskade, Layer fallen von spezifisch auf generisch:
    // 1. article[data-adid]          -- aktueller Anker (2026-09-09: 27 Treffer)
    // 2. article[data-href]          -- falls data-adid-Attribut gestrichen wird
    // 3. article mit s-anzeige-Link  -- falls beide data-*-Attribute weg sind
    // 4. nackte a[href*="/s-anzeige/"] -- Notanker, scrollt zum Titel-Link
    // (2026-09-09 live: 27 / 27 / 27 / 52 Treffer, Layer 1+4 ueberlappen --
    //  damit deckt die Kaskade den Anker doppelt von zwei Seiten ab.)
    findCards() {
        let cards = [...document.querySelectorAll('article[data-adid]')];
        if (cards.length) return cards;

        cards = [...document.querySelectorAll('article[data-href]')];
        if (cards.length) return cards;

        cards = [...document.querySelectorAll('article')]
            .filter(a => a.querySelector('a[href*="/s-anzeige/"]'));
        if (cards.length) return cards;

        // Notanker: Titel-/Bild-Links selbst, pro Karte nur der erste
        const seen = new Set();
        return [...document.querySelectorAll('a[href*="/s-anzeige/"]')]
            .filter(a => {
                const id = (a.getAttribute('href') || '').match(/s-anzeige\/[^/]+\/(\d+)/)?.[1];
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
            });
    },

    updateVisibleAds() {
        // Collect all currently visible ads in the DOM independently of RentalAnalyzer
        // 29.08.2026 live gefunden: article.aditem existiert nicht mehr (0 Treffer) --
        // W/S-Navigation zwischen Anzeigen fand deshalb nie welche. Aktueller Anker ist
        // article[data-adid], gleiche Basis wie DataExport/RentalAnalyzer.
        //
        // BUGFIX 29.08.2026: currentIndex wurde hier IMMER auf -1 zurueckgesetzt, und
        // diese Funktion laeuft bei jedem einzelnen Tastendruck (siehe init()) -- nicht
        // nur wenn sich die Kartenliste tatsaechlich aendert. Jedes S sprang dadurch
        // wieder auf Karte 1 statt weiterzugehen (navigateAds(1) macht aus -1 immer 0).
        // Fix: nur zuruecksetzen, wenn sich die Liste wirklich geaendert hat, und dabei
        // versuchen, den Index der bisher fokussierten Karte in der neuen Liste
        // wiederzufinden statt sie zu verlieren.
        const ads = this.findCards().filter(ad => {
            const style = window.getComputedStyle(ad);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });

        const previouslyFocused = this.visibleAds[this.currentIndex];
        const sameList = ads.length === this.visibleAds.length && ads.every((ad, i) => ad === this.visibleAds[i]);

        this.visibleAds = ads;
        if (!sameList) {
            this.currentIndex = previouslyFocused ? ads.indexOf(previouslyFocused) : -1;
        }
    },

    navigateAds(direction) {
        if (this.currentIndex >= 0 && this.visibleAds[this.currentIndex]) {
            this.visibleAds[this.currentIndex].classList.remove('ka-ad-focused');
        }

        this.currentIndex += direction;
        if (this.currentIndex < 0) this.currentIndex = 0;
        if (this.currentIndex >= this.visibleAds.length) this.currentIndex = this.visibleAds.length - 1;

        const targetAd = this.visibleAds[this.currentIndex];
        if (targetAd) {
            targetAd.classList.add('ka-ad-focused');
            targetAd.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
};
KAFeatureManager.register('WasdNavigation', () => KANavigation.init());
