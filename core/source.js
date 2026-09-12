// DATENSCHICHT-ADAPTER (Plan 10.09.2026): die OEFFENTLICHE Schnittstelle.
// fromDocument(doc) / fromPayload(json) -> { ads: Ad[], status }.
// Kein querySelector auf Titel/Preis/PLZ -- DOM ist nur noch Farbe
// (article[data-adid] fuer WASD/Klassen bleibt erlaubt).
// Wenn Props fehlen oder das Schema bricht: Status stale_schema/unavailable,
// KEIN heimlicher DOM-Fallback (bruchsichtbar statt still-kaputt).
//
// Rohquelle (live 10.09.2026 verifiziert, Fixtures docs/fixtures/):
//   astro-island[props] von ImpressionTracker, Feld resultAds:
//   Astro-Serialisierung mit Tag-Tupeln: [0, v] = Wert, [1, arr] = Array.
//   Entry-Shape A (Sponsor-Slot-Marker): {sponsoredAdPresent:true, sponsoredAd:{positionName}}
//   Entry-Shape B (Karte): {organicAdPreview:{id,title,seoLink,price,locationName,
//     parentLocationName,sortingDate,topAd,posterType,attributes,description,...}}

// ad.js hat KASource bereits angelegt (Vertrag + STATUS) -- Methoden
// ANHAENGEN statt var-Guard (der Guard schuetzt nur vor Doppel-Load des
// selben Files, nicht vor verschiedenen Files im selben Iso-World).
var KASource = (typeof KASource !== 'undefined') ? KASource : { STATUS: { OK: 'ok', EMPTY: 'empty', STALE: 'stale_schema', UNAVAILABLE: 'unavailable' } };

Object.assign(KASource, {
    // ---- Astro-Deserialisierung -------------------------------
    _de(v) {
        if (Array.isArray(v) && v.length === 2 && (v[0] === 0 || v[0] === 1)) return v[1];
        return v;
    },

    _decode(v) {
        const d = this._de(v);
        if (Array.isArray(d)) return d.map((x) => this._decode(x));
        if (d && typeof d === 'object') {
            const out = {};
            for (const [k, val] of Object.entries(d)) out[k] = this._decode(val);
            return out;
        }
        return d;
    },

    // ---- Preis-String -> Zahl + Typ ---------------------------
    _parsePrice(s) {
        if (typeof s !== 'string') return { price: null, priceType: 'other' };
        const t = s.trim();
        if (/verschenken/i.test(t)) return { price: null, priceType: 'gift' };
        const m = t.match(/([\d.,]+)\s*€/);
        if (!m) return { price: null, priceType: 'other' };
        const n = parseInt(m[1].replace(/[.,\s]/g, ''), 10);
        if (!Number.isFinite(n)) return { price: null, priceType: 'other' };
        return { price: n, priceType: /vb/i.test(t) ? 'negotiable' : 'fixed' };
    },

    // ---- Kategorie aus dem seoLink (id-cat-sub) ---------------
    _parseCategory(seoLink) {
        const m = typeof seoLink === 'string' ? seoLink.match(/\d+-(\d+)-\d+\/?$/) : null;
        return m ? parseInt(m[1], 10) : null;
    },

    // ---- Eine Karte -> Ad --------------------------------------
    // _parsePrice lebt HIER (einzige Stelle, Grok-Review 10.09.2026) --
    // fromPayload ueberschreibt nichts mehr.
    _mapAd(p) {
        const { price, priceType } = this._parsePrice(p.price);
        const attrs = Array.isArray(p.attributes) ? p.attributes.map(String) : [];
        return {
            id: typeof p.id === 'number' ? p.id : parseInt(p.id, 10) || null,
            url: typeof p.seoLink === 'string' ? p.seoLink : null,
            title: typeof p.title === 'string' ? p.title : '',
            price,
            priceType,
            categoryId: this._parseCategory(p.seoLink),
            plz: /^\d{5}$/.test(p.locationName || '') ? p.locationName : null,
            city: typeof p.parentLocationName === 'string' ? p.parentLocationName : null,
            postedAt: typeof p.sortingDate === 'string' ? p.sortingDate : null,
            isTop: p.topAd === true,
            isPro: p.posterType === 'COMMERCIAL' || (p.company != null),
            attrs,
        };
    },

    // ---- Oeffentliche API ---------------------------------------
    // payload: der resultAds-Wert (getaggt ODER rohes Array) ODER ein
    // Wrapper {resultAds: ...} (Fixture-Format).
    fromPayload(payload) {
        const raw = payload && Array.isArray(payload.resultAds) ? payload.resultAds : payload;
        if (raw == null) return { ads: [], status: this.STATUS.UNAVAILABLE };
        const entries = this._decode(raw);
        if (!Array.isArray(entries)) return { ads: [], status: this.STATUS.STALE };

        const ads = [];
        for (const e of entries) {
            if (!e || typeof e !== 'object') continue;
            const p = e.organicAdPreview;
            if (p && typeof p === 'object' && (typeof p.id === 'number' || typeof p.id === 'string')) {
                ads.push(this._mapAd(p));
            }
            // sponsoredAd-Marker: kein Ad-Datensatz, bewusst skippen (ProAd-
            // Sponsoring-Versteck-Reihenfolge kommt spaeter aus positionName).
        }
        if (!ads.length) return { ads: [], status: this.STATUS.EMPTY };
        return { ads, status: this.STATUS.OK };
    },

    // doc: optional das Dokument (Tests); default window.document.
    // NICHTs anderes anfassen als die props-Attribute.
    fromDocument(doc) {
        const d = doc || document;
        const island = [...d.querySelectorAll('astro-island[props]')]
            .find((i) => (i.getAttribute('props') || '').includes('resultAds'));
        if (!island) {
            // Keine Karte(n-Insel) = keine SRP oder Layout-Bruch. Ohne DOM-
            // Heuristik: nur unterscheiden, ob ueberhaupt Karten sichtbar sind
            // (Fels-Anker article[data-adid]) -- wenn ja: Schemabruch.
            if ((d.querySelectorAll('article[data-adid]') || []).length > 0) {
                return { ads: [], status: this.STATUS.STALE };
            }
            return { ads: [], status: this.STATUS.UNAVAILABLE };
        }
        let props;
        try {
            props = JSON.parse(island.getAttribute('props'));
        } catch (e) {
            return { ads: [], status: this.STATUS.STALE };
        }
        if (!props || props.resultAds == null) return { ads: [], status: this.STATUS.STALE };
        return this.fromPayload(props);
    },
});
