# Kleinanzeigen Mobile-API — Feld-API statt DOM-Scraping

> Discovery 2026-09-09, live verifiziert per `curl` vom lokalen Rechner
> (ohne Login-Session). Quellen am Ende. Ergänzt die mydealz-Methodik
> (Drei-Quellen-Schichten: API → SSR-Payload → DOM).

## 1. Was die API ist

`api.kleinanzeigen.de/api` ist die **Mobile-API der Android-App** — dieselbe
Schnittstelle, die die offizielle App nutzt. Sie braucht für Lese-Pfade
**keine Login-Session**, nur statische App-Credentials:

```http
GET https://api.kleinanzeigen.de/api/ads.json?q=wohnung&page=0&size=2
Authorization: Basic YW5kcm9pZDpUYVI2MHBFdHRZ     # "android:TaR60pEttY"
User-Agent: okhttp/4.10.0
```

Die Credentials sind öffentlich dokumentiert (App-APK, Community-Gists).
Kleinazenzen **throttelt** diese API, blockt sie aber nicht (die Profi-
Scraper fahren Datacenter-Proxies durch, ohne CAPTCHA-Kämpfe).

## 2. Endpunkte (verifiziert)

### 2a. Zwei Auth-Schichten (ECG-Schema, Quelle: kleinanzeigen-reader/mobile-api.md)

| Schicht | Header | Wofür |
|---|---|---|
| App-Identität | `Authorization: Basic <app-cred>` | **jeder** Call — in der App-Binary verdrahtet |
| User-Identität | `X-ECG-Authorization-User: Bearer <token>` | nur Account-private Calls (eigene Anzeigen, Watchlist, Conversations) |
| Kontext | `X-ECG-USER-AGENT`, `X-ECG-USER-VERSION`, `X-ECG-IN` | App-Version/Locale |

**401 heißt: Basic-Header fehlt** — kein Rate-Limit, kein Captcha.

Der **Session-Moat** für User-Calls: `gateway.kleinanzeigen.de/auth/{login,refresh}`
minted den Bearer aus Cookie + CSRF (so macht es die *Kleinanzeigen-Enhanced*-
Extension — sie läuft im eingeloggten Browser und braucht kein App-Secret).

### 2b. Public-Read-Endpunkte (nur App-Auth — die fetten)

| Endpunkt | Liefert | Verifiziert |
|---|---|---|
| `GET /api/ads.json` | Suche: `q`, `page` (0-basiert), `size` (**max 41/page**), `_in` (Feldselektor), `pictureRequired`, `includeTopAds`, `buyNowOnly`, Sortierung (`DATE_DESCENDING` …) | ✅ 2026-09-09 |
| `GET /api/ads/{id}.json` | Detail: Beschreibung, GPS, Seller (Rating/Badges/Telefon), Attribute, Bilder | ✅ 2026-09-09 |
| `GET /api/ads/seller-other-ads/{adId}.json` | **Weitere aktive Anzeigen desselben Verkäufers** — auch für PRIVATE (nicht nur /pro-Stores). Betrugserkennung: Portfolio-Muster | ✅ 2026-09-09 |
| `GET /api/ads/similar/{adId}.json` | Algorithmisch ähnliche Anzeigen | 🟡 App-Schema |
| `GET /api/users/public/{userId}/profile.json` | **Öffentliches Verkäuferprofil**: Name, Registrierung, Ratings, Badges — PLUS `counters {historicalAds, onlineAds, followers}` und `replyIndicators {replyRate, replySpeed}` (live: 151 historische vs. 17 online-Anzeigen = Gewerblich-im-Privat-Gewand-Signal!) | ✅ 2026-09-09 |
| `GET /api/v2/counters/ads/vip/{adId}` | **View-Counter** einer Anzeige → `{"adId": "…", "value": N}`; alternativ Web-XHR `s-vac-inc-get.json?adId=` → `{"numVisits": N}` | ✅ 2026-09-09 |
| `GET /api/v2/counters/ads/watchlist` | Watchlist-Zähler (Nachfragesignal) | 🟡 App-Schema |
| `GET /api/ads/metadata/{catId}.json` · `search-metadata/{catId}.json` | Attribut-Schema pro Kategorie (dynamische Filter) | 🟡 App-Schema |
| `GET /api/categories.json` · `locations.json` · `locations/{id}.json` | Referenzbäume | 🟡 App-Schema |
| `commercial-policy-service/v1/public/profile/{userId}` · `/v1/imprint` | Gewerbe-Impressum | 🟡 App-Schema |
| `loyalty-service/public/top-traders/{userId}/super-badge` | Top-Trader-Badge | 🟡 App-Schema |
| `manufacturer-service/v1/manufacturers` | Fahrzeug-Herstellerkatalog | 🟡 App-Schema |

**Ohne App-Auth, nur Web-XHR:** View-Counter auch via
`GET https://www.kleinanzeigen.de/s-vac-inc-get.json?adId={id}`
(Header `X-Requested-With: XMLHttpRequest`) → `{"numVisits": N}`.
Signal: **hohe Views + alte `creationDate` = überteuert/verstaubt** → Verhandlungshebel.

### 2c. Account-privat (eigener Bearer) — nur das eigene Konto

`users/{userId}/ads.json`, `ads/paused/{adId}.json`, `ad-drafts`,
`watchlist.json`, `savedsearches`, `following`, `feed`, `conversations`,
Account-Management. Write-Verbs sind an den Token-Owner gebunden — Automatisierung
**eigener** Anzeigen ist der legitime Pfad. Fremde paused/deleted/draft-Anzeigen
sind a priori 403 (kein öffentlicher Pfad; gelöschte Anzeigen nur via Wayback
Machine/Suchmaschinen-Cache rekonstruierbar).

### 2d. Gateway-Microservices (BFF)

`gateway.kleinanzeigen.de/`: `biz-subscription-service/*`, `inventory-tree-service/`,
`bing-ad-search/`, `liberty/delivery|reporting/` — Pro-Seller/Billing-Plumbing,
selten für Listen-Daten nützlich. | Verifiziert als Host: ✅ (tauchte im Web-Audit auf)

### Paramter-Notizen

- **`_in`-Param wählt FELDER aus** — z. B. `_in=title,ad-address.state,price`
  spart massiv Payload. Feldnamen s. §3.
- **`includeTopAds`**: TOP-Anzeigen ein-/ausschließen (sponsoring).
- **Cap:** Jede Suche liefert max. **~1.250 Ergebnisse = 50 Seiten** — mehr
  gibt die Site serverseitig nicht her. (Deshalb: DataExport `maxPages` hart
  auf 50 gedeckelt; Profi-Scraper splitten breite Suchen nach Kategorie/
  Preisband und deduplizieren über Shards.)

### Antwortformat (JAXB-Envelope)

Die API antwortet im XML-Schema-JSON-Format: Keys tragen den Namespace-
Prefix und jedes Feld ist in `{"value": …}` gewickelt:

```json
{
  "{http://www.ebayclassifiedsgroup.com/schema/ad/v1}ads": {
    "value": { "ad": [ { "title": { "value": "…" }, "price": { "value": 1750 } } ] }
  }
}
```

Nervig, aber trivial zu normalisieren — siehe `core/kaApiNormalize.js`
(`unwrapValue()` entkleidet rekursiv).

## 3. Feldinventar (aus der Detailantwort, live gezogen)

| Feldgruppe | Felder | Gegenstück im DOM-Scraping |
|---|---|---|
| **Preis** | `price` → amount, currency, `price-type` | `parsePrice()`-Heuristik |
| **Adresse** | `ad-address` → state, zip-code, street, house-number | PLZ-Regex auf `<span>` |
| **GPS** | `locations.location[0]` → **latitude, longitude, radius** | ❌ nicht möglich |
| **Seller** | `user-id`, `seller-account-type`, `contact-name`, `phone`, `user-rating.averageRating`, `userBadges[]`, `user-since-date-time` | nur Badge-Text |
| **Attribute** | `attributes.attribute[]` → name, localized-label, values | m²/PLZ-Regex-Heuristik |
| **Zeit** | `start-date-time`, `last-user-edit-date`, `creationDate`/`activationDate` (App-Modell) | `#viewad-extra-info` (Datum-Regex) |
| **Preisreduktion** | `originalPrice`/`originalPriceInCents`, `PriceReduction`/`PriceChanged` | ❌ nicht im DOM |
| **Status-Lifecycle** | `status`: ACTIVE · PAUSED · **RESERVED** · EXPIRED · DELETED · BLOCKED (+RESERVED-Message-Felder) | nur ACTIVE sichtbar |
| **Gewerbe** | `imprint`, `storeId` (→ `api/stores/{storeId}`), `full-address` | nichts |
| **Text** | `title`, `description` | `#viewad-description` (Detail-Fetch!) |
| **Medien** | `pictures` (5 Auflösungen), `documents`, `medias` | 1 Bild aus `<img src>` |
| **Kategorie** | `category` (id, localized-name) | nichts |
| **Flags** | `ad-type` (OFFERED/WANTED), `buy-now`, `features-active` | nichts |

### Preis-Typ-Vokabular (normiert)

Das Vokabular der API (raw) gemappt auf das der Profi-Scraper
(unfenced-group/lowlanddata Output-Schemas):

| API raw | Normiert | Bedeutung |
|---|---|---|
| (Betrag) + negotiable | `MIN_BID` | „200 € VB" |
| (Betrag) fest | `FIXED` | „200 €" |
| `FREE` | `GIVEAWAY` | „Zu verschenken" |
| `PLEASE_CONTACT` / `CHAT_ONLY` | `SEE_DESCRIPTION` | „auf Anfrage" |
| (kein Betrag) | `SEE_DESCRIPTION` | VB ohne Zahl → `FAST_BID` im DOM-Fall |

`isWanted` = `ad-type === "WANTED"` (Gesuch statt Angebot) — im DOM nicht
erkennbar.

**Namensvarianten:** Das App-Modell nennt die Typen
`FIXED / NEGOTIABLE / GIVE_AWAY / ON_REQUEST`, die JAXB-API antwortet mit
`PLEASE_CONTACT / FREE` etc. — `kaApiNormalize.js` mappt beides auf das
normierte Vokabular oben. Token-Ersatz: `ON_REQUEST ≙ PLEASE_CONTACT ≙ SEE_DESCRIPTION`,
`GIVE_AWAY ≙ FREE ≙ GIVEAWAY`.

## 3b. Embedded-Schichten im Listen-HTML (redesign-sicher, kein DOM-Scraping)

Kleinanzeigen bettet Strukturdaten **dreifach** in jede Anzeige ein
(Quelle: kleinanzeigen-reader `extractor.py` + `references/ad-attributes-fields.md`):

1. **Schema.org JSON-LD** — SEO-Pflicht, geht nie weg: Titel, Preis, Hauptbild
2. **`ad_attributes`-GTM-String** — Pipe-Format `"km:380001|ezdate:2005-03|tuevdate:2026-06|power:163|fuel:diesel|shift:manuell|marke:bmw|…"`
   → komplette Attributtabelle aus dem Tracking-Layer
3. **DFP/GTM-Bidder-Block** — `"ExactPreis"`, `"Kilometerstand"`, `"Fahrzeugzustand"` etc. als JSON-Strings

**Betrugs-/Qualitätssignale aus den Embedded-Layern:**

- `schaden:t` — Schaden **deklariert**, oft im mobilen UI gar nicht sichtbar!
- `EZ-Datum == Listing-Datum` → Feld leer gelassen (Quirk)
- `tuevdate` ≈ Listing-Monat → TÜV wahrscheinlich abgelaufen/leer
- `km` gerundet (Seller runden auf 1.000/10.000)

(Kleinanzeigen-Reader analysiert daraus automatisch: Dealer-Detection,
Schaden-Flags, Duplikate, TÜV-Grenzfälle — die Signale liegen in
`signals.py` des Repos.)

## 3c. Detailseiten: BelenConf (neue Embedded-Schicht, 2026-09-09 live verifiziert)

`window.BelenConf.universalAnalyticsOpts.dimensions` trägt auf Detailseiten (VIP)
strukturierte Anzeigen-Daten — Preis/Fläche/IDs direkt aus der Tracking-Config:

| Feld | Inhalt | Live-Wert (Beispiel) |
|---|---|---|
| `ad_id` | Anzeigen-ID | `3481022874` |
| `ad_price` | **Preis als Float** | `1150.00` |
| `dimension108` | **Wohnfläche** (`qm_d:`-Regex) | `143.00` |
| `l1/l2_category_id`, `selected_category_name` | Kategoriebaum | `203 / Wohnung_mieten` |
| `l1/l2/l4_location_id`, `selected_location_name` | Ortsbaum | `77749` |
| `user_account_type`, `logged_in`, `user_id` | Session-Kontext | `private / true` |

Robustheits-Kaskade für Preis/Fläche auf Detailseiten (Quelle: Extension
"Kleinanzeigen für Immos", ID bojipegcomhjkmbhebabhdofgilpcjcd):
1. `BelenConf`-dims (`ad_price`, `qm_d:`) — Strukturdaten, redesign-sicher
2. `meta[itemprop="price"]` / `#viewad-price` / `#viewad-details .addetailslist--detail`
   (Label "Wohnfläche" → `.addetailslist--detail--value`)
3. Body-Regex `(\d+) m²` — Notanker

Weiterer Detail-Anker (Quelle: "Kleinanzeigen Plus", ID cgailbbhhcmdglfanagajfjffdmbcfoi):
`#viewad-locality` (PLZ+Ort) + `#street-address` (Straße — Straßen-Daten liegen im DOM!).



| Technik | Wer | Übernahme |
|---|---|---|
| Mobile-API-Reader | clearpath ($45/Monat!), rl1987, monkrel (MIT) | ✅ übernommen (Background-Client) |
| Query-Splitting + Dedup über 1.250er-Cap | lowlanddata, unfenced | TODO (Monitoring-Mode) |
| Monitoring via contentHash/Dedup-Baseline | lowlanddata, clearpath | TODO (Phase 2) |
| „Frontier-Mode" (Anzeigen-IDs zählen site-weit, kein Cache) | monkrel | TODO (Neu-Anzeigen-Sniffer) |
| HTTP-only + Datacenter-Proxy + exp. Backoff | memo23, lowlanddata | ✅ Retry/Backoff im Background-Client |
| Redirect → „Anzeige gelöscht"-Erkennung | DanielWTE (219★) | TODO (Datenqualität) |
| robots.txt-Ehrlichkeit (Radius-URLs + viewCount-Endpoint sind ausgeschlossen) | unfenced, lowlanddata | bewusst einhalten |

## 5. Architektur in der Extension (2026-09-09 eingebaut)

```
Content-Script (DataExport)          Service-Worker (core/background.js)
────────────────────────────         ────────────────────────────────────
KAApi.getAd(id)          ──msg──▶    Rate-Limit-Queue (serial)
KAApi.search(params)     ◀──json──   Retry/Backoff (408/429/5xx transient)
                                     403/404 fatal
core/kaApiNormalize.js  ◀── Daten   500–1000ms Pausen zwischen Requests
(flat schema, Preis-Vokabular)      Cap: 80 Requests / 10 Minuten
                                    200+HTML → erkannter Fehler
```

- `manifest.json`: `host_permissions` um `https://api.kleinanzeigen.de/*`
  erweitert — **nur der Service-Worker** darf CORS-frei auf die API (Content-
  Scripts bleiben bei den Seitenrechten).
- DOM bleibt als **Fallback-Layer 3** (Detail-Fetch + alte Selektoren), falls
  die API ablehnt. DOM-Layer 1 (Karten) bleibt die Basis der Listung.

## 6. Verkäufer-Seller-Schema (was $45/Monat kostet)

Die Detail-API liefert exakt das Feldset, für das `clearpath/
kleinanzeigen-immobilien-api-pro` $45/Monat nimmt: GPS + Seller-Rating +
Badges + Telefon + Registrierung. Wir holen es gratis. (GDPR-Hinweis: die
Felder sind in der Extension-Export-Datei personenbezogen — bewusst drin,
weil lokal im eigenen Browser; nicht ungefiltert weiterverbreiten.)

## 7. Phase 2 (offen)

- **Messaging-API (send/inbox/conversation):** monkrel/kleinanzeigen-api (MIT)
  hat die Chat-Endpunkte bereits implementiert und zeigt die Surface:
  `login` (User-Bearer via App-Credentials + eigene Credentials), `chats`,
  `messages <conversationId>`, `reply <conversationId> "…"`. Für die
  Extension ist der elegantere Pfad der Session-Moat: User-Bearer via
  `gateway.kleinanzeigen.de/auth/{login,refresh}` aus Cookie+CSRF minten
  (Technik der *Kleinanzeigen-Enhanced*-Extension) — dann laufen Chats
  über die gleiche X-ECG-Authorization-User-Schicht. Reddit-Thread
  (r/informatik 1nnmpuv, Sep 2025) bestätigt die Nachfrage: automatisiertes
  Anschreiben beim Wohnungssuchen ist ein Standard-Wunsch — und bestätigt
  die Gegenmaßnahmen-Risiken (Rate-Limits, Heuristiken gegen Automatisierung).
  Apify nimmt dafür $0,49/Nachricht. Eleganter Pfad: `gateway.kleinanzeigen.de/auth/{login,refresh}`
  minted den User-Bearer aus Cookie+CSRF (Technik der *Kleinanzeigen-Enhanced*-Extension).
- **Seller-Portfolio-Analyse:** `api/ads/seller-other-ads/{adId}.json` (public!)
  — Betrugsmuster: Händler tarnt sich als Privat, Anzeigenstapel,
  Standort-Cluster über GPS prüfbar.
- **Nachfrage-/Verhandlungs-Signale:** View-Counter (`s-vac-inc-get.json` oder
  CAPI-Counter) + `creationDate` → überteuert/verstaubt; Watchlist-Counter
  als Demand-Signal.
- **Preis-Historie:** `originalPrice` (ein Schritt) + eigenes Snapshot-Tracking
  (RentralAnalyzer-`rental_db`-Muster) für die volle Kurve.
- **Deal-Score-Heuristik (Octoparse-Pattern):** Angebote >20 % unter dem
  Such-Median markieren — RentalAnalyzer rechnet bereits Median/IQR
  (`kaStats`); die Schwelle als Badge („unter Median −20 %") ist ein
  Ein-Zeilen-Add im UI-Layer.
- **Query-Splitting über den 1.250er-Cap** (lowlanddata/unfenced-Muster):
  breite Suchen nach Kategorie/PLZ/Preisband splitten und über Shards
  deduplizieren — sonst wird hinter Seite 50 stillschweigend verloren.
- **Datums-Fenster (`daysOld`/postedAfter/Before):** nur Anzeigen der
  letzten N Tage in Export/Aufnahme (client-side Filter auf
  `startDateTime` — die API liefert die Zeit zuverlässig mit).
- **Verkäufer-Inventar:** `userInventorySearch`-Flag existiert in
  `searchOptions` → es gibt einen Endpunkt für das Inventar eines Verkäufers
  (noch zu verifizieren).
- **Monitoring-Mode:** Baseline-Dedup + contentHash; kleinanzeigen-agent.de
  zeigt die Nachfrage nach Webhooks bei neuen Inseraten.

## 9. ROADMAP: SidePanel als Zentrale (naechster grosser Step)

Quelle: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
Die heutige Extension verteilt UI ueber die Seite (Floating-Widgets: AdRecorder,
DataExport-Box, RentalAnalyzer-Dashboard, HighRes-Overlay, InPageMenu-Sidebar).
Das SidePanel-API (MV3, `chrome.sidePanel`) gibt uns eine **dauerhafte,
an-/abschaltbare Chrome-Spalte** neben jeder KA-Seite — die natuerliche
Zentrale fuer alles, was heute verteilt sitzt:

| In das Panel wandert | Gewinn |
|---|---|
| **RentalAnalyzer-Dashboard** (IQR-Stats, PLZ-Matrix, CSV-Export) | Bleibt sichtbar beim Blättern/Seitenwechsel statt oberhalb der Liste neu zu injizieren; klickt in Matrizen + filtert Karten (postMessage/Storage-Bridge) |
| **AdRecorder** (REC-Status, Sammel-Liste, Seller-Check, Download) | Panel überlebt Seitenwechsel — Aufnahme läuft "begleitend", statt Widget pro Seite neu |
| **DataExport** (Limits, Fortschritt, Ergebnis-Preview) | Stop/Start/Fortschritt ohne DOM-Widget in der Ergebnisliste |
| **rental_db-Ansicht** (Einträge, DB-Hygiene, Export) | Persistente DB-Verwaltung ohne confirm()-Reload |
| **Feature-Schalter** (ersetzt InPageMenu/Popup) | EIN Ort für Opt-ins; Felsen (TrackerBlocker/BadgeRemover/ProAdManager) als gesperrte Zeilen angezeigt |

Technischer Weg:
- `manifest.json`: `"sidePanel": true` (Permission) + `side_panel.default_path`
- `background.js`: `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})`
  — der Toolbar-Button öffnet dann das Panel statt des Popups (Popup kann entfallen)
- `sidepanel/panel.html+js`: rendert aus `chrome.storage.local` (rental_db,
  ka_recorder, ka_settings) — **kein DOM-Injection-Problem, kein Isolated-World-
  Kontext-Tod**: Das Panel lebt in der Extension, nicht auf der Seite
- Seite↔Panel-Bridge: vorhandener `chrome.storage`-Fluss reicht (rental_db wird
  ohnehin persistiert); für Live-Events eine `chrome.runtime.sendMessage`-Linie

Warum dies der naechste grosse Step ist:
1. **Kontext-Tod adé** — das heutige Taeglichkeitsthema (Content-Script-Kontext
   nach Extension-Reload invalidiert) trifft Panel-UI nicht: Panels sind
   extension-owned
2. Aufnahme + Analyse laufen seitenunabhaengig — passt zum Monitoring-Mode (§7)
3. Layout-Drift immun: Panels sind Extension-UI, keine injected widgets mehr
4. InPageMenu-Sidebar (heute document_start-Fix) kann retired werden
- **MCP-Tool-Parität erreicht (2026-09-09):** Alle 10 Tools des bezahlten
  kleinanzeigen-agent-MCP-Servers (kleinanzeigen-agent.de/mcp) sind in der
  Extension abgedeckt — search (KAApi.search), get_ad/status+views (getAd/
  status-Feld/views), seller_profile (sellerProfile), seller_ads (sellerAds),
  categories, category_metadata, category_search_metadata, locations,
  location (Referenz-Endpunkte). Kosten unserer Seite: 0 Credits, nur
  Rate-Discipline; deren Seite: 1–2 Credits/Call. Die 5 Referenz-Endpunkte
  (categories, metadata, search-metadata, top-locations, locations/{id})
  wurden live gegen die CAPI verifiziert (alle HTTP 200).
- **KI-Bridge — kein externer Server nötig (2026-09-09 recherchiert, 2026-09-09
  korrigiert):** Chrome DevTools MCP (offiziell, stabil seit Chrome 149) + **WebMCP**
  (proposed standard, Chromium 149+ Origin Trial, Flag `#enable-webmcp-testing`)
  lösen das "Extension als Tool-Anbieter für Agenten"-Problem — aber mit
  **entscheidender Einschränkung**: WebMCP-Tools sind **nur für browser-interne
  Agenten** sichtbar (Gemini in Chrome, Inspector-Extension) — es gibt **keinen
  externen Transport**, opencode/CDP sieht diese Tools NICHT (Doku: WebMCP
  "omits server-side concepts"). Korrektur zur API: heißt
  **`document.modelContext`** (nicht `navigator.modelContext` — unsere erste
  Helium-Probe prüfte das falsche Objekt!):
  `document.modelContext.registerTool({name, description, inputSchema, execute,
  annotations}, {exposedTo?, signal?})`, Discovery `getTools({fromOrigins?})`,
  `executeTool`, `toolchange`-Event. Gated auf origin-isolated Docs + Permissions-
  Policy `tools` (default `self`). Konsum aus Content-Scripts ist dokumentiert
  ("extensions can query and execute WebMCP tools"); ob REGISTRIERUNG aus der
  isolated world geht (vs. MAIN-World-Injection): unklar → live testen. Security
  (secure-tools): keine per-Tool-Prompts, sondern Annotation-Hints —
  `readOnlyHint`, `untrustedContentHint` (Prompt-Injection-Gegenmittel),
  `consequentialHint: true` = User-Confirmation erzwingen; Character-Budgets
  (Name ≤30, Description ≤500, Output ≤1.5k). Status: Origin Trial (nicht
  stabil), Registrierung ohne AbortCancel-Fix erst ab Chrome 153 — Helium 151
  ist auf OT-Stand. **Fazit: komplementär, kein Ersatz für McpBridge v2** —
  unser WS↔MCP-Adapter bleibt der Pfad für opencode; WebMCP erst wenn OT
  stabil ist. Nächste Schritte: 1) Helium: `typeof document.modelContext` prüfen
  (Flag `#enable-webmcp-testing`), 2) Mini-PoC `ka_search`-Tool (MAIN- vs.
  isolated-world-Test) via Inspector-Extension, 3) McpBridge v2 unabhängig bauen.

### ROADMAP: McpBridge v2 — echter MCP-Server für Agent-Anbindung (2026-09-09, recherchiert)

Vision (User): die laufende Extension öffnet per Menüeintrag (`feature_McpBridge`) einen
lokalen Endpunkt, an dem sich Coding-Agents (opencode & Co.) verbinden und Kleinanzeigen
nutzen können — statt nur `get_html`-Rohdaten.

Stand heute (`features/McpBridge/index.js`):
- Extension = WS-Client zu `ws://127.0.0.1:8765`, Token-Auth pro Message
  (`ka_settings.mcp_bridge_token`), Auto-Reconnect 5 s; Toggle im InPageMenu
- EINE Action: `get_html` (outerHTML der offenen Seite) — keine Suche/Details/Profile
- eigenes Mini-Protokoll, **kein MCP/JSON-RPC** → ein MCP-Client kann nicht direkt verbinden

Zielbild (MCP-kompatibel, nach und nach abarbeiten):
1. **JSON-RPC 2.0 über den WS**: `initialize` / `tools/list` / `tools/call` (MCP-Kern)
2. **Tool-Set anlehnend an Sprayer115/ebay-kleinanzeigen-api-mcp** (MIT): `search_listings`
   (query/location/radius/min-max_price/page) + `get_listing_details` (title, status
   active/sold/reserved/deleted, price, views, images, seller) — **plus unsere KAApi-
   Parität** (sellerProfile, sellerAds, categories, locations), die der Fork nicht hat
3. **Datenquelle bleibt die CAPI** (KAApi), nicht Playwright-Scraping wie der Fork
   (serverseitiger Headless-Browser ist unser Gegenmodell — unser realer Browser + API
   ist robuster gegen Bot-Detection)
4. **Transport**: für Agent-Anbindung fehlt noch ein WS↔MCP-Adapter. Option A: kleiner
   lokaler Adapter-Prozess (WS ↔ stdio-MCP), eintragbar in opencode.json `mcp{}` —
   Option B: WebMCP (siehe oben) sobald Chromium/Helium ihn aktiviert
5. **Härtung**: Token-Bindung an 127.0.0.1 bleibt; Token NICHT mehr per console.log
   ausgeben (heutiger Leak in `index.js:25`); `ws.close()` bei Unload
6. Status-Erkennung (sold/reserved/deleted): bei uns über CAPI `ad-status`-Feld statt
   DOM-Badge-Heuristik (Referenz: Sprayer115-`types.py`)

### ROADMAP: Manifest-Umbau (2026-09-09, offizielle Manifest-Referenz geprüft)

**Sofort-Wins (jeweils 1 Zeile im `manifest.json`):**
1. `"permissions": ["unlimitedStorage"]` — hebt die ~10MB-`storage.local`-Quota auf.
   Größter Speicher-Hebel für `ka_recorder` (300 Full-Ads ohne Räumung) + `rental_db`.
2. `"permissions": ["alarms"]` — TTL-Cleanup (z. B. `ka_recorder` 7 Tage nach Download,
   `ka_enrich_cache`-Ablauf) im Service-Worker per `chrome.alarms`; der SW stirbt nach
   ~30 s, Alarms wecken ihn zuverlässig — kein Content-Script nötig.
3. `"permissions": ["downloads"]` — `chrome.downloads.download()` statt Blob+a.click
   in AdRecorder/DataExport (Ponytail-Stufe 4: Plattform-Feature statt Eigenbau).

**Geplant (mit SidePanel-Umbau, siehe oben):**
- `"sidePanel"`-Permission + `"side_panel": {"default_path": ...}`; `action.default_popup`
  entfällt dann (Toolbar-Button öffnet Panel via `setPanelBehavior`).
- `"commands"` — Keyboard-Shortcut zum Panel-Öffnen (`sidePanel.open()` zählt als
  User-Geste).
- `"minimum_chrome_version": "151"` — schützt vor älteren Chromiums (sidePanel-APIs).

**Bewusst NICHT:**
- `declarativeNetRequestWithFeedback` — Debug-only (unpacked), produktiv weglassen.
- `web_accessible_resources` — haben wir nicht, Content-Scripts brauchen es nicht; falls
  je nötig: nur Origin-exakt + `use_dynamic_url` (Fingerprinting-Angriffsfläche).
- `content_security_policy`-Key — MV3-Default erlaubt WS zu 127.0.0.1 (McpBridge läuft);
  nur bei bewusster Härtung setzen.
- `default_locale` — nur Pflicht mit `_locales/`-Struktur; ohne i18n = Ladefehler.
- `externally_connectable` — Bridge ist WS-Client im SW, keine externe Kommunikation.

Quellen: developer.chrome.com/docs/extensions/reference/manifest (+ /storage,
+ /web-accessible-resources, + /api/sidePanel, + /permissions-list).

### ROADMAP: Token-Effizienz-Design für McpBridge-v2-Tools (2026-09-09, recherchiert)

Vorlage 1: **chrome-devtools-mcp** (offizielles Google-Tool, Apache-2.0, Puppeteer,
stdio, `--browserUrl http://127.0.0.1:9222` = CDP-attach gegen Helium möglich —
Extension-Kategorie-Tools funktionieren aber NICHT im attach-Modus). Vorlage 2:
**justbetter-mcp** (MIT) — löst Input-Bloat (semantische Tool-Retrieval, advertised-
Cap, `batch_call`), aber NICHT Output-Bloat; bei unseren 3–6 Tools kein Problem.
Die übernehmbaren Techniken sind alle im **Output**:

1. **`format`-Parameter statt Voll-Dump** — unser heutiges `get_html`
   (`documentElement.outerHTML`) ist der teuerste mögliche Response. Neu:
   `get_page({format: "snapshot"|"text"|"html"})`, default `snapshot`
   (A11y-Text-Snapshot mit uid-Anchors, Muster: chrome-devtools-mcp `take_snapshot`).
2. **`fields`-Selektor pro Tool** (unser `_in`-Muster aus der CAPI, gedreht zum
   Client): `ka_search(fields=["id","price","title","plz"])` — Detail-Objekte
   nur in `ka_get_ad` (List-vs-Detail-Split, den wir ohnehin fahren).
3. **Truncation + Continue-Handle** für Beschreibungen:
   `description (500 chars) + description_truncated: true + next_offset`.
4. **Pagination überall auf Listen**: `pageIdx`/`pageSize` (Muster:
   `list_network_requests` bei chrome-devtools-mcp) — gilt für ka_search,
   sellerAds, rental_db-Views.
5. **`batch_call`** (justbetter-mcp): „Suche + 3 Ads + Seller-Profile" in EINEM
   Round-Trip statt 3 Turns — biggest Turn-Overhead-Sparer.
6. **Filter-Parameter statt Vorfilter-Nacharbeit**: `resourceTypes`-Art-Filter +
   `includeSnapshot=false` per Default (opt-in, chrome-devtools-mcp-Muster).
7. **Character-Budgets als Tool-Contract** (WebMCP-Empfehlung, siehe oben):
   Name ≤30, Description ≤500, Output-Teaser ≤1.5k Tokens.
8. Nebeneffekt: chrome-devtools-mcp taugt JETZT als Debug-Werkzeug für die
   Extension (SW-Console via `serviceWorkerId`-Filter, Network-Inspektion der
   CAPI-Calls) — dreht die McpBridge-Frage um: erst debuggen damit, dann
   selbst server sein.

## 8. Quellen

### Analyse-Fundus: installierte Kleinanzeigen-Extensions (Helium, 2026-09-09)

| Extension (ID) | Was sie macht | Abschauenswert |
|---|---|---|
| **Buddy** (egliabllpeghjkodnoedlkcpnmanhgbb, 1.2.5) | Seller-Rating/Alter an Karten, Notizen, Ausblenden; Detail-Fetch per `fetch()` + DOMParser | ⭐ **KbAnchors.js-Architektur**: Anker mit 3 Strategien (selektor/struktur/**inhalt**) + `KbAnchors.diagnose()` — Text-basierte Anker („fünfstellige PLZ bleibt PLZ") + Diagnose-Routine, gleiche Methodik wie unsere Header-Doku; `icon-rating-tag-N`-Klasse = Seller-Stufe; "Aktiv seit TT.MM.JJJJ"-Regex; ld+json als Karten-Titel-Quelle; eigenes Cache-Modul |
| **für Immos** (bojipegcomhjkmbhebabhdofgilpcjcd, 1.0.0) | €/m² auf Detailseiten | ⭐ **BelenConf-Technik** (§3c): `qm_d:` aus `dimension108`, `meta[itemprop=price]`, `#viewad-details`-Zeilen — direkt für RentalAnalyzer P0 übernommen |
| **Boost** (gaemgmihcgebiagleakccomamninhmdd, 1.0.1) | Hover-Preview + Zoom + Maps | Dual-Selektoren für Detail-Anker (`#viewad-*` + `.boxedarticle--*`-Fallbacks), Datums-Anker `#viewad-extra-info .icon-calendar-gray-simple + span`, Preview-UX (hover→fetch→DOMParser→popup) |
| **Plus** (cgailbbhhcmdglfanagajfjffdmbcfoi, 1.0.2) | Karte + Datum-Toggle | `#street-address`-Anker (Straße im DOM), Maps-Embed aus PLZ+Straße |
| **Bild-Viewer** (cbpmpfinkejojdnhndpgofocindnmejn, 2.0) | Zip-Download aller Bilder | Trivial (background.js Stub) — unsere API `pictures[]` ist besser |
| **Filter** (bekmapfnlkhaeopdmhglkanoobnglbhf, 1.0.6) | r-unruh/kleinanzeigen-filter | siehe Quellen oben (TOP-SVG-Glyph etc.) |

### Prioritäts-Verdicts je Extension (2026-09-09, nichts blind übernommen)

- **Buddy** → **P2** (der einzige mit echtem Neuwert): Seller-Rating/Alter an Karten
  haben wir via CAPI (besser); Notizen/Ausblenden wären reines UI, aber nicht gefragt.
  Abschau-Kandidat bleibt nur das **KbAnchors-Pattern** (inhalt-basierte Anker +
  `diagnose()`-Routine) — als Härtung für unsere Header-Doku-Methik, nicht als Feature.
- **für Immos** → **erledigt/keine Priorität**: BelenConf-Technik ist bereits
  übernommen (§3c, RentalAnalyzer `detail.js`); Rest des Features ist unser€/m²-Verschnitt.
- **Plus** → **abgelehnt (AP-17, keine Priorität)**: `#street-address`-Anker +
  Maps-Embed aus PLZ+Straße. User-Mandat 2026-09-09: **keine Maps** — weder als
  Feature noch als Schmankerl. GPS aus der CAPI (§3) deckt den Informationsbedarf.
- **Filter** (r-unruh) → **erledigt/keine Priorität**: DOM-Knowledge (TOP-SVG-Glyph,
  data-href/stopPropagation, Hydration-Muster) ist längst in WasdNavigation/
  ProAdManager/BadgeRemover aufgegangen. Filterlogik selbst: kein Bedarf — wir
  analysieren statt wegzufiltern.

### Code-/Doku-Quellen

- Eigene Live-Verifikation 2026-09-09 (`curl`, Basic Auth, ohne Login):
  `/ads.json` (Suchschema) und `/ads/{id}.json` (GPS, Seller-Rating, Badges)
- gist BastelPichi „Ebay Kleinanzeigen API docs" — Basis-Credentials +
  Endpunkte + `_in`-Feldselektor
- **its-me-prash/kleinanzeigen-reader** (MIT, 2026 aktiv) — die umfassendste
  CAPI-Referenz: `references/mobile-api.md` (statische Analyse der Android-App
  v2026.31.2: kompletter Endpunkt-Map, zwei Auth-Schichten, Gateway-BFF,
  Image-Rules empirisch getestet); `references/ad-attributes-fields.md` (GTM-
  Attributfelder inkl. Quirks); `extractor.py` (3 Embedded-Quellen-Extraktion);
  `signals.py` (Schaden-/TÜV-/KM-Signale, PriceTracker, seller_portfolio);
  MCP-Server + Claude-Skill; HTML-only-Scraper ohne Credentials als shipped path
- github.com/monkrel/kleinanzeigen-api (MIT, Python) — Mobile-API-Client,
  `iter_new_ads`/Frontier-Mode (ID-Zählung, Neu-Anzeigen in Sekunden),
  Refresh-Latenz 15–45 s; **inzwischen mit Auth-Endpunkten**: login, chats,
  messages, reply, my-ads, watchlist, pause/activate/delete/extend —
  die Messaging-Phase-2-Surface ist damit offengelegt
- github.com/Second-Hand-Friends/kleinanzeigen-bot (AGPL, 423★, 1.083
  Commits, aktiv) — KLEINEIGENE-Anzeigen-Lifecycle über Browser-Automation
  (nodriver statt Selenium): publish/update/delete/**republish nach Interval**/
  extend (8-Tage-Fenster, hält Watchlist + Monatskontingent)/**reserve+activate**
  (Anzeige aus Suche nehmen, ID/Alter/Views/Watchlist bleiben!)/**content_hash**
  (Change-Detection vor Republish — exakt unser Monitoring-Dedup-Muster),
   Shipping-Options-Inference aus öffentlichem Zustand, workspace-portable/
   XDG-Modes. Eigenes-Konto-Automation ist der legitime Pfad (ToS-Disclaimer
   inklusive). "Related projects"-Liste ist ein kleines Ökosystem-Verzeichnis
   (Discord/Telegram-Watcher, SQL-Scraper, Feinanzeigen-Extension, Kleingäck-Backup)
   — **nutzbar für uns: `categories.yaml`** (Kategorie-ID-Mapping, z. B. Verleihen
   272/274) als Referenz für unsere `categoryOf()`-Logik; CAPTCHA-Erfahrung
   (auto_restart + Delay) und Chrome-136+-CDP-Hinweis (`--user-data-dir` nötig)
   bestätigen unsere Helium-Debug-Praxis
- github.com/DanielWTE/ebay-kleinanzeigen-api (MIT, 219★) — Playwright-Fall-
  back-Muster, Redirect=gelöscht-Erkennung, Seller-Extraktion, eigene FastAPI-
  Schnittstelle über der Seite
- github.com/Sprayer115/ebay-kleinanzeigen-api-mcp (MIT, 5★, aktiv Jul 2026) —
  Fork/Rewrite von DanielWTE als **echter MCP-Server** (FastMCP: stdio + SSE mit
  Bearer-Key), Playwright-Scraping statt API; exponiert nur `search_listings` +
  `get_listing_details` (inkl. Status active/sold/reserved/deleted). Für uns:
  Tool-Schemata + Typen (`types.py`) als Vorbild für McpBridge-v2-Roadmap (§9) —
  Datenweg (Headless-Browser) bewusst NICHT übernommen, unsere CAPI-Route ist besser
- github.com/r-unruh/kleinanzeigen-filter (MIT) — DOM-Knowledge 2026:
  A/B-getestete Layouts (h2 a/h2/h3 a/h3, browsebox-Form-Doppel), TOP-SVG-
  Glyph (`path[d^="M8.168 13H9.62"]`), `waitForElement`-Hydration-Muster,
  ganze Karte klickt via `data-href` (stopPropagation für injizierte UI)
- github.com/VincentGerard/Ebay-Web-Scrapper (Python, 2022) — historische
  DOM-Scraper-Basis (alte `.aditem`-Ära, nützlich als Drift-Referenz)
- github.com/jkopka/price_tracker_cli (C#, 2020) — Median-preis-einer-Suche:
  der Ur-Vorläufer unseres RentalAnalyzer-IQR-Musters
- kleinanzeigen-agent.de (DanielWTEs gehosteter kommerzieller Dienst) —
  strukturierte API (Suche, Details, Verkäuferprofile) + **Webhook-Benach-
  richtigungen bei neuen Inseraten**; Abonnement-Modell. Bestätigt den
  Monitoring-Mode als Nachfrage (Webhooks = unser Monitoring-Phase-2-Ziel)
- Octoparse-Blog „Wie kann man eBay Kleinanzeigen scrapen" (2025/2026) —
  Methodik-Referenz, kein Code-Beitrag: **Ankaufskandidaten-Heuristik**
  („Angebote >20 % unter Median markieren"), Listing→Details-Template-Kette
  (= unser DataExport-Zweiphasen-Muster), Recht/Ethik (robots.txt, 1–2 s
  Wartezeiten, keine personenbezogenen Daten speichern). Praktische
  Validierung: ~1.500 Inserate in 3 min, 0 CAPTCHAs bei ordentlicher
  Rate-Discipline
- ⚠️ **NICHT als Quelle nutzen:** github.com/hideshopkeeperbound/
  ebay-kleinanzeigen-api-interface — versehentlich/unsicher anmutendes Repo
  (Binary `api.dll`, verschlüsselter `auth.enc`-Blob, gemischte Zufalls-Dateien,
  Upload-only-Historie). Klonen/Ausführen vermieden, Beweislast beim Autor.
- Apify Store Actors (Pricing-/Schema-Referenz): clearpath/kleinanzeigen-
  immobilien-api-pro, memo23/kleinanzeigen-search-scraper-ppe, lowlanddata/
  kleinanzeigen-scraper, unfenced-group/kleinanzeigen-classifieds-scraper,
  santamaria-automations/kleinanzeigen-de-scraper, clearpath/kleinanzeigen-
  message-api
