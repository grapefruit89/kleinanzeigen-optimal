// core/bridge-sw.js (2026-09-09, McpBridge v2.1 — Architektur-Fix)
// INTENT:
//   Die Extension als MCP-Tool-Anbieter. Der WS-Client lebt im SERVICE WORKER
//   (nicht im Content-Script): SW stirbt sauber bei Extension-Reload (keine
//   Zombie-Kontexte mehr), chrome.runtime ist nativ da, kaApiQueued liegt
//   direkt daneben, und WebSocket haelt den SW wach (Chrome 116+).
// PROTOKOLL:
//   JSON-RPC 2.0 (initialize / tools/list / tools/call) ueber ws://127.0.0.1:8765.
//   Der Adapter (mcp-adapter/adapter.js) bridgt stdio-MCP auf diesen WS.
// TOKEN:
//   ka_settings.mcp_bridge_token (Abholbar im InPageMenu "Token kopieren").
//   Jede Message traegt token (Klartext, 127.0.0.1-only).
// TOKEN-EFFIZIENZ (docs/kleinanzeigen-api.md §9):
//   ka_search = Teaser-Objekte; ka_get_ad kapppt description auf 500 Zeichen
//   (full_description:true = Volltext), pictures nur auf Anfrage;
//   get_page default 'snapshot' (leichtgewichtig), 'html' bewusst Opt-in.
// RATE:
//   Alle API-Tools laufen durch kaApiQueued (80/10min Cap, serielle Queue).
// BROKEN IF:
//   Adapter: "Bridge-WS nicht verbunden" → SW schläft/schläft wieder ein?
//   WS-Verbindung haelt den SW wach; stirbt der WS, reconnectet er alle 5s.
(function () {
    'use strict';

    const RPC = '2.0';
    let ws = null;
    let connecting = false;
    let bridgeToken = '';

    function rpcSend(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    }

    function rpcError(id, code, message) {
        rpcSend({ jsonrpc: RPC, id, error: { code, message } });
    }

    async function loadToken() {
        const settings = await KAStorage.get('ka_settings', {});
        if (typeof settings.mcp_bridge_token === 'string' && settings.mcp_bridge_token.length >= 16) {
            bridgeToken = settings.mcp_bridge_token;
            return;
        }
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bridgeToken = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        settings.mcp_bridge_token = bridgeToken;
        await KAStorage.set('ka_settings', settings);
        // Token NICHT loggen (P0-Härtung) — Abholung im InPageMenu.
        console.warn('[KA Bridge-SW] Neues Token erzeugt (Abholung: InPageMenu → Token kopieren).');
    }

    // ---------------- Token-Effizienz ----------------
    const TEASER_FIELDS = ['id', 'title', 'price', 'location', 'category', 'status', 'url'];

    function pickFields(obj, fields) {
        if (!Array.isArray(fields) || !fields.length) return obj;
        const out = {};
        for (const f of fields) if (obj && Object.prototype.hasOwnProperty.call(obj, f)) out[f] = obj[f];
        return out;
    }

    // ---------------- Tools ----------------
    const TOOLS = [
        {
            name: 'ka_search',
            description: 'Kleinanzeigen-Suche ueber die Mobile-API. Liefert Teaser-Objekte (id, title, price, location, category, status). Fuer Details: ka_get_ad.',
            inputSchema: {
                type: 'object',
                properties: {
                    q: { type: 'string', description: 'Suchbegriff' },
                    category: { type: 'string', description: 'Kategorie-ID (z.B. 203 = Mietwohnungen)' },
                    page: { type: 'number', description: '0-basiert (Cap: 50 Seiten)' },
                    size: { type: 'number', description: '1-41 pro Seite' },
                    fields: { type: 'array', items: { type: 'string' }, description: 'Feld-Selektor; default: Teaser-Felder' },
                },
            },
        },
        {
            name: 'ka_get_ad',
            description: 'Volle Anzeige-Details (Beschreibung gekappt auf 500 Zeichen; pictures nur mit pictures:true).',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    fields: { type: 'array', items: { type: 'string' }, description: 'Feld-Selektor (optional)' },
                    full_description: { type: 'boolean' },
                    pictures: { type: 'boolean' },
                },
                required: ['id'],
            },
        },
        {
            name: 'ka_seller_profile',
            description: 'Verkaeufer-Profil (counters, replyRate/replySpeed, badges).',
            inputSchema: {
                type: 'object',
                properties: { userId: { type: 'string' } },
                required: ['userId'],
            },
        },
        {
            name: 'get_page',
            description: 'Aktive KA-Seite. format "snapshot" (default): url/title/Karten kompakt. format "html": komplettes outerHTML (teuer — nur auf Wunsch).',
            inputSchema: {
                type: 'object',
                properties: {
                    format: { type: 'string', enum: ['snapshot', 'html'] },
                    max_cards: { type: 'number' },
                },
            },
        },
    ];

    async function kaSearch(a) {
        const p = {
            q: a.q,
            size: Math.min(Math.max(a.size || 20, 1), 41),
            page: a.page || 0,
        };
        if (a.category) p.categoryIds = a.category;
        const raw = await kaApiQueued('/ads.json', p);
        let ads = (normalizeSearchResponse(raw) || []).map((ad) => pickFields(ad, TEASER_FIELDS));
        if (Array.isArray(a.fields)) ads = ads.map((ad) => pickFields(ad, a.fields));
        return { content: [{ type: 'text', text: JSON.stringify({ count: ads.length, page: p.page, ads }) }] };
    }

    async function kaGetAd(a) {
        const raw = await kaApiQueued(`/ads/${String(a.id)}.json`, {});
        let ad = normalizeAdResponse(raw);
        if (ad.description && !a.full_description && ad.description.length > 500) {
            ad = { ...ad, description: ad.description.slice(0, 500), description_truncated: true };
        }
        if (!a.pictures && ad.pictures) ad = { ...ad, pictures: undefined };
        ad = pickFields(ad, a.fields);
        return { content: [{ type: 'text', text: JSON.stringify(ad) }] };
    }

    async function kaSellerProfile(a) {
        const raw = await kaApiQueued(`/users/public/${String(a.userId)}/profile.json`, {});
        return { content: [{ type: 'text', text: JSON.stringify(normalizeSellerProfile(raw) || {}) }] };
    }

    async function getPage(a) {
        const format = a.format === 'html' ? 'html' : 'snapshot';
        const tabs = await chrome.tabs.query({ url: 'https://www.kleinanzeigen.de/*' });
        if (!tabs.length) throw new Error('Kein kleinanzeigen.de-Tab offen.');
        const tab = tabs.find((t) => t.active) || tabs[0];
        const resp = await chrome.tabs.sendMessage(tab.id, {
            action: 'kaGetPage',
            format,
            maxCards: Math.min(Math.max(a.max_cards || 10, 1), 50),
        });
        if (!resp || resp.ok === false) throw new Error((resp && resp.error) || 'get_page: kein Responder (Seite nach Feature-Aktivierung neu laden?)');
        return { content: [{ type: 'text', text: JSON.stringify(resp.data) }] };
    }

    async function handleCall(params) {
        const name = params && params.name;
        const a = (params && params.arguments) || {};
        if (name === 'ka_search') return kaSearch(a);
        if (name === 'ka_get_ad') return kaGetAd(a);
        if (name === 'ka_seller_profile') return kaSellerProfile(a);
        if (name === 'get_page') return getPage(a);
        throw new Error('unknown tool: ' + name);
    }

    function rpcHandle(msg) {
        const { id, method, params } = msg;
        if (method === 'initialize') {
            rpcSend({
                jsonrpc: RPC,
                id,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: { name: 'ka-mcp-bridge', version: '2.1.0' },
                    instructions: 'Kleinanzeigen-Bridge (SW-gehostet): ka_search (Teaser), ka_get_ad (Details), ka_seller_profile, get_page (snapshot). Rate-Discipline via kaApiQueued (80 Calls/10min).',
                },
            });
        } else if (method === 'tools/list') {
            rpcSend({ jsonrpc: RPC, id, result: { tools: TOOLS } });
        } else if (method === 'tools/call') {
            handleCall(params || {})
                .then((r) => rpcSend({ jsonrpc: RPC, id, result: r }))
                .catch((e) => rpcError(id, -32000, String((e && e.message) || e)));
        } else if (id !== undefined) {
            rpcError(id, -32601, 'unknown method: ' + method);
        }
    }


    // Port-Probe (2026-09-09, Anti-Spam): ein fehlgeschlagener WebSocket-
    // Aufbau loggt UNABFANGBAR ERR_CONNECTION_REFUSED in die Extension-
    // Fehlerliste (Spam alle 5s, solange kein Adapter laeuft). fetch()
    // ist dagegen catchable und hinterlaesst keinen Fehler-Eintrag.
    async function adapterPortOpen() {
        try {
            await fetch('http://127.0.0.1:8765/', { mode: 'no-cors', signal: AbortSignal.timeout(2000) });
            return true; // Verbindung steht (Upgrade-Handshake macht danach WS)
        } catch (e) {
            return false; // ECONNREFUSED o.ae. — kein WS-Versuch, kein Spam
        }
    }

    function connect() {
        if (connecting || (ws && ws.readyState === WebSocket.OPEN)) return;
        connecting = true;
        adapterPortOpen().then((open) => {
            if (!open) {
                connecting = false;
                scheduleReconnect();
                return;
            }
            try {
                ws = new WebSocket('ws://127.0.0.1:8765');
            } catch (e) {
                connecting = false;
                scheduleReconnect();
                return;
            }
            ws.onopen = () => {
                console.log('[KA Bridge-SW] Verbunden mit 127.0.0.1:8765 (JSON-RPC 2.0)');
                connecting = false;
            };
            ws.onmessage = (event) => {
                let msg;
                try { msg = JSON.parse(event.data); } catch (e) { return; }
                if (msg.token !== bridgeToken) {
                    if (msg.id !== undefined) rpcError(msg.id, -32001, 'unauthorized');
                    return;
                }
                rpcHandle(msg);
            };
            ws.onclose = () => {
                connecting = false;
                scheduleReconnect();
            };
            ws.onerror = () => {
                try { ws.close(); } catch (e) { /* ignore */ }
            };
        });
    }

    function scheduleReconnect() {
        // 15s-Backoff: Port-Probe ist schon leise, trotzdem gemuetlicher
        // Takt — der SW haelt sich nicht dauerhaft wach.
        setTimeout(connect, 15000);
    }

    // Boot: Token laden, dann verbinden. WebSocket haelt den SW wach (116+).
    loadToken().then(connect);
})();
