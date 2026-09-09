# ANTI-PATTERNS — Verweigerungsliste (2026-09-09)

Dinge, die wir für dieses Projekt **aktiv nicht tun** — jede mit Begründung und
Rückhol-Trigger. Zweck: In 3 Wochen fragt keiner „könnten wir das nicht mit
Playwright machen?" — die Antwort steht hier. Regeln: Neue Anti-Patterns werden
nur mit Datum + Beobachtung aufgenommen; ein Eintrag wird nur durch den
explizit benannten Rückhol-Trigger rehabilitiert, nie durch „war ja vielleicht
doch einfacher".

Format je Eintrag: **Verweigerung / Warum / Beobachtung / Rückhol-Trigger.**

---

## A. Datenquelle & Architektur

### AP-01: DOM-Scraping als primäre Datenquelle
- **Verweigerung:** Karten-Daten kommen aus der Mobile-API (CAPI), DOM nur noch
  als *Anzeige-Anker* (wo hängt die UI) — nie als *Datenquelle*.
- **Warum:** DOM driftet (.aditem, .simpletag, vb-Klassen tot), API liefert GPS/
  Seller-Rating/Views/originalPrice, die im DOM gar nicht stehen. Felsen:
  `docs/kleinanzeigen-api.md` §1-3.
- **Beobachtung:** 2026-09-09 umgestellt; der DOM-only-Weg war der Zustand, den
  die Session begonnen hat zu reparieren.
- **Rückhol-Trigger:** Nur wenn die CAPI das Lesen verwehrt UND kein lokaler
  Browser-Pfad mehr existiert. DOM als reiner Anker bleibt erlaubt.

### AP-02: Playwright/Headless-Server-Modell (Sprayer115, DanielWTE)
- **Verweigerung:** Kein serverseitiger Headless-Browser als Datenweg.
- **Warum:** Unser realer Browser + CAPI ist robuster gegen Bot-Detection,
  braucht keine Login-Credentials im Code und kein zweites Runtime-Setup.
- **Rückhol-Trigger:** Nie, solange der realen-Browser-Pfad funktioniert.

### AP-03: Externe Cloud-/Remote-Dienste (Apify-Käufe, gehostete APIs)
- **Verweigerung:** Keine gekauften Actors ($0,49/Nachricht bei Apify), keine
  kleinanzeigen-agent.de-Credits (1–2 Credits/Call), kein Cloud-Relay.
- **Warum:** User-Mandat: alles läuft in der Extension, lokal. Unsere
  KAApi-Route kostet 0 und hat Tool-Parität zum Bezahl-Dienst erreicht (§9).
- **Rückhol-Trigger:** Nur wenn ein konkretes API-Feature fehlt (z. B. Webhooks)
  UND der User es ausdrücklich freigibt.

### AP-04: Anmelde-Credentials in der Extension speichern
- **Verweigerung:** Kein User-Login-Store in chrome.storage.
- **Warum:** Alles bisher Nötige läuft ohne Session (App-Basic-Auth). Messaging
  (P3) läuft nur über den Session-Moat (Bearer on-the-fly aus Cookie+CSRF
  minten, nichts Persistiertes) — und bewusst zuletzt.
- **Rückhol-Trigger:** Phase-3-Nachrichtenszenario nach manueller Freigabe.

## B. Manifest & Browser-Kontext

### AP-05: Angriffsflächen-Permissions „auf Vorrat"
- **Verweigerung:** `externally_connectable`, breite `web_accessible_resources`,
  CSP-Override, `declarativeNetRequestWithFeedback` (produktiv).
- **Warum:** Jede ist Fingerprinting/XSS-Angriffsfläche oder Debug-only;
  McpBridge läuft als WS-Client im SW und braucht keine davon.
- **Rückhol-Trigger:** WAR nur origin-exakt + `use_dynamic_url`, falls UI-Assets
  je von der Seite geladen werden müssen.

### AP-06: Felsen-Features mit Toggle ausliefern
- **Verweigerung:** TrackerBlocker / BadgeRemover / ProAdManager haben KEINEN
  Schalter — kein Popup-Eintrag, kein InPageMenu-Toggle.
- **Warum:** User-Mandat („felsenfest gegossen"): Kernwert soll nicht gegen
  eine Handvoll Klicks abgewählt werden können.
- **Rückhol-Trigger:** Keiner (Mandat).

### AP-07: Features am FeatureManager vorbei (IIFE-Stealth-Betrieb)
- **Verweigerung:** Kein hartes IIFE, das trotz aus-Geschaltetem Flag läuft.
- **Warum:** Opt-in-Pflicht ist das Architekturmandat (GEMINI.md). Beobachtung
  2026-09-09: AdRecorder zeigte mit aus-Fahne noch „308 Anzeigen bereit".
- **Rückhol-Trigger:** Keiner — `KAFeatureManager.register()` ist Pflicht.

## C. Daten-Heuristik & UI

### AP-08: Betrugs-Flags über Absolutzahlen
- **Verweigerung:** Kein „x Anzeigen = Händler"-Flag.
- **Warum:** Fair gegen alte Accounts (67 Ads/10 Jahre ≈ 6,5/Jahr = normaler
  Privatmann). Rate-basiert entschärft: `perYear ≥ 20/Jahr ODER online ≥ 10`
  (`computeCommercialSuspicion`, kaApiNormalize.js).
- **Rückhol-Trigger:** Nur mit besserem Signal (z. B. Adress-Cluster via GPS).

### AP-09: Dezimal-Preise / ungerundete €/m²-Werte
- **Verweigerung:** Keine Cent-Beträge, keine 12,34 €/m²-Anzeigen.
- **Warum:** User-Mandat: „ab und auf runden reicht" — `Math.round` +
  `toLocaleString('de-DE')` (1000er-Trennpunkt).
- **Rückhol-Trigger:** Keiner (Mandat).

### AP-10: Bilder/Medien in Datensätzen und Exporten
- **Verweigerung:** `stripAd()` wirft `pictures[]` weg; Exporte bleiben JSON(L).
- **Warum:** Platz + Datenschutz; Bild-URLs reichen, CDN-Regeln §3 ($_57 MAX).
- **Rückhol-Trigger:** Nur für ein explizites Bild-Export-Feature (opt-in).

### AP-11: Speicherobjekte ohne TTL/Grenze
- **Verweigerung:** Kein Key in `chrome.storage.local` wächst unbegrenzt und
  unverfallsbar.
- **Warum:** 10MB-Quota, ka_recorder-Fund (300 Full-Ads, nie geräumt).
  Now: `unlimitedStorage` + `chrome.alarms`-Cleanup (7d) + rental_db-Cap 2000.
- **Rückhol-Trigger:** Keiner — aber neue Keys MÜSSEN eine TTL oder ein Cap
  mitbringen.

## D. Agent-Workflow (AGENTS.md-Disziplin)

### AP-12: Websuche/Datei-Dumps im Hauptkontext
- **Verweigerung:** `websearch`/`webfetch` + große Datei-Analysen laufen immer
  über den `web-research`-Subagent; nur das Destillat kommt ins Hauptfenster.
- **Warum:** Roh-HTML = 10–50k Tokens, die JEDEN Turn mitgeschickt werden.
- **Rückhol-Trigger:** Einzige Ausnahme: einzelner bekannter URL-Statuscheck.

### AP-13: Stumme Totzustände / Silent-Failures
- **Verweigerung:** Kein UI-State, der „tot" aussieht, ohne es zu sagen;
  kein `catch` ohne Nutzerhinweis, wo Nutzer korrigieren kann.
- **Warum:** Kontext-Tod-Debugging (AdRecorder zeigte tote Klicks ohne Meldung)
  hat die Session gebremst. Muster: `die()`-Hinweise, `isCtxDead`.
- **Rückhol-Trigger:** Keiner.

### AP-14: Tote Selektoren/URLs still weiterlaufen lassen
- **Verweigerung:** Ein Anker, der nicht mehr matcht, wird sofort dokumentiert
  (Header-Kommentar ANCHOR/BROKEN IF) oder ersetzt — nicht still ignoriert.
- **Warum:** Verlässlichkeit der Doku-SSOT; tote Anker = spätere Rätselstunden.
- **Rückhol-Trigger:** Keiner.

### AP-15: „Fertig" ohne Live-Verifikation
- **Verweigerung:** Code gilt erst als fertig, wenn er gegen die echte Seite
  verifiziert wurde (CDP/Helium) — Code-Lesen allein zählt nicht.
- **Warum:** Goal-Driven Execution (GEMINI.md); mehrere Bugs dieser Session
  wären so erst im Produktivbetrieb aufgefallen.
- **Rückhol-Trigger:** Keiner.

### AP-16: Parallel-Requests an der seriellen Queue vorbei
- **Verweigerung:** Content-Scripts fetchen die CAPI nie direkt und nie
  parallel — alles läuft durch `kaApiQueued` (Background, 500–1000 ms Pause,
  Cap 80/10 min).
- **Warum:** Rate-Limit-Disziplin (mydealz-Methodik); Parallelität = Drossel-
  Risiko für alle.
- **Rückhol-Trigger:** Keiner.

### AP-17: Externe Karten-/Maps-Services unaufgefordert einbauen
- **Verweigerung:** Kein Maps-Embed, kein Karten-Service (Plus-1.0.2-Pattern:
  `#street-address` + PLZ → externes Embed). Weder als Feature noch als
  Schmankerl auf die Roadmap.
- **Warum:** User-Mandat 2026-09-09 („keine Maps") — plus AP-03-Geist: externe
  Services laden Drittanbieter-Requests auf KA-Seiten; GPS/Koordinaten haben
  wir ohnehin aus der CAPI, Anzeige davon reicht.
- **Rückhol-Trigger:** Nur auf ausdrücklichen, einmaligen User-Wunsch — und
  selbst dann: erst Anzeige der GPS-Daten (§3) als Problemprüfung, dann neu
  besprechen.
