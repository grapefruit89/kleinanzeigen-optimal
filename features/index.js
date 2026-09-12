// BOOT: run() hier, im LETZTEN Content-Script-Eintrag des manifest.json --
// garantierst, dass alle register() aller Feature-Dateien bereits liefen
// (statt auf die Async-Zufaelligkeit von KAStorage.get zu setzen).
KAFeatureManager.run();
