# Review: grapefruit89/kleinanzeigen-optimal

**Stand:** 2026-09-05, nach Opt-in-/Archive-Commit auf `main`  
**Produkt:** Manifest V3, Version 2.0.1

## Kurzurteil

Default-Politiken und McpBridge-Key sind behoben. Hygiene (gitignore, Archiv, leere Icons) ebenfalls. Offen: Parser/Statistik, Tests, Observer, rules.json resourceTypes.

Der Miet-Dashboard-Ansatz ist entschieden: **PLZ der Karte ist der Anker**, Anzeigen-ID verhindert Doppelparse, €/m² ist der Wert. Kein Array `00001–99999`. Offizielle DE-PLZ nur als Erlaubnis-Menge, nicht als leeres Raster.

---

## 1. Kritische Schwaechen

### 1.1 Drei Default-Politiken — **erledigt**

`KAStorage.isFeatureEnabled(settings, id)` → `feature_<Id> === true` in Manager, Popup, Menue, Background. Manifest DNR `enabled: false`.

### 1.2 McpBridge — **erledigt** (Key + Token)

Menue-ID `feature_McpBridge`. Alter Key wird migriert. WS nur `127.0.0.1:8765`. `get_html` nur mit `token === ka_settings.mcp_bridge_token`.

### 1.3 README + GEMINI — **erledigt**

### 1.4 Parser und Statistik — offen (Datenmodell festgelegt)

Ist-Zustand in `features/RentalAnalyzer/`:

```text
rental_db.ads[id] = { p: €/m², plz: "50667", t: timestamp }
```

Ampel laeuft gegen **globale** Historie (`Object.values(db.ads)`). Matrix bricht auf 4-Steller der **aktuellen Seite** runter (`5066X`). Parser nimmt die erste `\b\d{5}\b` in `p, span, div` — nicht zwingend die Karten-PLZ.

Festgelegtes Zielmodell:

```text
rental_db = {
  "50667": { "123456789": 14.2, "987654321": 16.8 },
  "50668": { "111222333": 13.1 }
}
```

- Aeussere Keys = 5-stellige PLZ der Kleinanzeigen-Karte (Anker).
- Innere Keys = `data-adid` (einmalig, kein Doppelparse).
- Wert = €/m².
- Sparse: nur Keys, die wirklich gesehen wurden. Kein `db[0]…db[99999]`.

Begruendung:

- DE hat grob 27–30k vergebene PLZ, nicht 100k Nummern. `00001–99999` als festes Array ist tot und speicherteuer.
- Kleinanzeigen liefert die PLZ an der Karte. Das ist der Anker, nicht eine Regex irgendwo im Markup.
- Ortsname ist fuer Dateigroesse und Statistik **nicht** noetig. Labels (`50667 Koeln`) sind optional spaeter.
- Quelle fuer die Erlaubnis-Menge: [`de_plz_ort.json.br`](https://github.com/grapefruit89/DIN-BriefNEO/blob/main/website/data/de_plz_ort.json.br) (~72 KB Brotli) aus DIN-BriefNEO. Einmal ableiten, als `Set` der 5-Steller ins Feature legen. Nicht zur Laufzeit das andere Repo laden. Nicht `de_grosskunden_plz.json.br`, nicht `plz-embedded.js`.
- AT/CH-PLZ stehen nicht in der DE-Menge: Anzeige auf der Seite behalten, nicht in die DE-Statistik schreiben.

Statistik-Regel (sonst bleibt die Ampel falsch):

1. IQR zuerst ueber alle IDs **dieser** 5-stelligen PLZ, wenn `n` gross genug (Richtwert ≥ 8).
2. Sonst ueber den 4-Steller (`5066*`), den man aus den Keys ableitet — ohne Ort-Datei.
3. Ampel und Matrix-Karte **dieselbe** Gruppe. Nicht Bundes-Historie gegen eine Koelner Suche.

Parser-Regel:

- PLZ aus der Ort-Zeile / strukturiertem Kartenfeld, nicht erste fuenf Ziffern irgendwo.
- ID aus `data-adid`.
- €/m² nur speichern, wenn die PLZ in der DE-Menge liegt.
- Bestehende ID: nicht blind neu anlegen. Entweder ignorieren (heutiges Verhalten) oder bewusst Preis updaten, wenn sich €/m² geaendert hat.

### 1.5 Observer — offen

`observeOnlyButton()` und andere Features beobachten `document.body` subtree-weit. Debounce ist drin, Freeze-Risiko bleibt das Muster.

### 1.6 Storage-Cache — teilweise (`hasOwnProperty` drin, kein onChanged)

### 1.7 Hygiene — **teilweise erledigt**

.gitignore, archive/, Userscript-Root weg, leere Icons weg, `_metadata`-Blob weg. Offen: leere `docs/README`, HTML-Dumps, Tests.

### 1.8 Recht — offen

---

## 2. Miet-Dashboard: Architektur-Notiz

```text
Karte (Kleinanzeigen)
        |
        +-- PLZ 5-stellig     → aeusserer Key (nur wenn in DE-Set)
        +-- data-adid         → innerer Key
        +-- Preis / Flaeche   → €/m²
        v
sparse rental_db[plz][adId] = eurPerSqm
        |
        +-- n(plz) >= 8  → IQR dieser PLZ
        +-- sonst        → IQR 4-Steller
        v
Ampel + Matrix dieselbe Gruppe
```

Was **nicht** gebaut wird:

- festes Array 00001–99999
- leere Buckets fuer jede offizielle PLZ
- Ortspflicht in der DB nur wegen Dateigroesse
- Live-Fetch aus DIN-BriefNEO
- Ampel gegen alle jemals gesehenen DE-Preise

---

## 3. Roadmap nach ROI

1. ~~Opt-in + Tracker Manifest aus~~ **erledigt**
2. ~~McpBridge-Key + Token~~ **erledigt**
3. ~~README + GEMINI~~ **erledigt**
4. ~~.gitignore, archive/, tote Icons~~ **erledigt**
5. **Rental-DB umbauen** — PLZ → `{ adId: €/m² }` sparse. Migration aus `rental_db.ads`. **ROI hoch / Aufwand mittel.**
6. **DE-PLZ-Set** aus `de_plz_ort.json.br` ableiten (nur Keys, kein Ort). Parser speichert nur Treffer in der Menge. **ROI hoch / Aufwand gering.**
7. **Ampel regional** — IQR gegen PLZ oder 4-Steller, nie gegen Bundes-Historie. Tausch nicht als `isTop`. **ROI hoch / Aufwand gering.**
8. Parser-Anker: Karten-PLZ statt erster `\d{5}` in beliebigen Nodes. Fixtures aus `docs/html_samples`. **ROI hoch / Aufwand mittel.**
9. Vitest `stats.js` + Parser-Fixtures. **ROI hoch / Aufwand mittel.**
10. `rules.json` resourceTypes angleichen. **ROI mittel / Aufwand gering.**
11. DataExport Rate-Limit + ToS. **ROI mittel / Aufwand mittel.**
12. Optional: Ort-Label nur fuer UI, nicht in der DB. **ROI niedrig / Aufwand gering.**
13. Bundler / CI spaeter. **ROI niedrig / Aufwand hoch.**
