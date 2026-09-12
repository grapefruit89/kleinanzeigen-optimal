// KAEsc: HTML-Escape fuer interpolierte FREMDE Werte (Anzeigen-Titel,
// Seller-Namen etc. -- kommen von fremden Nutzern der Plattform). Bewusst
// Escaping statt blanket-setHTML(): unsere Templates leben von Style-Attributen
// und Buttons, die ein Default-Sanitizer mit abfischen koennte; die einzige
// echte XSS-Flaeche sind die Interpolationen, nicht das statische Markup.
// var + Guard: Idempotenz wie core/Storage.js (Iso-World laedt mehrfach).
var KAEsc = (typeof KAEsc !== 'undefined') ? KAEsc : function (v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
};
