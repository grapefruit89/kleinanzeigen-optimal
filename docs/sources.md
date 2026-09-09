# QUELLEN-REGISTER (2026-09-09)

SSOT für alle vom User gelieferten Quellen. Zweck: keine Quelle doppelt vorwerfen,
jede mit Übernahme-Verdict. Regel: **Neue Quelle → zuerst hier registrieren** (kurz
analysieren oder mit „ungeprüft" markieren), dann ggf. Detail-Arbeit in die anderen
Docs. Querverweise: `docs/kleinanzeigen-api.md`, `ROADMAP.md`, `docs/antipatterns.md`,
`GEMINI.md`.

## Schlüssel-Kategorien

- **Status:** `adoptiert` (übernommen) / `teilweise` / `referenz` (nur als Quelle
  dokumentiert, nicht gebaut) / `abgelehnt` (→ antipatterns.md) / `ungeprüft`
- **Wo-Verweis:** welche Datei/§-Nummer die Erkenntnisse tragen

---

## Verhaltens-Skills

### [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) — multica-ai
- **Status:** adoptiert
- **Übernahme:** Die 4 Prinzipien (Think Before Coding / Simplicity First /
  Surgical Changes / Goal-Driven Execution) als Verhaltensrichtlinien.
- **Wo:** `GEMINI.md` (Verhaltensrichtlinien) + `AGENTS.md` (Pointer)

### [ponytail](https://github.com/DietrichGebert/ponytree) — DietrichGebert *(Korrekter Link: [/skills/ponytail/SKILL.md](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md))*
- **Status:** adoptiert (komprimiert)
- **Übernahme:** Faulheit-als-Disziplin-Leiter (YAGNI → Repo → Stdlib →
  **Plattform-Feature** → Dependency → 1 Zeile), Root-Cause-Bugfix-Regel,
  `ponytail:`-Kommentar-Markierung, Check-mit-liefern, „nicht lazy beim Verstehen".
- **Wo:** `GEMINI.md` (Abschnitt 2b Ponytail)

---

## Kleinanzeigen-Ökosystem

### [kleinanzeigen-bot](https://github.com/Second-Hand-Friends/kleinanzeigen-bot) — Second-Hand-Friends *(via [context7](https://context7.com/second-hand-friends/kleinanzeigen-bot) geliefert)*
- **Status:** teilweise
- **Was es ist:** Python-CLI-Bot, Seller-seitig (publish/update/delete/republish/
  reserve), nodriver-CDP-Automation mit Login — nutzt NICHT unsere Mobile-API.
- **Übernahme:** ① `categories.yaml`-Fund → Immobilien-Kategorie-Referenz (P0-5),
  ② content_hash-Muster = unser Monitoring-Dedup-Vorbild, ③ CAPTCHA-Erfahrung
  (auto_restart + Delay), ④ Chrome-136+-CDP-Hinweis (`--user-data-dir`).
- **Nicht übernommen:** Seller-Lifecycle-Automation (anderer Use-Case), ihre
  Browser-Automation als Datenweg (AP-01/AP-02).
- **Wo:** `docs/kleinanzeigen-api.md` §8 Quellen, §7 Phase 2; ROADMAP P0-5

### [ebay-kleinanzeigen-api](https://github.com/DanielWTE/ebay-kleinanzeigen-api) — DanielWTE
- **Status:** teilweise (Referenz-Sammlung aus früherer Session)
- **Was es ist:** Playwright-Fallback-Scraper + eigene FastAPI-Schnittstelle.
- **Übernahme:** Redirect=gelöscht-Erkennung, Seller-Extraktion-Muster, als
  FastAPI-„Drei-Anbieter"-Referenz für unsere Tool-Parität-Diskussion.
- **Nicht übernommen:** Playwright-Datenweg (AP-02).
- **Wo:** `docs/kleinanzeigen-api.md` §8 Quellen

### [ebay-kleinanzeigen-api-mcp](https://github.com/Sprayer115/ebay-kleinanzeigen-api-mcp) — Sprayer115 *(Fork von DanielWTE)*
- **Status:** teilweise
- **Was es ist:** Echter MCP-Server (FastMCP: stdio + SSE), Playwright-Scraping,
  2 Tools: `search_listings`, `get_listing_details` (inkl. Status
  active/sold/reserved/deleted).
- **Übernahme:** Tool-Schemata + Typen (`types.py`) als Vorbild für McpBridge-v2;
  Status-Erkennung lösen wir via CAPI `ad-status` statt DOM-Badge-Heuristik.
- **Nicht übernommen:** Headless-Server-Modell (AP-02).
- **Wo:** `docs/kleinanzeigen-api.md` §9 McpBridge-v2-Roadmap; ROADMAP P2

### [kleinanzeigen-reader](https://github.com/its-me-prash/kleinanzeigen-reader) — its-me-prash
- **Status:** adoptiert (älteste/wichtigste CAPI-Quelle, aus früherer Session)
- **Übernahme:** `mobile-api.md` (Endpunkt-Map, zwei Auth-Schichten, Gateway-BFF),
  Image-Rules ($_57/$_45/$_59), GTM-Attributfelder, Embedded-Schichten-Extraktion.
- **Wo:** `docs/kleinanzeigen-api.md` §2/§3 durchgehend

### [kleinanzeigen-filter](https://github.com/r-unruh/kleinanzeigen-filter) — r-unruh
- **Status:** adoptiert + Deep-Dive 2026-09-09 (alle 8 src-Dateien gelesen)
- **Übernahme:** TOP-SVG-Glyph (`path[d^="M8.168 13H9.62"]`), data-href/
  stopPropagation, Hydration-Muster → steckt in WasdNavigation/ProAdManager/
  BadgeRemover.
- **Deep-Dive-Verdict (2026-09-09):** Rest = reines DOM, null API. Neu-für-uns:
  ① persistente **per-ad-ID-Blacklist** über Suchen hinweg („gelesen/verworfen"
  markieren, max 10.000 IDs FIFO), ② **Negativ-Keyword-Liste** inkl.
  Seller-Name-Match — bei uns als Chip/Markierung statt Ausblenden
  (Analyse-Statt-Ausblenden-Prinzip), ③ **Fold-with-Stub-UX** (reversibel
  einklappen statt hartem Hide). Kein Mehrwert: Filterlogik selbst (zu dünn),
  kein Storage-Export, kein Re-Scanning neuer Karten. Priorität: **P3**
  (ROADMAP „P3 Schmankerl"-Ergänzung), nur auf User-Wunsch bauen.
- **Wo:** `docs/kleinanzeigen-api.md` §8 Fundus; ROADMAP P3

### Extension-Fundus (installiert in Helium, lokal)
- **Status:** siehe Tabelle
- **Buddy** (egliabllpeghjkodnoedlkcpnmanhgbb, 1.2.5): ⭐ KbAnchors-Pattern
  (3-Strategien-Anker + `diagnose()`-Routine) → als `core/anchors.js`-Härtung
  gebaut/geplant (P2). **Wo:** `docs/kleinanzeigen-api.md` §8 Fundus + Verdicts
- **für Immos** (bojipegcomhjkmbhebabhdofgilpcjcd, 1.0.0): BelenConf-Technik
  adoptiert (§3c → `detail.js`). Erledigt.
- **Plus** (cgailbbhhcmdglfanagajfjffdmbcfoi, 1.0.2): **abgelehnt** (Maps-Embed)
  → `docs/antipatterns.md` AP-17.
- **Filter** (bekmapfnlkhaeopdmhglkanoobnglbhf, 1.0.6): = r-unruh, siehe oben.

---

## Chrome-Plattform-Doku

### [Manifest-Referenz](https://developer.chrome.com/docs/extensions/reference/manifest) — developer.chrome.com
- **Status:** adoptiert
- **Übernahme:** unlimitedStorage / alarms / downloads (P0), sidePanel+
  default_path (P1), `minimum_chrome_version`; Verweigerungen: WAR breit, CSP-
  Override, externally_connectable → AP-05.
- **Wo:** `docs/kleinanzeigen-api.md` §9 Manifest-Umbau; ROADMAP P0/P1

### [chrome-devtools-mcp](https://developer.chrome.com/blog/chrome-devtools-mcp) — ChromeDevTools (Blog + [Repo](https://github.com/ChromeDevTools/chrome-devtools-mcp))
- **Status:** teilweise (Roadmap + Debug-Werkzeug)
- **Übernahme:** Token-Effizienz-Muster für McpBridge-v2 (take_snapshot-Prinzip,
  Pagination, filePath-Offloading, Filter-Parameter, includeSnapshot=false);
  `--browserUrl http://127.0.0.1:9222` = CDP-attach gegen Helium als Debug-Weg
  (Extension-Kategorie-Tools funktionieren im attach-Modus NICHT).
- **Wo:** `docs/kleinanzeigen-api.md` §9 Token-Effizienz-Roadmap; ROADMAP P2+P4

### [WebMCP](https://developer.chrome.com/docs/ai/webmcp) + [secure-tools](https://developer.chrome.com/docs/ai/webmcp/secure-tools) — developer.chrome.com
- **Status:** referenz (komplementär, kein Ersatz)
- **Wichtig:** API heißt `document.modelContext` (unsere erste Probe prüfte
  fälschlich `navigator.modelContext`). Browser-interne Agenten only — kein
  externer Transport, opencode sieht die Tools nicht.
- **Wo:** `docs/kleinanzeigen-api.md` §9 KI-Bridge-Bullet (korrigiert)

### [Extension-Debug-Tutorial](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug) — developer.chrome.com
- **Status:** teilweise (Debug-Wissen)
- **Übernahme (Kernbefunde 2026-09-09):** ① „Inspect views: service worker"
  = eigene SW-DevTools, **Inspect hält den SW wach** (für Idle-Tests schließen!),
  ② roter Errors-Button auf chrome://extensions (nur Runtime-Errors, keine
  Content-Script-Errors), ③ Content-Script-Debugging im Seiten-DevTools mit
  Kontext-Dropdown („top" → Isolated-World), ④ SW-Keep-Alive-Offiziell: aktive
  API-Calls (110+), WebSocket (116+), `chrome.debugger`-Session (118+) — unser
  CDP-Attach ist damit ein legitimierter Alive-Faktor, ⑤ Kontext-Invalidierung:
  `Port.onDisconnect` ist der saubere Erkennungsort (Port-Muster statt try/catch
  als Zukunftsoption), ⑥ Lücken: kein CDP-Attach/Storage-View/alarm-Debugging
  im Tutorial — unsere /tmp/opencode-Helfer bleiben nötig.
- **Wo:** dieses Register (kein Code-Change, Debug-Runbook-Material)

---

### [Scrappa kleinanzeigen_search](https://scrappa.co/docs/kleinanzeigen-api/kleinanzeigen_search) — scrappa.co *(2026-09-09)*
- **Status:** referenz (Schema-Cross-Check) / als Dienst **abgelehnt** (AP-03)
- **Was es ist:** Paid-Scraper-Aggregator ($0.20/1k Requests, 500 Gratis-Credits),
  Positionierung: „Ersatz für die nicht existierende offizielle KA-API" — wir
  haben ja die Mobile-API (gratis, vollständiger).
- **Übernahme:** Kein Code. Nutzwert nur als third-party Cross-Check für
  Feldnamen/Parameter-Interpretation; deren Schema (6 Parameter, flache
  Listings, Preis als String, relative Dates) ist eine **Teilmenge** unserer
  CAPI-Route (nativ: price-Objekte, ISO-Daten, category-IDs, radius, sort,
  shipping/seller).
- **Wo:** dieses Register; kein Eintrag in `docs/kleinanzeigen-api.md` nötig
  (kein Mehrwert über die eigene Route hinaus)

## Verweigerte Quellen (→ antipatterns.md)

| Quelle | Grund | Verweis |
|---|---|---|
| [hideshopkeeperbound/ebay-kleinanzeigen-api-interface](https://github.com/hideshopkeeperbound/ebay-kleinanzeigen-api-interface) | unsicheres Repo (Binary api.dll, auth.enc-Blob, upload-only) | AP-Referenz in `docs/kleinanzeigen-api.md` §8 |
| Apify Store Actors (clearpath, memo23, lowlanddata, unfenced, santamaria) | Bezahl-/Cloud-Modell | AP-03; Schema-Referenz in §8 |
| Playwright/Headless-Server-Modell (Sprayer115, DanielWTE als Datenweg) | AP-02 | — |
| Maps-Embeds (Plus-1.0.2-Pattern) | AP-17, User-Mandat | `docs/antipatterns.md` |
