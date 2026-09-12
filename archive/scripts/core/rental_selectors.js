// selectorsrental.js
// ======================================================================
// Zweck:
// ----------------------------------------------------------------------
// Robuste Extraktion von Immobilieninformationen (Mietobjekte) direkt
// aus einer DOM-Instanz von kleinanzeigen.de (Bereich: /s-wohnung-mieten/*)
//
// Diese Datei ist dafür gedacht, als Utility-Modul in einem
// Tampermonkey-Skript oder einer anderen Analyseerweiterung eingebunden
// zu werden. Sie arbeitet rein auf DOM-Ebene und benötigt keine
// Netzwerkanfragen oder externe Bibliotheken.
//
// Hauptziel: Stabile Erkennung von Preis, Fläche (m²), Zimmerzahl,
// PLZ & Ort – mit adaptiven Fallbacks, Heuristiken und Plausibilitäts-
// prüfungen, um gegen HTML-Redesigns robust zu bleiben.
// ======================================================================

const KASelectorsRental = (() => {

    // ------------------------------------------------------------------
    // 🧱 Basis: Utility-Funktionen
    // ------------------------------------------------------------------

    /**
     * Entfernt unerwünschte Zeichen aus Zahlen und konvertiert nach float.
     * Beispiel: "1.200 €" -> 1200
     */
    function normalizeNumber(txt) {
        if (!txt) return null;
        const cleaned = txt
            .replace(/\s*€\s*/g, '')
            .replace(/\s*m²\s*/g, '')
            .replace(/\s*Zi\.?\s*/g, '')
            .replace(/\./g, '')      // entferne Tausenderpunkte
            .replace(',', '.')       // ersetze Komma durch Punkt
            .replace(/[^\d.]/g, '')  // alles außer Ziffern und Punkt raus
            .trim();
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
    }

    /**
     * Grobe Plausibilitätsprüfung für erkannte Werte.
     * Verhindert unrealistische Ausreißer.
     */
    function plausible(value, type) {
        if (value === null) return false;
        switch (type) {
            case 'area':  return value > 5 && value < 1000;     // 5–1000 m²
            case 'price': return value > 50 && value < 20000;   // 50–20000 €
            case 'rooms': return value >= 1 && value <= 12;     // 1–12 Zimmer
            default: return false;
        }
    }

    /**
     * Erkennt, ob Text eher ein eigenständiges Merkmal ist
     * (z. B. "72 m²" oder "800 €") statt Teil eines Fließtextes.
     */
    function looksLikeStandalone(txt) {
        if (!txt) return false;
        const short = txt.length < 25;
        const fewPunct = (txt.match(/[.,!?;]/g) || []).length <= 1;
        return short && fewPunct;
    }

    /**
     * Berechnet einen einfachen Vertrauensscore für ein extrahiertes Feld.
     * Je höher der Score, desto sicherer ist der Treffer.
     */
    function scoreValue(text, value, type) {
        let score = 0;
        if (looksLikeStandalone(text)) score += 1;
        if (plausible(value, type)) score += 1;
        if (text.length < 20) score += 1;
        return score >= 2; // akzeptiere, wenn mindestens zwei Kriterien passen
    }

    // ------------------------------------------------------------------
    // 🔍 Kern: Extraktionslogik für Anzeigen
    // ------------------------------------------------------------------

    /**
     * Durchsucht ein einzelnes <article>-Element (Anzeige)
     * und versucht, Preis, Fläche, Zimmer, PLZ und Ort zu extrahieren.
     *
     * Es werden mehrere Fallbacks und Regexe eingesetzt, um
     * strukturelle Änderungen auf kleinanzeigen.de zu überleben.
     */
    function extractFromAd(adEl) {
        if (!adEl) return null;

        let price = null;
        let area = null;
        let rooms = null;
        let plz = null;
        let city = null;

        // 1️⃣ Primäre Selektoren (klassisch)
        const priceEl = adEl.querySelector('.aditem-main--middle--price-shipping--price, [aria-label*="Preis"]');
        const areaEl = adEl.querySelector('.aditem-main--bottom span.simpletag');
        const tags = adEl.querySelectorAll('.aditem-main--bottom span.simpletag');

        // 2️⃣ Sekundäre Fallbacks via Textanalyse
        const allSpans = Array.from(adEl.querySelectorAll('span, p'));

        // ---------------------------------------------------------------
        // 💶 Preis extrahieren
        // ---------------------------------------------------------------
        let priceText = priceEl?.textContent || '';
        if (!priceText) {
            const priceCandidate = allSpans.find(el =>
                /[\d.,]+\s*€(?!\w)/.test(el.textContent)
            );
            priceText = priceCandidate?.textContent || '';
        }

        const priceVal = normalizeNumber(priceText);
        if (priceVal && scoreValue(priceText, priceVal, 'price')) {
            price = priceVal;
        }

        // ---------------------------------------------------------------
        // 📏 Fläche (m²) extrahieren
        // ---------------------------------------------------------------
        let areaText = '';
        // Versuche primär simpletag (z. B. "72 m²")
        for (const el of tags) {
            if (/m²/.test(el.textContent)) {
                areaText = el.textContent;
                break;
            }
        }

        if (!areaText) {
            const areaCandidate = allSpans.find(el =>
                /[\d.,]+\s*m²/.test(el.textContent) &&
                looksLikeStandalone(el.textContent)
            );
            areaText = areaCandidate?.textContent || '';
        }

        const areaVal = normalizeNumber(areaText);
        if (areaVal && scoreValue(areaText, areaVal, 'area')) {
            area = areaVal;
        }

        // ---------------------------------------------------------------
        // 🛏️ Zimmer extrahieren
        // ---------------------------------------------------------------
        let roomText = '';
        for (const el of tags) {
            if (/Zi/.test(el.textContent)) {
                roomText = el.textContent;
                break;
            }
        }

        if (!roomText) {
            const roomCandidate = allSpans.find(el =>
                /[\d.,]+\s*Zi/.test(el.textContent) &&
                looksLikeStandalone(el.textContent)
            );
            roomText = roomCandidate?.textContent || '';
        }

        const roomVal = normalizeNumber(roomText);
        if (roomVal && scoreValue(roomText, roomVal, 'rooms')) {
            rooms = roomVal;
        }

        // ---------------------------------------------------------------
        // 📍 PLZ und Ort
        // ---------------------------------------------------------------
        const locCandidate = allSpans.find(el => /\b\d{5}\b\s+[A-ZÄÖÜa-zäöüß.\- ]{2,}/.test(el.textContent));
        if (locCandidate) {
            const match = locCandidate.textContent.match(/(\d{5})\s+([\p{L} .-]+)/u);
            if (match) {
                plz = match[1];
                city = match[2].trim();
            }
        }

        // ---------------------------------------------------------------
        // 📊 Ergebnisobjekt
        // ---------------------------------------------------------------
        return {
            price,
            area,
            rooms,
            plz,
            city,
            id: adEl.getAttribute('data-adid') || null
        };
    }

    // ------------------------------------------------------------------
    // 🧠 Optionale adaptive Erweiterung (Zukunft)
    // ------------------------------------------------------------------
    // Idee: Wenn ein Fallback erfolgreich ist, DOM-Pfad merken und speichern.
    // → GM_setValue('ka_activeSelectors', {...})
    // → künftige Aufrufe priorisieren bekannte funktionierende Selektoren.
    //
    // Diese Funktion ist aktuell als Platzhalter vorbereitet:
    //
    // function learnSuccessfulSelector(type, element) { ... }

    // ------------------------------------------------------------------
    // 📤 Öffentliche API
    // ------------------------------------------------------------------
    return {
        extractFromAd,
        normalizeNumber,
        looksLikeStandalone,
        plausible,
        scoreValue
    };
})();

// ======================================================================
// Beispielnutzung:
// ======================================================================
//
// Und in deinem Hauptskript (z. B. kleinanzeigen-dashboard.js):
//
// // nutzt die spezialisierte Selektor-Logik:
// const data = KASelectorsRental.extractFromAd(articleElement);
//
// console.log(data);
// → { price: 800, area: 72.2, rooms: 2, plz: "26409", city: "Wittmund", id: "3091889498" }
// ======================================================================
