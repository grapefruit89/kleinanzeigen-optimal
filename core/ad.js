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
// Status (fromPayload/fromDocument-Rueckgabe):
//   ok           -- Ads gefunden, Schema passt
//   empty        -- valide Struktur, aber 0 organische Ads (echte leere Suche
//                   oder nur Sponsor-Slot-Marker)
//   stale_schema -- Blob da, aber erwartete Felder fehlen ODER kein Island,
//                   obwohl sichtbare Karten (article[data-adid]) existieren
//                   (KA hat Layout/Blob geaendert -> sichtbar machen, NICHT
//                   heimlich auf DOM-Fallback fallen)
//   unavailable  -- kein resultAds-Island UND keine Karten (keine SRP)

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
