// var statt const + Vorhanden-Check: dieses File wird von ZWEI Content-Script-
// Bloecken geladen (document_start fuer InPageMenu, frueher auch document_idle)
// -- doppeltes const KAStorage im selben Isolated-World wirft sonst
// "Identifier has already been declared" und LEGT DIE GESAMTE ERWEITERUNG LAHM
// (Bug 2026-09-09 im Seiten-Kontext gefunden: core/Storage.js:1 SyntaxError).
// var + Guard macht die Injektion idempotent.
var KAStorage = (typeof KAStorage !== 'undefined') ? KAStorage : {
    _cache: {},

    featureKey(id) {
        if (!id) return 'feature_unknown';
        return String(id).startsWith('feature_') ? String(id) : `feature_${id}`;
    },

    isFeatureEnabled(settings, id) {
        return (settings || {})[this.featureKey(id)] === true;
    },

    async get(key, defaultValue = null) {
        if (Object.prototype.hasOwnProperty.call(this._cache, key)) {
            return this._cache[key];
        }
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
                const val = result[key] !== undefined ? result[key] : defaultValue;
                this._cache[key] = val;
                resolve(val);
            });
        });
    },

    async set(key, value) {
        this._cache[key] = value;
        return new Promise((resolve) => {
            chrome.storage.local.set({ [key]: value }, () => resolve());
        });
    },

    clearCache() {
        this._cache = {};
    }
};
