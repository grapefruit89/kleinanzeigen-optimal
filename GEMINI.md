# Kleinanzeigen Optimal — Projekt-Mandat

SSOT fuer `features/`, `core/`, `popup/`. Pfade `lib/` und `content/` gibt es nicht mehr.

## Verhaltensrichtlinien (Karpathy-Prinzipien, 2026-09-09 uebernommen)

**1. Think Before Coding** — Annahmen aussprechen statt still zu treffen. Bei Mehrdeutigkeit
nachfragen, nicht raten. Einfachere Alternativen benennen, wenn sie existieren.

**2. Simplicity First** — Minimaler Code, nichts Spekulatives. Keine Features, die nicht
gefragt wurden. Keine Abstraktion fuer Einmal-Code. 200 Zeilen, die in 50 gehen → umschreiben.

**2b. Ponytail (Faulheit als Disziplin)** — Die Leiter, ab der ersten Stufe, die haelt:
Existiert es ueberhaupt (YAGNI)? → Schon im Repo? → Stdlib? → **Plattform-Feature?**
(DNR statt Request-Fangen, `chrome.downloads` statt Blob+a.click, `webNavigation` statt
Observer auf body — die chrome-APIs sind unsere native Schicht) → Dependency? → Eine
Zeile? → erst dann minimaler Code. Bugfix = Ursache, nicht Symptom (alle Aufrufer
greppen, ein Guard an der gemeinsamen Stelle). Bewusste Vereinfachungen mit
`ponytail:`-Kommentar + Upgrade-Pfad markieren. Nicht-trivialer Code liegt seinen
kleinsten Check bei; niemals lazy bei Verstaendnis: erst den ganzen Fluss lesen.

**3. Surgical Changes** — Nur anfassen, was die Aufgabe erfordert. Angrenzendes nicht
„verbessern". Bestehenden Stil folgen (deutsche Header-Kommentare, INTENT/ANCHOR/BROKEN IF/
DO NOT-Muster). Vorhandenes totes Code material nennen, nicht loeschen.

**4. Goal-Driven Execution** — Pruefbare Erfolgskriterien statt "make it work".
Schema: Schritt → verify: [check]. Live-Checks gegen die echte Seite (CDP, Port 9222)
zaehlen als Verifikation, Code-Lesen allein nicht.

## Architektur (Stand 2026-09-09)

| Pfad | Aufgabe |
| :--- | :--- |
| `core/Storage.js` | storage plus `featureKey` / `isFeatureEnabled` (var-Guard, doppelt-injektionsfest) |
| `core/FeatureManager.js` | Register + Opt-in-Start |
| `core/background.js` | Service Worker: FESTER DNR-Ruleset + Mobile-API-Client (Rate-Limit-Queue, 15 s-Abort, Cap 80/10 min) |
| `core/kaApi.js` / `kaApiNormalize.js` | Content-Bridge + JAXB-Flat-Normalizer |
| `features/<Name>/index.js` | Ein Feature |
| `features/RentalAnalyzer/` | parser (Chips v2), stats (IQR), ui, enrich (On-Demand), detail (Detailseiten EUR/m²) |
| `features/AdRecorder/` | REC-Suche -> API-Sammel -> Download (opt-in) |
| `rules.json` | DNR `ruleset_1` — **49 Regeln, FELSENFEST default-ON** (kein Toggle, siehe `core/background.js`) |

## Mandate (nicht verhandelbar)

- **Opt-in.** Kein zusaetzliches Feature ohne `ka_settings.feature_<Id> === true`
  und Registrierung via `KAFeatureManager.register()`. (2026-09-09 gebunden:
  AdRecorder lief als IIFE am Flag vorbei — der Fehler-Typ, den Karpathy meint.)
- **Felsen** (kein Toggle, ausdruecklich gewollt): TrackerBlocker (49 DNR-Regeln),
  BadgeRemover (TOP/PRO/Besichtigt), ProAdManager (Filler-Slots + TOP/PRO-Anzeigen weg).
- **Rate-Discipline ueber die Mobile-API** geht nur durch den Background-Client
  (`kaApiQueued`) -- nie direkt aus Content-Scripts fetchen.
- **Live-Verifikation** vor "fertig": Selektoren/URLs/Endpunkte gegen die echte
  Seite pruefen, Datum in den Header-Kommentar (ANCHOR). Tote Anker sofort
  dokumentieren statt schweigend durchlaufen zu lassen.
- Neue Anker werden dokumentiert in `docs/kleinanzeigen-api.md` (Quellen-SSOT).

McpBridge: Key `feature_McpBridge`, WS `127.0.0.1:8765`, Token `ka_settings.mcp_bridge_token`.

Ampel noch global, Matrix regional — nicht still vermischen.
