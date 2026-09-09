#!/usr/bin/env node
// mcp-adapter/adapter.js — WS↔MCP-Adapter (ROADMAP P2 Schritt 4)
// INTENT:
//   Bridgt MCP-over-stdio (opencode & Co.) auf den WS der Extension
//   (features/McpBridge: ws://127.0.0.1:8765, JSON-RPC 2.0).
// ARCHITEKTUR:
//   MCP-Client (opencode) ⇄ stdio ⇄ dieser Adapter ⇄ WS ⇄ Extension-Bridge ⇄ KAApi
//   Requests/Responses werden 1:1 durchgereicht (beide Seiten sprechen
//   JSON-RPC 2.0 mit denselben Methoden initialize/tools/list/tools/call).
// TOKEN:
//   env KA_MCP_TOKEN oder argv[2]. Quelle: InPageMenu "Token kopieren".
// START (opencode.json):
//   "mcp": { "ka": { "type": "local", "command": ["node", "mcp-adapter/adapter.js"],
//            "environment": { "KA_MCP_TOKEN": "<token>" }, "enabled": true } }
// BROKEN IF:
//   "Bridge-WS nicht verbunden" → feature_McpBridge-Flag an + Seite (neu) laden;
//   "Bridge-Timeout" → SW-Queue arbeitet ab (Rate-Cap 80/10min), später neu.
// PONYTAIL:
//   ws-Paket bewusst als dep (handgebaute WS-Frames = Bug-Farm für 3h-Debug).
const { WebSocketServer } = require('ws');
const readline = require('readline');

const TOKEN = process.env.KA_MCP_TOKEN || process.argv[2] || '';
const PORT = 8765;

if (!TOKEN) {
    console.error('[ka-adapter] FEHLER: Kein Token (env KA_MCP_TOKEN oder argv[2]). Quelle: InPageMenu → "Token kopieren".');
    process.exit(1);
}

let conn = null;
const pending = new Map(); // id → {resolve, timer}

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('listening', () => console.error(`[ka-adapter] WS-Server an 127.0.0.1:${PORT} — warte auf Extension-Bridge (feature_McpBridge an)…`));
wss.on('error', (e) => {
    console.error('[ka-adapter] WS-Server-Fehler:', e.message);
    process.exit(1);
});

wss.on('connection', (ws) => {
    if (conn) { console.error(`[ka-adapter] ALTER Connection wird ersetzt (vorher offen).`); try { conn.close(); } catch (e) {} }
    conn = ws;
    console.error(`[ka-adapter] Extension-Bridge verbunden. t=${Date.now() % 100000}`);
    ws.on('close', (code, reason) => {
        if (conn === ws) conn = null;
        console.error(`[ka-adapter] Bridge-Verbindung zu. code=${code} reason=${reason?.toString?.() || ''} t=${Date.now() % 100000}`);
    });
    ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch (e) { return; }
        // Unauthorized-ErrorResponses durchlassen (id-basiert), kein Token-Check hier —
        // die Bridge prüft selbst und antwortet mit rpcError.
        const p = pending.get(msg.id);
        if (p) {
            clearTimeout(p.timer);
            pending.delete(msg.id);
            p.resolve(msg);
        }
        // Notifications vom Bridge (ohne id): ignorieren (stderr-Log)
        else if (msg.id === undefined) {
            console.error('[ka-adapter] Bridge-Notification:', JSON.stringify(msg).slice(0, 120));
        }
    });
});

function wsRequest(msg) {
    return new Promise((resolve, reject) => {
        if (!conn || conn.readyState !== 1) {
            return reject(new Error('Bridge-WS nicht verbunden (feature_McpBridge an + Seite neu laden?)'));
        }
        conn.send(JSON.stringify({ ...msg, token: TOKEN }));
        const timer = setTimeout(() => {
            if (pending.has(msg.id)) {
                pending.delete(msg.id);
                reject(new Error('Bridge-Timeout (90s)'));
            }
        }, 90000);
        pending.set(msg.id, { resolve, timer });
    });
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch (e) {
        console.error('[ka-adapter] stdin-Zeile nicht parsebar:', line.slice(0, 80));
        return;
    }
    if (msg.id === undefined) {
        // Notification (z.B. notifications/initialized) an Bridge weiterleiten
        try { if (conn && conn.readyState === 1) conn.send(JSON.stringify({ ...msg, token: TOKEN })); } catch (e) {}
        return;
    }
    try {
        const reply = await wsRequest(msg);
        process.stdout.write(JSON.stringify(reply) + '\n');
    } catch (e) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } }) + '\n');
    }
});
rl.on('close', () => process.exit(0));
