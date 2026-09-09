const KleinanzeigenAnalyzer = {
    _debounceTimer: null,

    // IMMO-KATEGORIEN (2026-09-09, Nutzer-Anforderung: "faktisch ueberall wo
    // wir m² sehen"). Der Analyzer laeuft auf ALLEN /s-*/-Seiten, deren Karten
    // m² + Preis tragen -- Parser ist inhalt-basiert (parser.js v2), deshalb
    // braucht es keine URL-Whitelist: eine Karte ohne m²-Chip bekommt kein
    // Badge, fertig. Diese Liste steuert nur den Dashboard-Kontext.
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

        const isMiete = window.location.pathname.includes('wohnung-mieten');
        if (isMiete) KAUI.lockFilters(); // Tausch/Gesuche-Sperre nur im Miete-Kontext

        KAUI.injectDashboard();
        setTimeout(() => this.run(), 500);
        this.observe();
    },

    async run() {
        KAUI.setLoading();

        const ads = document.querySelectorAll('article[data-adid]');
        if (ads.length === 0) { KAUI.setLoading("Warte auf Anzeigen..."); return; }

        const db = await KAStorage.get('rental_db', { ads: {} });
        const now = Date.now();
        let dbChanged = false;
        const cat = this.categoryOf();

        const currentAdsData = Array.from(ads).map(ad => {
            const data = KARentalParser.extract(ad);
            if (!data) return null;
            if (data.skip || data.isTop) return null; // Tausch/TOP: kein Badge (Verstecken macht ProAdManager)

            // Dedup + Persistenz: nur neue IDs in die DB (Basis fuer Mediane)
            if (!db.ads[data.id] && data.pricePerSqm) {
                db.ads[data.id] = { p: data.pricePerSqm, plz: data.plzFull || "", t: now, cat };
                dbChanged = true;
            }
            return { ad, p: data.pricePerSqm, plz: data.plzFull };
        }).filter(d => d && d.p);

        if (dbChanged) { this.cleanDatabase(db, now); await KAStorage.set('rental_db', db); }

        // Kontext-Statistik: aktuelle Seite + DB-Historie der GLEICHEN Kategorie
        const pagePrices = currentAdsData.map(d => d.p);
        const dbPrices = Object.values(db.ads).filter(a => a.cat === cat).map(a => a.p);
        const allPrices = pagePrices.concat(dbPrices);
        if (allPrices.length === 0) { return; }

        const globalStats = KAStats.calculate(allPrices);
        currentAdsData.forEach(item => { KAUI.markAd(item.ad, item.p, globalStats); });

        const regionalMatrix = this.getHistoricalRegionalMatrix(currentAdsData, db);
        KAUI.updateDashboard(globalStats, regionalMatrix, db, currentAdsData.length);
        KANavigation.updateVisibleAds(currentAdsData.map(d => d.ad));
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
