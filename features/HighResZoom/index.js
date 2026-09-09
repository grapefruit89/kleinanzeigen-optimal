KAFeatureManager.register('HighResZoom', () => {
    // 0. Turbo Start: Preconnect
    if (!document.querySelector('link[href="https://img.kleinanzeigen.de"]')) {
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = 'https://img.kleinanzeigen.de';
        (document.head || document.documentElement).appendChild(link);
    }

    // 1. Create overlay container
    const overlay = document.createElement('div');
    overlay.id = 'ka-hover-overlay';
    document.body.appendChild(overlay);

    let hoverTimer = null;

    // Kleinanzeigen liefert Bilder ueber img.kleinanzeigen.de/api/v1/prod-ads/images/..
    // ?rule=$_XX.AUTO aus, wobei XX eine von einem festen Satz vordefinierter
    // CDN-Groessenregeln ist (kein linearer Zusammenhang zur Nummer!). Empirisch
    // ermittelt (Konsolentest ueber alle Regeln $_0 bis $_100 gegen ein reales
    // Anzeigenbild, 28.08.2026):
    //
    //   Regel   Aufloesung     Regel   Aufloesung     Regel   Aufloesung
    //   $_57    1600 x 694     $_58     640 x 278     $_18     200 x  87
    //   $_45    1200 x 521     $_12     500 x 217     $_37     175 x  76
    //   $_86    1024 x 444     $_21     500 x 217     $_7      150 x  65
    //   $_32    1000 x 434     $_72     500 x 217     $_26     140 x  60
    //   $_59     960 x 416     $_75     430 x 187     $_56     100 x  43
    //   $_3      800 x 347     $_1      400 x 174     $_0       96 x  41
    //   $_20     800 x 347     $_16     400 x 174     $_97      90 x  39
    //   $_85     726 x 315     $_19     400 x 174     $_23      80 x  34
    //   $_27     640 x 278     $_8      300 x 130     $_6       70 x  30
    //                          $_35     300 x 130     $_14      64 x  28
    //                          $_24     298 x 129     $_22      60 x  26
    //                          $_62     225 x  97     $_34      50 x  22
    //                          $_90     220 x  95     $_39      32 x  14
    //                          $_2      200 x  87
    //                          $_9      200 x  87
    //
    // -> $_57 ist die groesste verfuegbare Aufloesung, aber fuer den Hover-Overlay
    //    (per CSS auf max-width: 800px gedeckelt) reine Verschwendung: 224 KB pro Bild,
    //    und showGallery() laedt bis zu 4 Bilder pro Hover (Haupt- + 3 Detailbilder) ->
    //    bis zu ~900 KB fuer einen einzigen Hover. Reale Dateigroessen gemessen
    //    (28.08.2026, selbes Testbild):
    //      $_57  1600x694   224 KB
    //      $_45  1200x521   113 KB  <- gewaehlt fuer "max"
    //      $_86  1024x444    81 KB  <- "list"
    //      $_32  1000x434    78 KB
    //      $_59   960x416    71 KB
    //    $_45 deckt die 800px-Anzeigebreite noch bis 1.5x Pixeldichte scharf ab,
    //    halbiert aber die Dateigroesse ggue. $_57 fast komplett. $_86 bleibt fuer
    //    "list" unveraendert, da via IntersectionObserver im Hintergrund vorgeladen
    //    wird und die 81 KB dort nichts blockieren. Falls Kleinanzeigen das
    //    CDN-Schema aendert, muss der Test wiederholt werden (Skript siehe
    //    Projekt-Notizen "HighResZoom CDN-Aufloesungsregeln (Test-Ergebnis)").
    const CACHE_RULES = { list: 'rule=$_86.AUTO', max: 'rule=$_45.AUTO' };

    // 2. Smart Preloader via IntersectionObserver
    const preloadObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const origSrc = img.src;
                if (origSrc) {
                    const maxSrc = origSrc.replace(/rule=\$_\d+\.AUTO/, CACHE_RULES.max);
                    const preloader = new Image();
                    preloader.src = maxSrc; // load into cache
                }
                obs.unobserve(img); // only preload once
            }
        });
    }, { rootMargin: "600px" });

    // 3. Process thumbnails
    //
    // Kleinanzeigen benutzt je nach Kategorie/Layout-Version unterschiedliche
    // Karten-Strukturen fuer dieselben Anzeigenbilder:
    //  - alt:      <li class="ad-listitem"> ... <article class="aditem"> ... <img>
    //  - neu (A):  <li> (OHNE ad-listitem-Klasse) > <article class="flex..."> > <a> > <img>
    //  - neu (B):  <div data-testid="ad-tile-image-wrapper"> > <img>  (Kachel-Grid)
    // Klassennamen und Container-Tags sind also kein verlaesslicher Anker mehr.
    // Robuster Anker ist der Link zur Detailseite (<a href="/s-anzeige/...">), der
    // in allen bisher beobachteten Varianten das Bild umschliesst.
    function findAdContext(img) {
        // Wichtig: das <img> liegt nicht immer INNERHALB des Links zur Anzeige!
        // Im Startseiten-Feed-Grid (data-testid="ad-tile-image-wrapper") z.B. ist
        // das Bild ein Geschwisterelement des <a>, nicht dessen Kind -- die ganze
        // Karte wirkt nur optisch klickbar (per CSS ::after-Overlay-Trick auf dem
        // Link). Deshalb zuerst die Karte (li/article) suchen und DARIN nach dem
        // Anzeigen-Link suchen, statt direkt vom Bild nach oben zum <a> zu laufen.
        const card = img.closest('li, article.aditem');
        if (card) {
            const link = card.querySelector('a[href^="/s-anzeige/"]') ||
                         card.querySelector('a.aditem-main--middle--price-shipping--price');
            if (link) return { hoverTarget: card, link: link.href };
        }
        // Fallback: kein li/article gefunden, aber das Bild liegt direkt in einem Link.
        const anchor = img.closest('a[href^="/s-anzeige/"]');
        if (anchor) return { hoverTarget: anchor, link: anchor.href };
        return null;
    }

    function processThumbnails() {
        document.querySelectorAll('img[src*="kleinanzeigen.de/api/v1/prod-ads/images/"]').forEach(img => {
            const ctx = findAdContext(img);
            if (!ctx || ctx.hoverTarget.dataset.kaZoomBound) return;
            ctx.hoverTarget.dataset.kaZoomBound = 'true';

            // Instantly set list to sharp medium resolution
            const origSrc = img.src;
            if (!origSrc.includes(CACHE_RULES.list)) {
                img.src = origSrc.replace(/rule=\$_\d+\.AUTO/, CACHE_RULES.list);
                if (img.srcset) img.removeAttribute('srcset');
            }

            // Add to smart preloader
            preloadObserver.observe(img);

            const maxSrc = origSrc.replace(/rule=\$_\d+\.AUTO/, CACHE_RULES.max);

            // Bind hover events
            ctx.hoverTarget.addEventListener('mouseenter', () => handleHover(ctx.link, maxSrc));
            ctx.hoverTarget.addEventListener('mouseleave', handleLeave);
        });
    }

    function handleHover(detailLink, mainImgSrc) {
        // Clear previous state
        overlay.innerHTML = '';
        overlay.classList.remove('active');
        clearTimeout(hoverTimer);
        hoverToken++; // jeder Hover-Wechsel entwertet noch wartende Detail-Fetches sofort

        // Wait 250ms to prevent flashing on accidental hover
        hoverTimer = setTimeout(() => {
            showGallery(detailLink, mainImgSrc);
        }, 250);
    }

    function handleLeave() {
        clearTimeout(hoverTimer);
        overlay.classList.remove('active');
        hoverToken++; // laufende/wartende Gallery-Fetches fuer diese Karte werden ab hier ignoriert
    }

    // 29.08.2026: Detailseiten-Fetch pro Hover (503-Anfaellig bei schnellem
    // Hovern, ~200 KB HTML pro Karte) ist RAUS. Seit 2026-09-09 liefert die
    // Mobile-API (KAApi.getAd) mit EINEM Call: alle Bild-URLs (pictures[]),
    // Titel, Preis + Typ, Ort, Seller-Daten, Einstelldatum -- und der
    // Background-Client bremst/pausiert korrekt. In-Memory-Cache pro Session,
    // damit wiederholtes Hovern = 0 Calls (RentalEnrich's ka_enrich_cache
    // bleibt unberuehrt, dieser Cache ist HighRes-lokal, ohne Bilder dupliziert).
    const previewCache = new Map(); // adId -> {pictures, title, price, seller, location, startDateTime}
    let hoverToken = 0;

    function adIdFromLink(link) {
        // Buddy-Pattern: /s-anzeige/<slug>/<id>-<cat>-<loc>
        const m = String(link || '').match(/\/(\d{6,})-\d+-\d+/);
        return m ? m[1] : null;
    }

    function fmtDate(iso) {
        const t = Date.parse(String(iso || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
        return isNaN(t) ? null : new Date(t).toLocaleDateString('de-DE');
    }

    // Statistik-Schiene rechts am Bild (API-Daten). Zentriert mit dem Overlay
    // (CSS: flex-row, alles in der Mitte), kompakt lesbar.
    function renderStats(ad) {
        const panel = document.createElement('div');
        panel.id = 'ka-preview-stats';
        const rows = [];
        if (ad.title) rows.push(`<div class="ka-ps-title">${ad.title}</div>`);
        if (ad.price) {
            const p = [];
            if (ad.price.amount != null) p.push(ad.price.amount.toLocaleString('de-DE') + ' €');
            if (ad.price.type) p.push(ad.price.type);
            if (ad.price.originalAmount != null) p.push(`<s style="opacity:.6">${ad.price.originalAmount.toLocaleString('de-DE')} €</s>`);
            if (p.length) rows.push(`<div class="ka-ps-price">${p.join(' · ')}</div>`);
        }
        if (ad.location) rows.push(`<div class="ka-ps-row">📍 ${ad.location.name || ''}</div>`);
        if (ad.startDateTime) rows.push(`<div class="ka-ps-row">🗓 online seit ${fmtDate(ad.startDateTime)}</div>`);
        if (ad.category) rows.push(`<div class="ka-ps-row">🏷 ${ad.category.name || ''}</div>`);
        if (ad.seller) {
            const s = ad.seller;
            rows.push(`<div class="ka-ps-row">👤 ${s.accountType || '?'}${s.rating != null ? ` · ★${Number(s.rating).toFixed(1)}` : ''}</div>`);
            if (s.since) rows.push(`<div class="ka-ps-row">🕒 Konto seit ${fmtDate(s.since)}</div>`);
        }
        panel.innerHTML = rows.join('');
        overlay.appendChild(panel);
    }

    async function fetchPreviewData(adId) {
        if (previewCache.has(adId)) return previewCache.get(adId);
        const resp = await KAApi.getAd(adId);
        if (resp.ok && resp.ad) {
            const ad = resp.ad;
            previewCache.set(adId, ad);
            return ad;
        }
        return null;
    }

    function renderExtraPictures(ad, mainImgSrc) {
        // pictures[] = alle Gallery-Bilder; wir nehmen #2/#3 in $_45-Qualitaet
        // (siehe CACHE_RULES-Kommentar oben: 800px-Breite bis 1.5x DPI scharf).
        const seen = new Set([mainImgSrc]);
        let added = 0;
        for (const url of (ad.pictures || [])) {
            if (added >= 2) break;
            const src = url.replace(/(\$\_\d+)?(\.JPG|\.AUTO)/, '$_45.JPG');
            if (!src || seen.has(src)) continue;
            seen.add(src);
            added++;
            const img = document.createElement('img');
            img.src = src;
            overlay.appendChild(img);
        }
    }

    async function showGallery(detailLink, mainImgSrc) {
        const myToken = hoverToken;
        overlay.classList.add('active');

        // 1. Sofort das $_45-Zwischenbild zeigen (kein leeres Overlay), danach im
        //    Hintergrund auf die schaerfste Aufloesung ($_57) hochladen und erst nach
        //    onload tauschen -- kein sichtbarer Sprung/Flackern.
        const mainImg = document.createElement('img');
        mainImg.src = mainImgSrc;
        overlay.appendChild(mainImg);

        const sharpSrc = mainImgSrc.replace(/rule=\$_\d+\.AUTO/, 'rule=$_57.AUTO');
        if (sharpSrc !== mainImgSrc) {
            const sharpPreload = new Image();
            sharpPreload.onload = () => { if (myToken === hoverToken) mainImg.src = sharpSrc; };
            sharpPreload.src = sharpSrc;
        }

        const adId = adIdFromLink(detailLink);
        if (!adId || typeof KAApi === 'undefined') return;
        if (myToken !== hoverToken) return; // Nutzer schon weiter

        const ad = await fetchPreviewData(adId);
        if (!ad || myToken !== hoverToken) return; // abgewischt oder API-Fehler

        // 2. Zusatzbilder + Stats aus EINEM API-Call (aus Cache, falls bekannt)
        renderExtraPictures(ad, mainImgSrc);
        renderStats(ad);
    }

    // Run initially and observe mutations
    processThumbnails();

    // BUGFIX 29.08.2026 (Grok-Review, live bestaetigt): der Fallback auf document.body
    // (wenn #srchrslt-adtable/.itemlist fehlt, z.B. Startseite/Feed-Grid) war selbst mit
    // 400ms-Debounce noch ein Freeze-Risiko -- ein voller body-subtree-Observer, der bei
    // JEDER Mutation (Werbung, Tracking, nachladender Feed) prueft, ob addedNodes > 0 war,
    // parallel zu den anderen Features, die ebenfalls auf document.body/documentElement
    // beobachten (ProAdManager, RentalAnalyzer, InPageMenu). Kein Listen-Container heisst:
    // auf dieser Seite gibt es aktuell nichts, wofuer HighResZoom zustaendig ist (die Karten
    // fehlen ja) -- der Observer startet in diesem Fall jetzt gar nicht erst, statt auf
    // body auszuweichen. Auf echten Ergebnisseiten aendert sich dadurch nichts.
    let debounceTimer = null;
    const adListContainer = document.querySelector('#srchrslt-adtable, .itemlist');
    if (adListContainer) {
        const observer = new MutationObserver((mutations) => {
            let hasAddedNodes = false;
            for (const m of mutations) {
                if (m.addedNodes.length > 0) { hasAddedNodes = true; break; }
            }
            if (!hasAddedNodes) return;

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processThumbnails, 400);
        });
        observer.observe(adListContainer, { childList: true, subtree: true });
    }
});
