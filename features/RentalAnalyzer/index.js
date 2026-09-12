const KleinanzeigenAnalyzer = {
    _debounceTimer: null,

    // IMMO-KATEGORIEN (2026-09-09, Nutzer-Anforderung: "faktisch ueberall wo
    // wir m² sehen"). Der Analyzer laeuft auf ALLEN /s-*/-Seiten. DATEN
    // kommen seit dem Datenlayer-Umbau (10.09.2026) aus KASource
    // (core/source.js: astro-island resultAds-Blob), nicht mehr aus
    // Karten-Text: eine Karte ohne m²-Attribute-Chip bekommt kein Badge.
    // Diese Liste steuert nur den Dashboard-Kontext.
    IMMOSLUGS: ['wohnung-mieten', 'wohnung-kaufen', 'haus-kaufen', 'haus-mieten',
        'grundstuecke-garten', 'gewerbeimmobilien', 'garage-lagerraum',
        'umzug-transport', 'ferienwohnung-ferienhaus', 'immobilien',
        'neubauprojekte', 'mietwohnungen'],

    async init() {
        console.log("[KA-ANALYZER] Initialisiere...");

        // 1. Button IMMER injizieren (Globaler Shortcut)
        KAUI.injectHeaderButton();

        // 2. P0-REWRITE (2026-09-09): Die alten URL-Zwaenge sind RAUS --
        //    ensureFilters() baute tote URL-Formate (anzeige:angebote -> 57 Mio.
        //    Treffer, /s-wohnung-mieten/<slug> -> 404, /c203/<slug> -> 500).
        //    Jetzt: Analyse laeuft auf jeder /s-*/-Seite, deren Karten m² tragen.
        //    Kein Redirect mehr, keine Filter-Zwang.
        if (!window.location.pathname.startsWith('/s-')) {
            this.observeOnlyButton();
            return;
        }

        // FIX 10.09.2026 (Substring-Falle): 'wohnung-mieten' matcht nicht auf
        // /s-wohnung-miete/ -- lockFilters lief dadurch NIE auf der Kategorie.
        const isMiete = /miete(?:n)?(\/|$)/.test(window.location.pathname);
        if (isMiete) KAUI.lockFilters(); // Tausch/Gesuche-Sperre nur im Miete-Kontext

        KAUI.injectDashboard();
        setTimeout(() => this.run(), 500);
        this.observe();
    },

    async run() {
        KAUI.setLoading();

        // DATENSCHICHT-UMBAU (10.09.2026): Ad[] kommt aus dem serverseitigen
        // resultAds-Blob (KASource), NICHT mehr aus Karten-Text. Der alte
        // PLZ-Regex ueber Chips, die Preis-Heuristik und die m²-Raterei sind
        // damit raus. DOM wird ab hier NUR NOCH als Farbe benutzt:
        // article[data-adid="<id>"] fuer Badge-Klassen (erlaubter Anker).
        const src = KASource.fromDocument(document);
        if (src.status !== KASource.STATUS.OK) {
            // Bruch sichtbar machen (Plan §6): NICHT so tun, als waere der
            // Markt leer. Features ohne Zahlen sind ehrlicher als falsche.
            const MELDUNG = {
                unavailable: 'Keine Suchergebnis-Datenquelle (keine SRP?).',
                empty: 'Diese Suche hat keine Treffer.',
                stale_schema: 'Datenquelle veraltet — Kleinanzeigen hat das Ergebnis-Format geaendert. Analyzer pausiert statt falsche Zahlen zu zeigen.',
            };
            KAUI.setLoading(MELDUNG[src.status] || ('Datenquelle: ' + src.status));
            return;
        }

        const db = await KAStorage.get('rental_db', { ads: {} });
        const now = Date.now();
        let dbChanged = false;
        const cat = this.categoryOf();

        const currentAdsData = src.ads.map(ad => {
            // topAd-Feld bleibt im Ad (fuer ProAd/Sponsoring-Logik), ist aber
            // KEIN Ausschluss mehr: der alte Text-Chip-Skip verhinderte Badges
            // auf promoted Karten mit voellig normalen Daten. Datenqualitaet
            // (Preis + m² + Cap) entscheidet, nicht Herkunft.

            // m² aus den Attribute-Chips, die KA serverseitig setzt
            // (["143 m²", "5 Zi.", ...]). Kein Text-Raten, keine Heuristik:
            // ohne m²-Chip kein Badge -- wie vorher, nur sauber.
            let sqm = null;
            for (const chip of ad.attrs) {
                const m = chip.match(/([\d.,]+)\s*m²/i);
                if (m) { sqm = parseFloat(m[1].replace(/\./g, '').replace(',', '.')); break; }
            }

            // Plausibilitaet (wie v2-Parser): ohne echte Zahl kein Badge
            if (!ad.price || ad.price < 100) return null;
            if (!sqm || sqm < 5 || sqm > 5000) return null;
            const pricePerSqm = ad.price / sqm;

            // MIETE-CAPEXklusiv: Platzhalter-/Scam-Preise (12.345.678 € & Co.)
            // produzierten >100.000 €/m²-Badges und vergifteten q1/median/q3.
            // Miete ist eng verteilt (1-60 €/m²), Kauf-Kategorien (Kaufpreise
            // pro m² im Tausender-Bereich) bekommen bewusst KEINEN Cap.
            // FIX 10.09.2026: 'wohnung-mieten' matcht NICHT auf /s-wohnung-miete/
            // (Substring-Falle -- deshalb lief auch das alte lockFilters nie
            // auf dieser Kategorie). Jetzt: 'miete' als Suffix-Test.
            const isMiete = /miete(?:n)?(\/|$)/.test(window.location.pathname);
            if (isMiete && (pricePerSqm < 1 || pricePerSqm > 60)) return null;

            // Persistenz: id-keyed. NEU (Grok-Review): Preis-UPDATE statt
            // insert-only -- Preise aendern sich, Mediane ohne Update luegen.
            const rec = db.ads[ad.id];
            if (rec) {
                if (rec.p !== pricePerSqm) { rec.p = pricePerSqm; rec.t = now; dbChanged = true; }
            } else {
                db.ads[ad.id] = { p: pricePerSqm, plz: ad.plz || '', t: now, cat };
                dbChanged = true;
            }

            // Erlaubter DOM-Anker: Karte per stabiler ID finden, nur Klasse setzen.
            const el = document.querySelector(`article[data-adid="${ad.id}"]`);
            return { ad: el, p: pricePerSqm, plz: ad.plz };
        }).filter(d => d && d.p && d.ad);

        if (dbChanged) { this.cleanDatabase(db, now); await KAStorage.set('rental_db', db); }

        // Kontext-Statistik: aktuelle Seite + DB-Historie der GLEICHEN Kategorie
        const pagePrices = currentAdsData.map(d => d.p);
        const dbPrices = Object.values(db.ads).filter(a => a.cat === cat).map(a => a.p);
        const allPrices = pagePrices.concat(dbPrices);
        if (allPrices.length === 0) { return; }

        const globalStats = KAStats.calculate(allPrices);
        currentAdsData.forEach(item => {
            KAUI.markAd(item.ad, item.p, globalStats);
            // PLZ als dataset (unsere Farbe) statt On-Demand-Text-Scrape im UI
            if (item.plz) item.ad.dataset.kaPlz = item.plz;
        });

        const regionalMatrix = this.getHistoricalRegionalMatrix(currentAdsData, db);
        KAUI.updateDashboard(globalStats, regionalMatrix, db, currentAdsData.length);
        // Kopplung zu WasdNavigation entfernt (Grok-Review 10.09.2026):
        // updateVisibleAds() nimmt gar kein Argument und scannt selbst
        // article[data-adid] -- der Call war tot und koppelte zwei Module.
    },

    categoryOf() {
        // Kategorie-Anker: die cXXX-Nummer in der URL (stabil gegen Slug-Drift,
        // 2026-09-09: Slugs aenderten sich mehrfach, c203/c208 ... blieben)
        const m = window.location.pathname.match(/c(\d{3})/);
        return m ? 'c' + m[1] : window.location.pathname.split('/')[1] || 'unbekannt';
    },

    getHistoricalRegionalMatrix(currentData, db) {
        const pagePlzs = [...new Set(currentData.map(d => d.plz && d.plz.substring(0, 4)).filter(Boolean))];
        const pageCounts = {};
        currentData.forEach(d => {
            if (d.plz && d.plz.length >= 4) {
                const prefix = d.plz.substring(0, 4);
                pageCounts[prefix] = (pageCounts[prefix] || 0) + 1;
            }
        });
        if (pagePlzs.length === 0) return [];
        const cat = this.categoryOf();
        return pagePlzs.map(prefix => {
            const allPricesInRegion = Object.values(db.ads)
                .filter(ad => ad.cat === cat && ad.plz && ad.plz.startsWith(prefix))
                .map(ad => ad.p);
            if (allPricesInRegion.length === 0) return null;
            const stats = KAStats.calculate(allPricesInRegion);
            return { plz: prefix + 'X', onPage: pageCounts[prefix] || 0, inHistory: allPricesInRegion.length, q1: stats.q1, median: stats.median, q3: stats.q3 };
        }).filter(Boolean).sort((a, b) => b.onPage - a.onPage).slice(0, 3);
    },

    cleanDatabase(db, now) {
        const MAX_ENTRIES = 2000;
        const MAX_AGE = 90 * 24 * 60 * 60 * 1000;
        for (const id in db.ads) if (now - db.ads[id].t > MAX_AGE) delete db.ads[id];
        const ids = Object.keys(db.ads);
        if (ids.length > MAX_ENTRIES) {
            const sortedIds = ids.sort((a, b) => db.ads[a].t - db.ads[b].t);
            for (let i = 0; i < ids.length - MAX_ENTRIES; i++) delete db.ads[sortedIds[i]];
        }
    },

    observe() {
        let lastUrl = location.href;
        const observer = new MutationObserver(() => {
            KAUI.injectHeaderButton();
            clearTimeout(this._debounceTimer);
            this._debounceTimer = setTimeout(() => {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    if (!location.href.includes('/s-')) return;
                    KAUI.injectDashboard();
                    this.run();
                } else {
                    const ads = document.querySelectorAll('article[data-adid]');
                    if (ads.length > 0 && !document.querySelector('.ka-sqm-badge')) {
                        this.run();
                    }
                }
            }, 300);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    },

    // Debounce: laeuft auf JEDER Seite ausser /s-*/ (SPA-Navigation-Watch),
    // damit der Header-Button auch nach SPA-Wechsel wieder da ist.
    observeOnlyButton() {
        let debounceTimer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                KAUI.injectHeaderButton();
                if (/^\/s-/.test(window.location.pathname)) {
                    observer.disconnect();
                    this.init();
                }
            }, 400);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
};
KAFeatureManager.register('RentalAnalyzer', () => KleinanzeigenAnalyzer.init());
