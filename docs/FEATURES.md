# Feature-Uebersicht — Kleinanzeigen Rental Analyzer

> Stand: 09.09.2026 (live verifiziert). Diese Datei ist die Karte: Welche Features
> gibt es, was tun sie, wo laufen sie, wie schaltet man sie? Technische Details
> (Anker, DO NOTs) stehen im Kopf der jeweiligen `features/<Name>/index.js`.

## Der rote Faden: Wie Features funktionieren

- **Opt-in-Pflicht:** Jedes zuschaltbare Feature braucht einen Schalter. Es gibt
  zwei Stellen: das **SidePanel** (Toolbar-Icon rechts) oder das **InPageMenu**
  (Hamburger-Button oben rechts auf kleinanzeigen.de). Toggle an → Seite lädt
  automatisch neu.
- **Felsen:** Zwei Features sind bewusst *nicht* abschaltbar (Grundlagen-Hygiene):
  `BadgeRemover` und `ProAdManager`.
- Technisch: Flags liegen als `feature_<Name>` in `ka_settings`
  (chrome.storage.local), `core/FeatureManager.js` liest sie bei jedem
  Seiten-Load und setzt `ka-feature-<name>` am `<body>`.

## Alle Features (14)

### Felsen — immer aktiv, kein Schalter

| Feature | Was es tut | Wo |
|---|---|---|
| **ProAdManager** | Graue Werbe-Lücken (Liberty-Slots) und gewerbliche TOP/PRO-Anzeigen in Suchlisten + Homepage ausblenden | Alle Such-/Home-Seiten |
| **BadgeRemover** | Hervorhebungs-Chips (TOP, PRO, Besichtigt) auf Karten entfernen | Überall |
| **TrackerBlocker** | 49 DNR-Regeln blockieren AdTech/Telemetrie-Domains | Browser-weit (Service Worker) |
| **InPageMenu** | Hamburger-Button oben rechts → Settings-Sidebar direkt auf kleinanzeigen.de | Überall |

### Opt-in — über SidePanel oder InPageMenu

| Feature | Flag | Was es tut | Wo |
|---|---|---|---|
| **RentalAnalyzer** | `feature_RentalAnalyzer` | EUR/m²-Badge + Mediane + Deal-Chips auf Anzeigen-Karten berechnen (m²-Chip-basiert, nicht Immo-gebunden) | Alle `/s-`-Seiten |
| **WasdNavigation** | `feature_WasdNavigation` | Tastatur-Navigation: A/D blättert Seiten, W/S springt zwischen Karten | `/s-`-Suchseiten |
| **UiCleaner** | `feature_UiCleaner` | Aggressive Werbebanner/Popups weg (Tier-1-Liste, u.a. Top-Ads) | Überall |
| **HighResZoom** | `feature_HighResZoom` | Knackscharfe Bilder + Galerie bei Hover | Karten + Detailseiten |
| **SortSaver** | `feature_SortSaver` | Zuletzt gewählte Sortierung merken und wiederherstellen | `/s-`-Suchseiten |
| **WidescreenLayout** | `feature_WidescreenLayout` | Content-Breite auf großen Monitoren aufweiten | Überall |
| **AutoShowMore** | `feature_AutoShowMore` | Klickt „Weitere Anzeigen“ automatisch mehrfach nach (menschliche Pausen wegen Akamai-Bot-Schutz), max. 15 Batches | Homepage + `/stadt/<ort>` |
| **CleanHomepage** | `feature_CleanHomepage` | Homepage entschlacken: „Für dich empfohlen“, „Unternehmensseiten“, Galerie weg — **Kategorien-Seitenleiste bleibt** (Hauptnavigation) | Startseite |
| **DataExport** | `feature_DataExport` | „TO LLM \| Auto-Scraper“: Suchergebnisse (bis 50 Seiten) als JSONL exportieren, optional mit Detail-/API-Enrichment | `/s-`-Suchseiten |
| **AdRecorder** | `feature_AdRecorder` | „⏺ Such-Aufnahme (REC)“: Blättert man durch eine Suche, sammelt er jede Karte per Mobile-API (ohne Bilder); Stop → JSON in Downloads | `/s-`-Suchseiten |
| **McpBridge** | `feature_McpBridge` | Agent-Anbindung: lokaler WebSocket 127.0.0.1:8765, nur mit Token — für Dev/Automatisierung | Dev-only |

## Aktueller Zustand in deinem Browser (09.09.2026)

- **AN:** RentalAnalyzer, CleanHomepage, DataExport, AdRecorder, McpBridge, HighResZoom, SortSaver
- **AUS:** UiCleaner, WidescreenLayout, AutoShowMore, WasdNavigation

## Wo liegen die Anker-UIs?

- **REC-Widget** (`#ka-rec-ui`) und **Auto-Scraper-Panel** (`#md-scraper-ui`) erscheinen auf **jeder** `/s-`-Suchseite (nicht nur Immo) — sobald die Flags an sind und die Seite *nach* dem Einschalten geladen wurde.
- SidePanel öffnet sich per Toolbar-Icon; InPageMenu per Hamburger oben rechts.

## Core-Bausteine (keine Features, Infrastruktur)

| Datei | Aufgabe |
|---|---|
| `core/FeatureManager.js` | Flag-Reading, Body-Klassen, Feature-Start |
| `core/Storage.js` | `ka_settings`-Zugriff mit Cache + `isFeatureEnabled` |
| `core/background.js` | Service Worker: DNR-Trackerblock, Downloads, SidePanel |
| `core/bridge-sw.js` | WebSocket-Client der McpBridge (im SW, nicht im Tab) |
| `core/kaApi.js` + `kaApiNormalize.js` | Mobile-API-Zugriff (auth) + Feld-Normalisierung |
| `core/anchors.js` | geteilte DOM-Anker |
| `sidepanel/panel.js` | SidePanel-Toggles + Stats |
| `features/InPageMenu/` | In-Seiten-Settings-Sidebar |
