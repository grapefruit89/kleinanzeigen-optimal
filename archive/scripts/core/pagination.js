// pagination.js
// ======================================================================
// Zweck
// ----------------------------------------------------------------------
// Robuste A/D-Navigation für die Mietwohnungs-Suchergebnisse auf
// kleinanzeigen.de. Die Datei ist als Hilfsmodul gedacht, das du in
// dein Tampermonkey-Hauptskript einbindest.
//
// Highlights:
// - Tastatursteuerung: A = zurück, D = weiter (blockiert sauber am Anfang/Ende)
// - Fallback-Kaskade für "vor" / "zurück":
//     1) echte <a href> Links
//     2) <span data-url> (JS-aktiviert)
//     3) ARIA-/Title-Textsuche ("Nächste"/"Vorherige"/"Zurück")
//     4) URL-Heuristik (ersetzt/fügt /seite:N/ in der aktuellen URL)
// - Ende-Erkennung:
//     * DOM sagt "kein Next" ODER
//     * URL sagt "seite:50" (harte Cap) ODER
//     * "Sanity-Check": Ziel-URL == aktuelle URL (Server lässt nicht weiter)
// - Status-API für dein Dashboard ("Seite X / 50", Buttons aktiv/inaktiv)
//
// Hinweis: Das Modul ist auf /s-wohnung-mieten/* ausgelegt, bleibt aber
// robust, wenn zusätzliche Filter/Parameter in der URL hängen.
// ======================================================================

const KAPagination = (() => {
  // --------------------------------------------------------------------
  // 🔧 Konfiguration
  // --------------------------------------------------------------------
  // Kleinanzeigen limitiert Suchergebnisse serverseitig auf max. 50 Seiten.
  const GLOBAL_PAGE_CAP = 50;

  // Standard-Kategorie-Segment für Mietwohnungen. Wird dynamisch aus der
  // URL extrahiert, dies dient nur als Fallback.
  const DEFAULT_CATEGORY_SEGMENT = 'c203';

  // Default-Hotkeys (kleingeschrieben vergleichen)
  const DEFAULT_KEYS = { prev: 'a', next: 'd' };

  // --------------------------------------------------------------------
  // 🧰 Utilities
  // --------------------------------------------------------------------
  /** Kurzer querySelector */
  function $(sel, root = document) { return root.querySelector(sel); }

  /** Kurzer querySelectorAll als Array */
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  /** Relativ → absolute URL (bezieht aktuelle Seite ein) */
  function toAbsUrl(maybeRelative) {
    if (!maybeRelative) return null;
    try { return new URL(maybeRelative, window.location.href).href; }
    catch { return null; }
  }

  /** Doppelte Slashes im Pfad vermeiden (kosmetisch & robust) */
  function normalizePathname(pathname) {
    return pathname.replace(/\/{2,}/g, '/');
  }

  /** Aktuelle Seiten-URL als String */
  function getCurrentUrl() { return window.location.href; }

  /**
   * Aktuelle Seitennummer aus URL lesen.
   * - Seite 1 kann ohne "/seite:1" kodiert sein → default 1
   */
  function getCurrentPageFromUrl() {
    const m = getCurrentUrl().match(/\/seite:(\d+)\b/);
    if (m) {
      const n = parseInt(m[1], 10);
      return Number.isFinite(n) ? n : 1;
    }
    return 1;
  }

  /**
   * Kategorie-Segment aus der URL extrahieren (z. B. "c203", "c203l1234").
   * - Beispiel: /s-wohnung-mieten/seite:3/c203l1234 → "c203l1234"
   * - Fallback: DEFAULT_CATEGORY_SEGMENT
   */
  function getCategorySegmentFromUrl() {
    const m = getCurrentUrl().match(/\/(c\d{3,5}[a-z0-9-]*)\b/i);
    return m ? m[1] : DEFAULT_CATEGORY_SEGMENT;
  }

  /**
   * Ziel-URL für eine bestimmte Seitennummer bauen.
   * - Ersetzt vorhandenes "/seite:N"
   * - Oder fügt "/seite:N" direkt vor das Kategorie-Segment ein
   * - Query & Hash bleiben erhalten
   */
  function composeUrlWithPage(targetPage) {
    const u = new URL(getCurrentUrl());
    u.pathname = normalizePathname(u.pathname);

    const hasPage = /\/seite:\d+\b/.test(u.pathname);
    const cat = getCategorySegmentFromUrl();

    if (hasPage) {
      // Vorhandenen Seitenmarker ersetzen
      u.pathname = u.pathname.replace(/\/seite:\d+\b/, `/seite:${targetPage}`);
    } else {
      // Kein Seitenmarker: "/seite:N" vor Kategorie-Segment einschieben
      if (u.pathname.includes(`/${cat}`)) {
        u.pathname = u.pathname.replace(`/${cat}`, `/seite:${targetPage}/${cat}`);
      } else {
        // Sicherheitsfallback: am Ende anhängen (falls Pfad ungewöhnlich ist)
        u.pathname = normalizePathname(`${u.pathname.replace(/\/$/, '')}/seite:${targetPage}`);
      }
    }
    return u.href;
  }

  /**
   * URLs vergleichen (pfad-normalisiert, Query & Hash müssen übereinstimmen).
   * - Ignoriert trailing Slashes im Path
   */
  function isSameUrl(a, b) {
    if (!a || !b) return false;
    try {
      const A = new URL(a, location.href);
      const B = new URL(b, location.href);
      const ap = A.pathname.replace(/\/+$/, '');
      const bp = B.pathname.replace(/\/+$/, '');
      return (ap === bp) && (A.search === B.search) && (A.hash === B.hash);
    } catch {
      return a === b;
    }
  }

  // --------------------------------------------------------------------
  // 🧭 DOM-Fallbacks (Links finden)
  // --------------------------------------------------------------------
  /** href oder data-url unabhängig vom Tag auslesen */
  function getHrefLike(el) {
    if (!el) return null;
    return el.getAttribute?.('href') || el.dataset?.url || null;
  }

  /** Beste verfügbare "Nächste"-URL aus dem DOM ermitteln (mit Fallbacks) */
  function findNextUrlFromDom() {
    // 1) klassischer Link
    let el = $('.pagination-next[href]');
    if (el) return toAbsUrl(el.getAttribute('href'));

    // 2) data-url auf <span> (JS-aktivierte Pagination)
    el = $('.pagination-next[data-url]');
    if (el) return toAbsUrl(el.dataset.url);

    // 3) ARIA-/Titel-Fallback (robust bei Redesigns)
    el = $('[aria-label*="Nächste" i], [title*="Nächste" i]');
    if (el) return toAbsUrl(getHrefLike(el));

    // 4) generischer "not-linked"-Fallback
    el = $all('.pagination-not-linked').find(e =>
      e.classList.contains('pagination-next') ||
      /nächste/i.test(e.title || '') ||
      /nächste/i.test(e.textContent || '')
    );
    if (el) return toAbsUrl(getHrefLike(el));

    // 5) nichts Konkretes im DOM gefunden
    return null;
  }

  /** Beste verfügbare "Vorherige"-URL aus dem DOM ermitteln (mit Fallbacks) */
  function findPrevUrlFromDom() {
    // 1) klassischer Link
    let el = $('.pagination-prev[href]');
    if (el) return toAbsUrl(el.getAttribute('href'));

    // 2) data-url auf <span>
    el = $('.pagination-prev[data-url]');
    if (el) return toAbsUrl(el.dataset.url);

    // 3) ARIA-/Titel-Fallback
    el = $('[aria-label*="Vorherige" i], [title*="Zurück" i], [title*="Vorherige" i]');
    if (el) return toAbsUrl(getHrefLike(el));

    // 4) nichts Konkretes im DOM gefunden
    return null;
  }

  // --------------------------------------------------------------------
  // 🧱 Ende-/Anfangserkennung (DOM & URL kombiniert)
  // --------------------------------------------------------------------
  /** DOM-Signal: gibt es (irgendeine Form von) "Next"? */
  function domSaysHasNext() {
    return !!(
      $('.pagination-next[href]') ||
      $('.pagination-next[data-url]') ||
      $('[aria-label*="Nächste" i], [title*="Nächste" i]') ||
      $all('.pagination-not-linked').some(e =>
        e.classList.contains('pagination-next') ||
        /nächste/i.test(e.title || '') ||
        /nächste/i.test(e.textContent || '')
      )
    );
  }

  /** DOM-Signal: gibt es (irgendeine Form von) "Prev"? */
  function domSaysHasPrev() {
    return !!(
      $('.pagination-prev[href]') ||
      $('.pagination-prev[data-url]') ||
      $('[aria-label*="Vorherige" i], [title*="Zurück" i], [title*="Vorherige" i]')
    );
  }

  /** Harte Cap (50) erreicht? */
  function isAtGlobalCap() {
    return getCurrentPageFromUrl() >= GLOBAL_PAGE_CAP;
  }

  /** Sicher am Anfang? (Seite 1 oft ohne /seite:1 + DOM sagt "kein Prev") */
  function isAtFirstPage() {
    const p = getCurrentPageFromUrl();
    return p <= 1 || !domSaysHasPrev();
  }

  /**
   * Ende erreicht?
   * - Kein DOM-"Next"
   * - ODER harte Cap (50)
   * - ODER Sanity-Check: "next" wäre identisch mit aktueller URL
   */
  function isAtEnd() {
    if (!domSaysHasNext()) return true;
    if (isAtGlobalCap()) return true;

    const current = getCurrentUrl();
    const intended = composeUrlWithPage(getCurrentPageFromUrl() + 1);
    if (isSameUrl(current, intended)) return true;

    return false;
  }

  // --------------------------------------------------------------------
  // 🚪 Navigation (URL bestimmen & gehen)
  // --------------------------------------------------------------------
  /** Nächste URL bestimmen (DOM → Heuristik); null, wenn blockiert */
  function getNextUrl() {
    const domUrl = findNextUrlFromDom();
    if (domUrl) return domUrl;

    // Heuristik: current + 1
    const nextUrl = composeUrlWithPage(getCurrentPageFromUrl() + 1);
    if (isSameUrl(nextUrl, getCurrentUrl())) return null; // kein Fortschritt
    return nextUrl;
  }

  /** Vorherige URL bestimmen (DOM → Heuristik); null, wenn blockiert */
  function getPrevUrl() {
    const domUrl = findPrevUrlFromDom();
    if (domUrl) return domUrl;

    // Heuristik: current - 1 (Seite 1 ist Sonderfall)
    const p = getCurrentPageFromUrl();
    const prevTarget = Math.max(1, p - 1);
    let prevUrl = composeUrlWithPage(prevTarget);

    // Spezial: Seite 1 kann ohne "/seite:1" kodiert sein → probiere Basis
    if (prevTarget === 1 && isSameUrl(prevUrl, getCurrentUrl())) {
      const u = new URL(getCurrentUrl());
      u.pathname = u.pathname.replace(/\/seite:1\b/, '');
      prevUrl = u.href;
    }
    if (isSameUrl(prevUrl, getCurrentUrl())) return null; // kein Fortschritt
    return prevUrl;
  }

  /** Sichere Navigation ausführen; false, wenn blockiert */
  function go(url) {
    if (!url) return false;
    if (isSameUrl(url, getCurrentUrl())) return false;
    window.open(url, '_self');
    return true;
  }

  function goNext() { return go(getNextUrl()); }
  function goPrev() { return go(getPrevUrl()); }

  // --------------------------------------------------------------------
  // ⌨️ Hotkeys (A/D)
  // --------------------------------------------------------------------
  let _keys = { ...DEFAULT_KEYS };
  let _onKeydownBound = null;

  /**
   * Keydown-Handler: A = zurück, D = weiter
   * - ignoriert Eingabefelder
   * - blockiert am Anfang/Ende
   */
  function onKeydown(e) {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.isComposing) return;

    const key = (e.key || '').toLowerCase();
    if (key === _keys.prev) {
      const ok = goPrev();
      if (!ok) console.info('[NAV] Anfang erreicht oder kein gültiger Prev-Link.');
    } else if (key === _keys.next) {
      if (isAtEnd()) {
        console.info('[NAV] Ende erreicht – D ist „tot“.');
        return;
      }
      const ok = goNext();
      if (!ok) console.info('[NAV] Kein Fortschritt möglich – D blockiert.');
    }
  }

  /**
   * Hotkeys aktivieren.
   * @param {{prev?: string, next?: string}} [keys] - Optionale Key-Overrides
   */
  function attachHotkeys(keys) {
    if (keys && typeof keys === 'object') {
      _keys = {
        prev: (keys.prev || DEFAULT_KEYS.prev).toLowerCase(),
        next: (keys.next || DEFAULT_KEYS.next).toLowerCase()
      };
    }
    if (_onKeydownBound) return; // schon aktiv
    _onKeydownBound = onKeydown.bind(null);
    document.addEventListener('keydown', _onKeydownBound, false);
    console.log(`[NAV] A/D Navigation aktiv. (prev="${_keys.prev}", next="${_keys.next}")`);
  }

  /** Hotkeys deaktivieren. */
  function detachHotkeys() {
    if (_onKeydownBound) {
      document.removeEventListener('keydown', _onKeydownBound, false);
      _onKeydownBound = null;
      console.log('[NAV] A/D Navigation deaktiviert.');
    }
  }

  // --------------------------------------------------------------------
  // 📊 Status für Dashboard / Debug
  // --------------------------------------------------------------------
  /**
   * Statusobjekt für UI/Debug:
   * { page, atStart, atEnd, nextUrl, prevUrl }
   */
  function getStatus() {
    const page = getCurrentPageFromUrl();
    return {
      page,
      atStart: isAtFirstPage(),
      atEnd: isAtEnd(),
      nextUrl: getNextUrl(),
      prevUrl: getPrevUrl()
    };
  }

  // --------------------------------------------------------------------
  // 📤 Öffentliche API
  // --------------------------------------------------------------------
  return {
    // Status/Abfragen
    getStatus,
    getCurrentPageFromUrl,
    isAtFirstPage,
    isAtEnd,

    // URL-Ermittlung
    getNextUrl,
    getPrevUrl,

    // Navigation
    goNext,
    goPrev,

    // Hotkeys
    attachHotkeys,
    detachHotkeys
  };
})();
//
// ======================================================================
// Einbindung ins Hauptskript (z. B. "kleinanzeigen-dashboard.js"):
// ----------------------------------------------------------------------
//
// // 1) Hotkeys aktivieren (optional: eigene Tasten vergeben)
// KAPagination.attachHotkeys({ prev: 'a', next: 'd' });
//
// // 2) Status für HUD/Buttons nutzen
// const { page, atStart, atEnd, nextUrl, prevUrl } = KAPagination.getStatus();
// console.log(`Seite ${page} / 50`, { atStart, atEnd, nextUrl, prevUrl });
//
// // 3) Manuelles Navigieren (z. B. aus einem UI-Button)
// // <button id="ka-next">Weiter</button>
// document.getElementById('ka-next')?.addEventListener('click', () => {
//   if (!KAPagination.isAtEnd()) KAPagination.goNext();
// });
//
// // <button id="ka-prev">Zurück</button>
// document.getElementById('ka-prev')?.addEventListener('click', () => {
//   if (!KAPagination.isAtFirstPage()) KAPagination.goPrev();
// });
//
// // 4) Hotkeys wieder deaktivieren (z. B. auf anderen Seiten)
// // KAPagination.detachHotkeys();
//
// ======================================================================
