// CORE: kaApi
// Content-Script-Bridge zur Mobile-API. Content-Scripts duerfen api.
// kleinanzeigen.de nicht CORS-frei fetchen (host_permissions wirken nur im
// Service-Worker) -- deshalb laufen alle Requests als Message durch den
// Background-Client (Rate-Limit-Queue, Retry/Backoff, Request-Cap dort).
// API-Details + Verifikationsstand: docs/kleinanzeigen-api.md (2026-09-09).

const KAApi = {
    _msgCounter: 0,

    _send(message) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    // Context-Invalidate-Schutz: Extension wurde zwischendurch
                    // neu geladen -> lastError gesetzt.
                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    resolve(response || { ok: false, error: 'Keine Antwort vom Service Worker' });
                });
            } catch (e) {
                resolve({ ok: false, error: e.message });
            }
        });
    },

    // Einzelne Anzeige vollstaendig: Beschreibung, GPS, Seller (Rating,
    // Badges, Registrierung), Attribute, Bilder, Preise-Typ normiert.
    async getAd(id) {
        return this._send({ action: 'kaApiGetAd', id: String(id) });
    },

    // Suche: params z.B. { q, page, size, sortType, pictureRequired,
    // includeTopAds }. size max 41/page, Cap ~50 Seiten (1.250 Ergebnisse).
    async search(params) {
        return this._send({ action: 'kaApiSearch', params });
    },
};
