// ==UserScript==
// @require https://deinequelle.de/rental_filter_set.js     // 1️⃣ Filterprüfung
// @require https://deinequelle.de/pagination.js            // 2️⃣ Seitenlogik
// @require https://deinequelle.de/rental_selectors.js       // 3️⃣ DOM-Parser
// ==/UserScript==

(function () {
  'use strict';
  try {
    console.info('[INIT] Starte Kleinanzeigen-Dashboard');
    KARentalFilterSet.ensureActive();         // prüft & ggf. Redirect
    KAPagination.attachHotkeys();             // A/D Navigation aktivieren
    // Beispiel für Daten-Scan:
    document.querySelectorAll('article[data-adid]').forEach(ad => {
      const data = KASelectorsRental.extractFromAd(ad);
      console.debug('[DATA]', data);
    });
  } catch (err) {
    console.error('[INIT-FEHLER]', err);
  }
})();
