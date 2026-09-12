const KAFeatureManager = {
    features: [],

    register(featureId, initFn) {
        this.features.push({ id: featureId, initFn });
    },

    async run() {
        const settings = await KAStorage.get('ka_settings', {});

        this.features.forEach(feature => {
            const isEnabled = KAStorage.isFeatureEnabled(settings, feature.id);
            if (isEnabled) {
                document.body.classList.add(`ka-feature-${feature.id.toLowerCase()}`);
                console.log(`[KA] Feature enabled: ${feature.id}`);
                try {
                    feature.initFn();
                } catch (e) {
                    console.error(`[KA] Error initializing feature ${feature.id}:`, e);
                }
            }
        });
    }
};

// run() wird NICHT mehr hier automatisch gefeuert: Diese Datei steht im
// Manifest vorgeschlagen VOR allen Feature-Dateien -- der Aufruf lief, bevor
// register() stattfand (sie funktionierte nur, weil KAStorage.get asynchron
// ist => Zufallsarchitektur, Grok-Review 10.09.2026). Das explizite Boot
// geschieht in features/index.js, dem LETZTEN Eintrag des Content-Script-
// Arrays im manifest.json.
