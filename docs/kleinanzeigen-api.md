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
| `GET /api/ads/seller-other-ads/{adId}.json` | **Weitere aktive Anzeigen desselben Verkäufers** — auch für PRIVATE (nicht nur /pro-Stores). Betrugserkennung: Portfolio-Muster | 🟡 Reader-Doku (App v2026.31.2) |
| `GET /api/ads/similar/{adId}.json` | Algorithmisch ähnliche Anzeigen | 🟡 App-Schema |
| `GET /api/users/public/{userId}/profile.json` | **Öffentliches Verkäuferprofil**: Name, Registrierung, Ratings, Badges | 🟡 App-Schema |
| `GET /api/v2/counters/ads/vip/{adId}` | **View-Counter** einer Anzeige | 🟡 App-Schema |
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

## 4. Was die Profi-Scraper anders machen (abschauenswerte Techniken)

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

- **Messaging-API** (send/inbox/conversation): braucht eingeloggte Session
  (2FA-Flow) — unser Session-Moat: Endpunkte via DevTools-Netzwerk-Tab
  reverse-engineeren, solange der User in der App eingeloggt ist. Apify
  nimmt dafür $0,49/Nachricht. Eleganter Pfad: `gateway.kleinanzeigen.de/auth/{login,refresh}`
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
- **Verkäufer-Inventar:** `userInventorySearch`-Flag existiert in
  `searchOptions` → es gibt einen Endpunkt für das Inventar eines Verkäufers
  (noch zu verifizieren).
- **Monitoring-Mode:** Baseline-Dedup + contentHash; kleinanzeigen-agent.de
  zeigt die Nachfrage nach Webhooks bei neuen Inseraten.

## 8. Quellen

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
  Refresh-Latenz 15–45 s
- github.com/DanielWTE/ebay-kleinanzeigen-api (MIT, 219★) — Playwright-Fall-
  back-Muster, Redirect=gelöscht-Erkennung, Seller-Extraktion, eigene FastAPI-
  Schnittstelle über der Seite
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
