# AGENTS.md

Agenten-Kontext fuer dieses Repo. Die verbindlichen Regeln und die Architektur-SSOT
liegen in **GEMINI.md** — lies sie zuerst, insbesondere:
1. Verhaltensrichtlinien (Karpathy-Prinzipien + Ponytail-Leiter: Think Before Coding /
   Simplicity First mit Plattform-Ladder / Surgical Changes / Goal-Driven Execution)
2. Mandate (Opt-in-Pflicht, Felsen, Rate-Discipline, Live-Verifikation)
3. Doku-SSOT: `docs/kleinanzeigen-api.md`
4. Quellen-SSOT: `docs/sources.md` — **JEDE vom User gelieferte Quelle wird hier
   registriert** (Link + Status adoptiert/teilweise/referenz/abgelehnt + Wo-Verweis),
   damit keine doppelt und dreifach vorgeworfen wird. Verweigerte Quellen landen
   als AP-Eintrag in `docs/antipatterns.md`.

## Kontext-Diskiplin (Token-Sparen)

- **Websuche/Fetch nie direkt im Hauptkontext**: `websearch`/`webfetch` immer über den
  Task-Subagent **`web-research`** (`.opencode/agents/web-research.md`) ausführen — der
  arbeitet in seinem eigenen Kontextfenster und liefert nur das Destillat
  (Kernaussagen + Quellen-URLs, max ~25 Zeilen) zurück. Begründung: Roh-HTML einer
  Suchseite frisst 10–50k Tokens, die danach jeden Turn mitgeschickt werden.
- Gleiches Prinzip für alles Große: Datei-Analyse, Log-Dumps, mehrseitige Doku → Subagent;
  nur die Antwort kommt ins Hauptfenster.
- Direkte `websearch`/`webfetch`-Calls im Hauptkontext sind die Ausnahme und brauchen
  einen Grund (z. B. einzelner bekannter URL-Statuscheck).

## System-Level-Änderungen (HEIKLE SACHEN)

- **Backup-Pflicht:** Bevor irgendeine Datei außerhalb dieses Repos angefasst wird
  (Konfigs wie `kdeglobals`, `kwinrc`, `plasma-*.desktop-appletsrc`, systemd-Units,
  Passwörter-Dateien etc.): erst Voll-Kopie in ein Backup-Verzeichnis mit Zeitstempel
  anlegen, `sync` ausführen, dann erst editieren. Am Ende die Originaldatei gegen das
  Backup diffen und dem User zeigen, was geändert wurde.
- **Minimale Diffs:** Nur die Zeile(n) ändern, die nötig sind — nie ganze Blöcke oder
  Dateien neu schreiben. Einzeilige Additive > Umbauten.
- **User-Zustimmung vor destruktiven Aktionen** (Neustart, Logout, `pkill`, Config-
  Zurücksetzen): immer erst Folgen erklären und explizites Go abwarten.
- **Lesson learned (2026-09-09):** Ein einzeiliger Config-Fix ohne vorheriges Backup
  kippte eine Plasma-Session (Vesktop-Crash + wedged Wayland-Compositor als Kette).
  Ergebnis: Backups + Reparatur-Script + Nachweis-Checks (Journals, Config-Valide-
  rung) sind Pflicht, bevor Änderungen an laufenden Desktop-Diensten gemacht werden.
