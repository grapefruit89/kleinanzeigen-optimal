// rental_filter_set.js
// ======================================================================
// Zweck
// ----------------------------------------------------------------------
// Erkennt, ob du dich auf der "Vanilla"-Mietwohnungsseite befindest
// (https://www.kleinanzeigen.de/s-wohnung-mieten/c203)
// und leitet automatisch zur gefilterten Version weiter:
//
// https://www.kleinanzeigen.de/s-wohnung-mieten/anzeige:angebote/c203+wohnung_mieten.swap_s:nein
//
// So werden "Gesuche" und "Tauschwohnungen" standardmäßig ausgeblendet,
// bevor dein Dashboard, Parser oder Pagination aktiv werden.
//
// Dieses Modul ist einfach gehalten, aber erweiterbar: du kannst
// später weitere Filtersets ergänzen (z. B. Haus mieten, Wohnung kaufen).
// ======================================================================

const KARentalFilterSet = (() => {

  // --------------------------------------------------------------------
  // 1️⃣  Konfiguration für Mietwohnungen
  // --------------------------------------------------------------------
  const FILTER = {
    key: "s-wohnung-mieten",                     // URL-Anker der Kategorie
    code: "c203",                                // Kategoriecode (Kleinanzeigen)
    breadcrumb: /Mietwohnungen/i,                // Sicherheit: prüft Breadcrumb
    targetUrl: "https://www.kleinanzeigen.de/s-wohnung-mieten/anzeige:angebote/c203+wohnung_mieten.swap_s:nein",
    activePattern: /anzeige:angebote\/c203\+wohnung_mieten\.swap_s:nein/i
  };

  // --------------------------------------------------------------------
  // 2️⃣  Hilfsfunktionen
  // --------------------------------------------------------------------
  function getBreadcrumbLeaf() {
    const el = document.querySelector(".breadcrump-leaf");
    return el ? el.textContent.trim() : "";
  }

  function isOnBaseRentalPage() {
    return new RegExp(`/${FILTER.key}/${FILTER.code}/?$`, "i").test(location.pathname);
  }

  function isAlreadyFiltered() {
    return FILTER.activePattern.test(location.href);
  }

  // --------------------------------------------------------------------
  // 3️⃣  Hauptlogik
  // --------------------------------------------------------------------
  function ensureActive() {
    const breadcrumb = getBreadcrumbLeaf();

    // Prüfe, ob wir auf der "Vanilla"-Version sind
    if (isOnBaseRentalPage() && FILTER.breadcrumb.test(breadcrumb) && !isAlreadyFiltered()) {
      console.log("[FILTER] Mietwohnungs-Filter aktivieren:", FILTER.targetUrl);
      window.location.replace(FILTER.targetUrl);
      return true; // Redirect ausgeführt
    }

    console.log("[FILTER] Filter bereits aktiv oder nicht relevant.");
    return false; // Kein Redirect nötig
  }

  // --------------------------------------------------------------------
  // 4️⃣  Platzhalter: spätere Inhaltsfilter (aktuell inaktiv)
  // --------------------------------------------------------------------
  /*
  function markPotentialTradesOrRequests() {
    // Später aktivierbar: Anzeigen nach "Gesuch" oder "Tausch" durchsuchen
    const ads = document.querySelectorAll("article.aditem[data-adid]");
    for (const ad of ads) {
      const txt = (ad.textContent || "").toLowerCase();
      if (txt.includes("tausch") || txt.includes("gesuch")) {
        ad.style.outline = "2px solid orange"; // visuelle Markierung
        console.log("[FILTER] Potenzielles Gesuch/Tausch:", ad.dataset.adid);
      }
    }
  }
  */

  // --------------------------------------------------------------------
  // 5️⃣  Öffentliche API
  // --------------------------------------------------------------------
  return { ensureActive /*, markPotentialTradesOrRequests*/ };

})();

// ======================================================================
// Einbindung im Hauptskript (z. B. kleinanzeigen-dashboard.js):
// ----------------------------------------------------------------------
//
// @require      https://deinequelle.de/rental_filter_set.js
//
// (function() {
//   'use strict';
//   KARentalFilterSet.ensureActive();  // prüft & leitet ggf. weiter
//   KleinanzeigenOptimizer.init();     // normales Dashboard starten
// })();
// ======================================================================
