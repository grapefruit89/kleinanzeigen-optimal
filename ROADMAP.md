# ROADMAP — Kleinanzeigen Rental Analyzer

Geführt seit 2026-09-09. Detail-SSOT mit Begründungen/Quellen: `docs/kleinanzeigen-api.md`
(§7 Phase 2, §9 Roadmaps). Priorität = empfohlene Abarbeitungsreihenfolge.

## P0 — Sofort-Wins ✅ ERLEDIGT + live verifiziert (Commits 5c25989/7889b82, 2026-09-09)

| # | Was | Warum |
|---|---|---|
| 1 | `manifest.json`: `unlimitedStorage` | hebt 10MB-Quota auf — `ka_recorder` (300 Full-Ads, nie geräumt) ist der größte Speicher-Hebel |
| 2 | `manifest.json`: `alarms` + TTL-Cleanup im SW | `ka_recorder` 7 Tage nach Download löschen, `ka_enrich_cache`-Ablauf — SW stirbt nach 30 s, Alarms wecken ihn |
| 3 | `manifest.json`: `downloads` | `chrome.downloads.download()` statt Blob+a.click in AdRecorder/DataExport (Ponytail Stufe 4) |
| 4 | McpBridge-Härtung | Token nicht mehr per console.log (`index.js:25`), `ws.close()` bei Unload |
| 5 | `categories.yaml` aus kleinanzeigen-bot auswerten | Kategorie-ID-Mapping (z. B. Verleihen 272/274) für `categoryOf()` statt Raterei |

## P1 — SidePanel als Zentrale (nächster großer Step)

Extension-UI aus den Seiten-Widgets (AdRecorder, DataExport-Box, RentalAnalyzer-
Dashboard, InPageMenu) in eine dauerhafte Chrome-Spalte (`chrome.sidePanel`).
Fixt Kontext-Tod, seitenunabhängiges Aufnehmen, EIN Ort für Feature-Schalter.
Details: `docs/kleinanzeigen-api.md` §9-Tabelle. Mit dabei: `commands`-Shortcut,
`minimum_chrome_version: 151`, Popup-Retirement.

## P2 — McpBridge v2: Extension als MCP-Server für Agenten ✅ ERLEDIGT (v2.1, Commit 7889b82, E2E verifiziert)

`core/anchors.js` (KbAnchors-Muster) ebenfalls erledigt — live verifiziert auf
Suchseiten; Detailseiten-Check offen (blockiert durch KA-Hydration-Bug, siehe
docs/kleinanzeigen-api.md §„Incident", nach KA-Fix nachholen).

User-Vision: laufende Extension per Menüeintrag (`feature_McpBridge`) als Endpunkt,
an dem Coding-Agents (opencode) Kleinanzeigen nutzen. Schritte:

1. **JSON-RPC 2.0 über den WS** (`initialize`/`tools/list`/`tools/call`) — heute:
   eigenes Mini-Protokoll, nur `get_html`
2. **Tool-Set**: `ka_search`, `ka_get_ad` (Vorbild: Sprayer115-Fork) + KAApi-Parität
   (sellerProfile, sellerAds, categories, locations)
3. **Token-Effizienz-Design** (siehe unten) — in die Tool-Definitionen ab Schritt 1
   eingebaut, nicht nachträglich
4. **WS↔MCP-Adapter** (kleiner lokaler Prozess, WS ↔ stdio) für opencode-Anbindung
5. Komplementär, kein Ersatz: **WebMCP** für browser-interne Agenten (nur wenn
   Origin Trial stabil; Probe in Helium: `document.modelContext` + Flag
   `#enable-webmcp-testing` — unsere alte `navigator.modelContext`-Probe war das
   falsche Objekt!)

**Token-Effizienz-Regeln für die Tools** (Vorlage: chrome-devtools-mcp, justbetter-mcp):
- `get_page({format: "snapshot"|"text"|"html"})`, Default `snapshot` — nie wieder
  Voll-outerHTML-Dumps
- `fields`-Selektor pro Tool (`ka_search(fields=[...])`), List-vs-Detail-Split
- Truncation + Continue-Handle für Beschreibungen (500 chars + `next_offset`)
- Pagination (`pageIdx`/`pageSize`) auf ka_search/sellerAds/rental_db-Views
- `batch_call`: Suche + N Ads + Seller-Profile in EINEM Round-Trip
- Filter-Parameter statt Vorfilter-Nacharbeit; Character-Budgets als Contract
  (Name ≤30, Description ≤500, Output-Teaser ≤1.5k)

## P3 — Phase-2-Features (Daten-Intelligenz)

| # | Was | Stand |
|---|---|---|
| 1 | Preis-Historie: `originalPrice` live verifizieren (rabattierte Anzeige) + eigenes Snapshot-Tracking | Feld gebaut, gegen echte Anzeige unverifiziert |
| 2 | Query-Splitting über den 1.250er-Cap | Shards nach Kategorie/PLZ/Preisband, Dedup |
| 3 | Datums-Fenster (`daysOld`) | client-side Filter auf `startDateTime` |
| 4 | Verkäufer-Inventar (`userInventorySearch`-Flag) | Endpunkt existiert vermutlich, zu verifizieren |
| 5 | Monitoring-Mode | Baseline-Dedup + contentHash, kleinanzeigen-agent.de zeigt Nachfrage (Webhooks) |
| 6 | Messaging-API (Chats) | Session-Moat: User-Bearer via `gateway.kleinanzeigen.de/auth/{login,refresh}` minten; ToS-/Rate-Risiken benannt — **bewusst zuletzt** |

## P4 — Schmankerl

- kleinanzeigen-filter/Feinanzeigen-Extension-Fundus inspizieren (Abschau-Technik)
- chrome-devtools-mcp als Debug-Werkzeug JETZT nutzen (SW-Console, CAPI-Network)
  — dreht die Bridge-Frage um: erst debuggen damit, dann selbst Server sein
- **aus kleinanzeigen-filter-Deep-Dive (2026-09-09), nur auf Wunsch:**
  per-ad-ID-Blacklist („gelesen/verworfen" persistent, FIFO-Cap) +
  Negativ-Keyword-Markierung als Chip statt Ausblenden + Fold-with-Stub-UX
  (reversibel) — Details: `docs/sources.md` r-unruh-Eintrag

## Nicht geplant (bewusst)

Vollständige Verweigerungsliste mit Begründung + Rückhol-Triggern:
**`docs/antipatterns.md`** (16 Anti-Patterns, AP-01 bis AP-16). Kurzfassung:

- Playwright/Headless-Server-Modell à la Sprayer115 — unser realer Browser + CAPI
  ist robuster
- externer Cloud-Dienst / Apify-Käufe — alles in der Extension
- DOM-Scraping als Datenquelle (nur noch Anker) — CAPI liefert, was DOM nie hatte
- Credentials in chrome.storage — Session-Moat statt Login-Store
- Felsen-Features mit Toggle / Features am FeatureManager vorbei — Mandate
- Angriffsflächen-Permissions (externally_connectable, breites WAR, CSP-Override)
- Absolutzahlen-Betrugsflags, Dezimalpreise, Bilder in Exporten — entschärft/verboten
