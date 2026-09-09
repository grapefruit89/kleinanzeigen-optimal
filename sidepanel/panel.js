// sidepanel/panel.js (2026-09-09, P1-Roadmap: SidePanel als Zentrale)
// INTENT:
//   Rendert ALLES aus chrome.storage.local (kein DOM-Injection-Risiko,
//   kein Isolated-World-Kontext-Tod — das Panel lebt in der Extension).
//   Live-Updates via chrome.storage.onChanged.
// FELSEN (kein Toggle, GEMINI.md-Mandat): TrackerBlocker, BadgeRemover,
//   ProAdManager — als gesperrte Zeilen angezeigt.
// AENDERUNGEN AN FLAGS: wirken beim NAECHSTEN Seiten-Laden (FeatureManager
//   liest ka_settings beim Inject). Kein Reload-Zwang vom Panel aus.
// HINWEIS: Extension-Page = volle APIs (downloads, storage) — kein
//   kaDownload-Bridge-Umweg noetig.
'use strict';

const FELSEN = [
    { id: 'TrackerBlocker', name: 'Tracker-Blocker', desc: '49 DNR-Regeln — felsenfest' },
    { id: 'BadgeRemover', name: 'Badge-Remover', desc: 'TOP/PRO/Besichtigt — felsenfest' },
    { id: 'ProAdManager', name: 'Pro-Ad-Manager', desc: 'Filler-Slots + TOP/PRO-Anzeigen weg — felsenfest' },
];

const OPT_IN = [
    { id: 'RentalAnalyzer', name: 'Rental Analyzer', desc: 'EUR/m² + Mediane + Deal-Chips' },
    { id: 'WasdNavigation', name: 'WASD Navigation', desc: 'A/D blaettern' },
    { id: 'UiCleaner', name: 'UI Cleaner', desc: 'Werbebanner/Popups weg (Tier 1)' },
    { id: 'HighResZoom', name: 'High-Res Zoom', desc: 'Knackscharfe Bilder bei Hover' },
    { id: 'SortSaver', name: 'Sortierung speichern', desc: 'Bevorzugte Sortierung merken' },
    { id: 'WidescreenLayout', name: 'Widescreen Layout', desc: 'Platz auf grossen Monitoren' },
    { id: 'AutoShowMore', name: 'Auto Mehr anzeigen', desc: 'Klickt automatisch nach' },
    { id: 'CleanHomepage', name: 'Startseite aufraeumen', desc: 'Irrelevante Bloecke weg (Tier 2)' },
    { id: 'DataExport', name: 'Datenexport (JSONL)', desc: 'Auto-Scraper fuer LLM-Daten' },
    { id: 'AdRecorder', name: 'Such-Aufnahme (REC)', desc: 'Anzeigen per API sammeln' },
    { id: 'McpBridge', name: 'MCP Bridge', desc: 'Agent-Anbindung (WS 8765)' },
];

const $ = (id) => document.getElementById(id);

function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.style.display = 'none'; }, 2200);
}

function fmt(n) {
    return (n == null ? '–' : Math.round(n).toLocaleString('de-DE'));
}

// ---------------- Render ----------------
function renderRecording(rec) {
    const n = (rec && rec.order && rec.order.length) || 0;
    const active = !!(rec && rec.recording);
    $('rec-count').textContent = n;
    $('rec-status').textContent = active ? '⏺ REC läuft' : (n ? 'Aufnahme bereit' : 'Bereit — REC auf der Suchseite starten');
    $('rec-status').className = 'label ' + (active ? 'warn' : '');
    $('btn-rec-download').disabled = n === 0;
    $('btn-rec-clear').disabled = n === 0;
    $('rec-meta').textContent = rec && rec.searchUrl ? 'Suche: ' + rec.searchBase : '';
}

function renderRentalDb(db) {
    const ads = (db && db.ads) || {};
    const ids = Object.keys(ads);
    $('db-count').textContent = ids.length;
    const cats = new Set(ids.map((i) => ads[i].cat).filter(Boolean));
    $('db-cats').textContent = cats.size;
    const list = $('db-list');
    if (!ids.length) {
        list.innerHTML = '<div class="empty">Keine Einträge — aktiviere Rental Analyzer und besuche Suchseiten.</div>';
        return;
    }
    const sorted = ids.sort((a, b) => (ads[b].t || 0) - (ads[a].t || 0)).slice(0, 40);
    list.innerHTML = sorted.map((i) => {
        const e = ads[i];
        const catBadge = e.cat ? `<span class="badge">c${e.cat}</span>` : '';
        return `<div class="db-item"><span class="label">${e.plz || '—'}</span><span class="stat">${fmt(e.p)} €/m²</span>${catBadge}</div>`;
    }).join('');
}

function renderFeatures(settings) {
    const list = $('feature-list');
    list.innerHTML = '';
    for (const f of FELSEN) {
        const row = document.createElement('div');
        row.className = 'row locked';
        row.title = 'Felsenfest: kein Toggle (Mandat)';
        row.innerHTML = `<div><div class="label">${f.name}</div><div class="muted">${f.desc}</div></div>
            <label class="switch"><input type="checkbox" checked disabled><span class="slider"></span></label>`;
        list.appendChild(row);
    }
    for (const f of OPT_IN) {
        const on = settings[f.id === 'McpBridge' ? 'feature_McpBridge' : 'feature_' + f.id] === true;
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `<div><div class="label">${f.name}</div><div class="muted">${f.desc}</div></div>
            <label class="switch"><input type="checkbox" ${on ? 'checked' : ''} data-feat="${f.id}"><span class="slider"></span></label>`;
        row.querySelector('input').addEventListener('change', async (ev) => {
            const s = await chrome.storage.local.get(['ka_settings']).then((r) => r.ka_settings || {});
            s['feature_' + f.id] = ev.target.checked === true;
            await chrome.storage.local.set({ ka_settings: s });
            toast(`${f.name}: ${ev.target.checked ? 'AN' : 'AUS'} — wirksam beim nächsten Seiten-Laden`);
        });
        list.appendChild(row);
    }
}

// ---------------- Storage-Bootstrap ----------------
async function refresh() {
    const st = await chrome.storage.local.get(['ka_recorder', 'rental_db', 'ka_enrich_cache', 'ka_settings']);
    renderRecording(st.ka_recorder);
    renderRentalDb(st.rental_db);
    $('cache-count').textContent = Object.keys(st.ka_enrich_cache || {}).length;
    renderFeatures(st.ka_settings || {});
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['ka_recorder', 'rental_db', 'ka_enrich_cache', 'ka_settings'].some((k) => k in changes)) {
        refresh();
    }
});

// ---------------- Buttons ----------------
$('btn-rec-download').addEventListener('click', async () => {
    const rec = await chrome.storage.local.get(['ka_recorder']).then((r) => r.ka_recorder);
    if (!rec || !rec.order || !rec.order.length) return;
    const slug = (rec.searchBase && rec.searchBase.match(/^\/s-([a-z0-9-]+)/i)) ? rec.searchBase.match(/^\/s-([a-z0-9-]+)/i)[1] : 'suche';
    const blob = new Blob([JSON.stringify({
        _meta: { format: 'ka-ad-recording/v1', quelle: 'sidepanel-export', such_url: rec.searchUrl, anzahl_ads: rec.order.length, exportiert_am: new Date().toISOString() },
        ads: rec.order.map((id) => rec.ads[id]),
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: `KA_Recording_${slug}_${new Date().toISOString().slice(0, 10)}.json`, saveAs: false }, (id) => {
        URL.revokeObjectURL(url);
        toast(id ? 'Download gestartet' : 'Download fehlgeschlagen: ' + (chrome.runtime.lastError?.message || '?'));
    });
});

$('btn-rec-clear').addEventListener('click', async () => {
    await chrome.storage.local.set({ ka_recorder: { recording: false, ads: {}, order: [] } });
    toast('Aufnahme geleert');
});

$('btn-db-clear').addEventListener('click', async () => {
    if (!confirm('rental_db wirklich komplett leeren? (Mediane bauen sich neu auf)')) return;
    await chrome.storage.local.set({ rental_db: { ads: {} } });
    toast('rental_db geleert');
});

$('btn-cache-clear').addEventListener('click', async () => {
    await chrome.storage.local.set({ ka_enrich_cache: {} });
    toast('ka_enrich_cache geleert');
});

// ---------------- Boot ----------------
chrome.runtime.getManifest().then ? null : null;
$('ext-version').textContent = chrome.runtime.getManifest().version;
refresh();
