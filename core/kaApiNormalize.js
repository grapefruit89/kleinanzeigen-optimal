// CORE: kaApiNormalize
// ZWECK:
//   Die Mobile-API (api.kleinanzeigen.de) antwortet im JAXB-Schema-Format:
//   jedes Feld ist in {"value": ...} gewickelt, Keys tragen XML-Namespace-
//   Praefix ("{http://www.ebayclassifiedsgroup.com/schema/ad/v1}ad").
//   Diese Datei entkleidet das zu flachen, maschinenlesbaren Feldern und
//   normiert die Preis-Typen auf das Vokabular, das auch die professionellen
//   Scraper nutzen (unfenced-group/lowlanddata Output-Schemas, 2026-09-09).
// VERIFIZIERT (2026-09-09, live per curl):
//   GET /api/ads/{id}.json -> full Schema (GPS, seller rating, badges, phone)
//   GET /api/ads.json?q=... -> Suchschema (price-type PLEASE_CONTACT u.a.)
//   Siehe docs/kleinanzeigen-api.md fuer Details und Quellen.

const NS = '{http://www.ebayclassifiedsgroup.com/schema/ad/v1}';

// Entfernt {"value": x}-Wickel rekursiv. Ein {"value": {...}}-Objekt mit
// genau einem Key wird durch seinen Wert ersetzt, alles andere bleibt.
function unwrapValue(x) {
    if (Array.isArray(x)) return x.map(unwrapValue);
    if (x && typeof x === 'object') {
        const keys = Object.keys(x);
        if (keys.length === 1 && keys[0] === 'value') return unwrapValue(x.value);
        const out = {};
        for (const k of keys) out[k] = unwrapValue(x[k]);
        return out;
    }
    return x;
}

// Preis-Typ-Normierung. Quellen der Vokabeln: unfenced-group/
// kleinanzeigen-classifieds-scraper (FIXED/MIN_BID/FAST_BID/SEE_DESCRIPTION)
// und lowlanddata (GIVEAWAY). API-raw-Werte daneben dokumentiert.
//   API "FREE"            -> GIVEAWAY        ("Zu verschenken")
//   API "PLEASE_CONTACT"  -> SEE_DESCRIPTION ("auf Anfrage")
//   API "CHAT_ONLY"       -> SEE_DESCRIPTION
//   Betrag + Verhandlung  -> MIN_BID         ("200 € VB")
//   Betrag fest           -> FIXED           ("200 €")
//   Betrag fehlt          -> SEE_DESCRIPTION
function normalizePriceType(priceObj) {
    if (!priceObj) return { amount: null, currency: 'EUR', rawType: null, type: 'SEE_DESCRIPTION', negotiable: false, originalAmount: null };
    const raw = (priceObj && priceObj['price-type']) || null;
    const amount = priceObj && priceObj.amount != null && typeof priceObj.amount === 'object'
        ? (priceObj.amount.amount != null ? Number(priceObj.amount.amount) : (priceObj.amount.value != null ? Number(priceObj.amount.value) : null))
        : (priceObj.amount != null ? Number(priceObj.amount) : null);
    // Preisreduktion (kleinanzeigen-reader App-Modell: originalPrice) -- live
    // NOCH UNVERIFIZIERT (Sample hatte keine rabattierte Anzeige): moegliche
    // JAXB-Keys 'original-amount'/'original-price'. Bewusst tolerant:
    // null wenn absent, nie falsch erfinden.
    const origRaw = priceObj['original-amount'] != null ? priceObj['original-amount']
        : (priceObj['original-price'] != null ? priceObj['original-price'] : null);
    let originalAmount = null;
    if (origRaw != null) {
        if (typeof origRaw === 'object') {
            originalAmount = origRaw.amount != null ? Number(origRaw.amount) : (origRaw.value != null ? Number(origRaw.value) : null);
        } else if (typeof origRaw === 'number' || typeof origRaw === 'string') {
            originalAmount = Number(origRaw);
        }
        if (originalAmount != null && isNaN(originalAmount)) originalAmount = null;
    }
    const negotiable = !!(priceObj && (priceObj['negotiation-enabled'] === true || priceObj['negotiation-enabled'] === 'true'));
    const currency = (priceObj && priceObj['currency-iso-code'] && (priceObj['currency-iso-code']['currency-iso-code'] || priceObj['currency-iso-code'].value)) || 'EUR';

    let norm;
    if (raw === 'FREE') norm = 'GIVEAWAY';
    else if (raw === 'PLEASE_CONTACT' || raw === 'CHAT_ONLY') norm = 'SEE_DESCRIPTION';
    else if (amount != null && negotiable) norm = 'MIN_BID';
    else if (amount != null) norm = 'FIXED';
    else norm = 'SEE_DESCRIPTION';

    return { amount, currency, rawType: raw, type: norm, negotiable, originalAmount };
}

function normalizeLocation(locations) {
    const loc = locations && locations.location && locations.location[0];
    if (!loc) return null;
    return {
        zip: loc['id-name'] || null,
        name: loc['localized-name'] || null,
        lat: loc.latitude != null ? Number(loc.latitude) : null,
        lng: loc.longitude != null ? Number(loc.longitude) : null,
        radiusKm: loc.radius != null ? Number(loc.radius) : null,
        state: loc.regions && loc.regions.region && loc.regions.region[0] ? loc.regions.region[0]['localized-name'] : null,
        id: loc.id || null,
        parentId: loc['parent-id'] || null,
    };
}

function normalizeSeller(ad) {
    return {
        userId: ad['user-id'] != null ? String(ad['user-id']) : null,
        accountType: ad['seller-account-type'] || null,        // PRIVATE / COMMERCIAL
        name: ad['contact-name'] || null,
        initials: ad['contact-name-initials'] || null,
        phone: (typeof ad.phone === 'string' && ad.phone) || null, // selten befuellt
        rating: ad['user-rating'] && ad['user-rating'].averageRating != null
            ? Number(ad['user-rating'].averageRating) : null,
        badges: (ad.userBadges && ad.userBadges.badges) || [],
        since: ad['user-since-date-time'] || null,
    };
}

function normalizeAttributes(ad) {
    const attrs = ad.attributes && ad.attributes.attribute;
    if (!Array.isArray(attrs)) return [];
    return attrs.map(a => ({
        name: a.name || null,            // Maschinenname, z.B. "wohnung_mieten.wohnungstyp_s"
        label: a['localized-label'] || null,
        values: Array.isArray(a.value) ? a.value.map(v => v['localized-label'] || v.value).filter(Boolean) : [],
    }));
}

function normalizePictures(ad) {
    const pics = ad.pictures && (ad.pictures.picture || ad.pictures);
    if (!Array.isArray(pics)) return [];
    // API liefert pro Bild rel-Gruppen (thumbnail/teaser/large/extraLarge/XXL)
    // mit "?rule=$_{imageId}.JPG"-Platzhalter (live 2026-09-09). Rule-Ids
    // empirisch getestet (Quelle: kleinanzeigen-reader/mobile-api.md,
    // 2026-08): $_57 = 1600x1096 MAXIMUM, $_45 = 1200x822 Fallback,
    // $_59 = 960x658 (alt, klein!), $_2 = App-Original. .JPG zwingt JPEG.
    const RULE_BY_REL = { thumbnail: 2, teaser: 2, large: 45, extraLarge: 57, XXL: 57 };
    return pics.map(p => {
        const links = (p['media-link'] || p.link || []);
        const arr = Array.isArray(links) ? links : [links];
        // Bevorzugt XXL, dann extraLarge, dann alles andere
        const pick = arr.find(l => l.rel === 'XXL') || arr.find(l => l.rel === 'extraLarge') || arr[0];
        if (!pick || !pick.href) return null;
        return pick.href.replace(/\$\_\{imageId\}/, `\$$_${RULE_BY_REL[pick.rel] || 57}`);
    }).filter(Boolean);
}

function findAdUrl(links) {
    if (!Array.isArray(links)) return null;
    const ext = links.find(l => l.rel === 'link-ad-display' || (l.href && l.href.startsWith('https://www.kleinanzeigen.de')));
    return (ext && ext.href) || (links.find(l => l.href) || {}).href || null;
}

// Hauptfunktion: rohes JAXB-Ad-Objekt (einzelnes "ad"-Element aus Suche oder
// das "{ns}ad"-Value aus der Detailantwort) -> flacher Datensatz.
function normalizeAd(rawAd) {
    const ad = unwrapValue(rawAd);
    if (!ad) return null;

    const links = unwrapValue(ad.link) || [];
    return {
        id: ad.id != null ? String(ad.id) : null,
        title: ad.title || null,
        description: ad.description || null,
        isWanted: (ad['ad-type'] || '').toUpperCase() === 'WANTED',   // Gesuch statt Angebot
        // Status-Lifecycle (kleinanzeigen-bot-Knowledge): ACTIVE/PAUSED/
        // RESERVED/EXPIRED/DELETED/BLOCKED -- RESERVED = reserviert fuer
        // Kaeufer, aber ID/Alter/Views/Watchlist bleiben erhalten
        status: (ad['ad-status'] || ad.status || null),
        price: normalizePriceType(unwrapValue(ad.price)),
        address: ad['ad-address'] ? {
            state: ad['ad-address'].state || null,
            zip: ad['ad-address']['zip-code'] || null,
            street: ad['ad-address'].street || null,
            houseNumber: ad['ad-address']['house-number'] || null,
        } : null,
        location: normalizeLocation(unwrapValue(ad.locations)),
        seller: normalizeSeller(ad),
        attributes: normalizeAttributes(ad),
        pictures: normalizePictures(ad),
        category: ad.category ? {
            id: ad.category.id != null ? String(ad.category.id) : null,
            name: ad.category['localized-name'] || null,
        } : null,
        url: findAdUrl(unwrapValue(links)),
        startDateTime: ad['start-date-time'] || null,      // Einstellzeitpunkt (ISO)
        lastEditDateTime: ad['last-user-edit-date'] || null,
        featuresActive: ad['features-active'] || null,     // z.B. Versand-Features
        buyNow: ad['buy-now'] === true || (ad['buy-now'] && ad['buy-now'].enabled === true),
    };
}

// JAXB-Envelope-Korrektheit: Der Envelope traegt NEBEN "value" auch
// "name"/"declaredType"/"scope" (live 2026-09-09 im Such-Payload gesehen).
// Single-Key-Unwrap greift dort nicht -> explizit .value ziehen, wenn
// vorhanden, sonst roh weiterreichen.
function jaxbPayload(x) {
    return (x && x.value !== undefined && !Array.isArray(x)) ? x.value : x;
}

// Suchantwort: {"{ns}ads": {name/declaredType/scope, "value": {"ad": [...]}}}
// -> Array flacher Ads
function normalizeSearchResponse(data) {
    const envelope = jaxbPayload(data && data[`${NS}ads`]);
    const ads = (envelope && envelope.ad) || [];
    return (Array.isArray(ads) ? ads : [ads]).map(normalizeAd).filter(Boolean);
}

// Detailantwort: {"{ns}ad": {name/declaredType/scope, "value": {...}}}
// -> einzelnes flaches Ad (oder null)
function normalizeAdResponse(data) {
    const envelope = data && data[`${NS}ad`];
    if (!envelope) return null;
    return normalizeAd(jaxbPayload(envelope));
}

// Verkäuferprofil (users/public/{userId}/profile.json) — NOT camelCase
// (kein JAXB-Envelope!), aber in sich gewickelte Objekte. Live 2026-09-09
// verifiziert: counters {historicalAds, onlineAds, followers} +
// replyIndicators {replyRate, replySpeed} = Betrugs-/Verhandlungssignale:
// historisch 151 vs. online 17 Anzeigen = Gewerblich-im-Privat-Gewand.
// Betrugs-/Anomalie-Signatur: "Gewerbe im Privat-Gewand" (2026-09-09, nach
// Kritik entschaefft). 67 historische Anzeigen bei 10 Jahren Account sind
// NORMAL (7/Jahr). Was Gewerbe wirklich zeigt, ist die RATE und der
// gleichzeitige Bestand, nicht die Absolutzahl:
//   - >= 20 Anzeigen/Jahr historisch (Private schaffen selten >15/Jahr)
//   - >= 10 Anzeigen gleichzeitig online (Privat: meist 1-3)
//   - ohne seit-Datum: >= 50 historisch als grober Fallback
// Liefert {suspicious, historical, online, perYear, reason} oder null.
function computeCommercialSuspicion(accountType, counters, since) {
    if (!counters || (accountType || '').toUpperCase() !== 'PRIVATE') return null;
    const hist = counters.historicalAds || 0;
    const online = counters.onlineAds || 0;
    if (hist === 0 && online === 0) return null;

    let perYear = null;
    if (since) {
        // KA-Zeitstempel: "2016-08-12T13:07:42.000+0200" (TZ ohne Doppelpunkt
        // zerreisst Date.parse) -> "+0200" zu "+02:00" normalisieren
        const norm = String(since).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
        const t = Date.parse(norm);
        if (!isNaN(t)) {
            const years = Math.max(0.25, (Date.now() - t) / 31557600000);
            perYear = hist / years;
        }
    }

    const reasons = [];
    if (perYear != null && perYear >= 20) reasons.push(Math.round(perYear) + ' Anzeigen/Jahr');
    else if (perYear == null && hist >= 50) reasons.push(hist + ' historische Anzeigen');
    if (online >= 10) reasons.push(online + ' gleichzeitig online');
    if (!reasons.length) return null;

    return {
        suspicious: true,
        historical: hist,
        online: online,
        perYear: perYear != null ? Math.round(perYear) : null,
        reason: 'Privat-Anomalie: ' + reasons.join(', '),
    };
}

// Verkäuferprofil (users/public/{userId}/profile.json) — NOT camelCase
// (kein JAXB-Envelope!), aber in sich gewickelte Objekte. Live 2026-09-09
// verifiziert: counters {historicalAds, onlineAds, followers} +
// replyIndicators {replyRate, replySpeed} = Betrugs-/Verhandlungssignale:
// historisch 151 vs. online 17 Anzeigen = Gewerblich-im-Privat-Gewand.
function normalizeSellerProfile(raw) {
    if (!raw || !raw.id) return null;
    const badges = (raw.userBadges && raw.userBadges.badges) || [];
    const badgeVal = (name) => {
        const b = badges.find(x => x.name === name);
        return b ? (b.value || null) : null;
    };
    return {
        id: String(raw.id),
        name: raw.contactName || null,
        initials: raw.initials || null,
        posterType: raw.posterType || null,       // PRIVATE / COMMERCIAL
        since: raw.userSince || null,
        badges,
        counters: {
            historicalAds: (raw.counters && raw.counters.historicalAds) ?? null,
            onlineAds: (raw.counters && raw.counters.onlineAds) ?? null,
            followers: (raw.counters && raw.counters.followers) ?? null,
        },
        replyRate: badgeVal('replyRate'),          // z.B. "77%"
        replySpeed: badgeVal('replySpeed') || (raw.replyIndicators && raw.replyIndicators.replySpeed) || null, // z.B. "12h"
    };
}

// View-Counter: CAPI {"adId": "...", "value": N} oder Web-XHR {"numVisits": N}
function normalizeViewCount(raw) {
    if (!raw) return null;
    const n = raw.value != null ? Number(raw.value) : (raw.numVisits != null ? Number(raw.numVisits) : null);
    return { views: n };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { unwrapValue, normalizePriceType, normalizeAd, normalizeSearchResponse, normalizeAdResponse, normalizeSellerProfile, normalizeViewCount, computeCommercialSuspicion, NS };
}
