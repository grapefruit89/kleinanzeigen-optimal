// AD-VERTRAG (Datenlayer, Richtung "eine Datenschicht, drei Verbraucher,
// DOM nur noch Farbe" -- Plan 10.09.2026). Kein Framework: JSDoc-Vertrag +
// Normalisierer. Keine Felder auf Top-Level, die nicht in JEDE Kategorie
// gehoeren -- kategorie-spezifische Merkmale (Wohnflaeche, PS) leben in
// attrs als RAW-Strings ("143 m\u00b2", "5 Zi.") und werden vom Verbraucher
// geparst, nicht hier heuristisch geraten.
//
// Quelle der Wahrheit: astro-island[props].resultAds (ImpressionTracker-
// Island, serverseitig gesetzt). Authentische Rohform ist die Astro-
// Serialisierung [tag, value] mit tag 0 = Wert, 1 = Array:
//   resultAds = [1, [ [0, {sponsoredAdPresent...|organicAdPreview...}], ... ]]
// Parser in core/source.js dekodiert das; KEIN querySelector auf Titel/Preis.
//
// Status (wasPayload/fromDocument-Rueckgabe):
//   ok           -- Ads gefunden, Schema passt
//   empty        -- valide Struktur, aber 0 Ads (echte leere Suche)
//   stale_schema -- Island/props vorhanden, aber erwartete Felder fehlen
//                   (KA hat den Blob geaendert -> sichtbar machen, NICHT
//                   heimlich auf DOM-Fallback fallen)
//   unavailable  -- kein resultAds-Island auf der Seite

/**
 * @typedef {Object} Ad
 * @property {number} id
 * @property {string} url        // relativer Pfad (seoLink)
 * @property {string} title
 * @property {number|null} price  // EUR, null wenn "unbekannt"/"verschenken"
 * @property {string} priceType   // fixed|negotiable|gift|other
 * @property {number|null} categoryId  // cXXX aus der URL
 * @property {string|null} plz    // locationName (5-stellig) wenn vorhanden
 * @property {string|null} city   // parentLocationName
 * @property {string|null} postedAt  // sortingDate (dd.mm.yyyy) unverarbeitet
 * @property {boolean} isTop
 * @property {boolean} isPro      // posterType COMMERCIAL/company vorhanden
 * @property {string[]} attrs     // Raw-Chips ["143 m²", "5 Zi."], Verbraucher parst
 */

var KASource = (typeof KASource !== 'undefined') ? KASource : {
    STATUS: { OK: 'ok', EMPTY: 'empty', STALE: 'stale_schema', UNAVAILABLE: 'unavailable' },
};
