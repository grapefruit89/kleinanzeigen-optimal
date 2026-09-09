KAFeatureManager.register('McpBridge', () => {
    'use strict';

    let ws = null;
    let isConnecting = false;
    let reconnectTimer = null;
    let bridgeToken = '';

    function randomToken() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function loadToken() {
        const settings = await KAStorage.get('ka_settings', {});
        if (typeof settings.mcp_bridge_token === 'string' && settings.mcp_bridge_token.length >= 16) {
            bridgeToken = settings.mcp_bridge_token;
            return;
        }
        bridgeToken = randomToken();
        settings.mcp_bridge_token = bridgeToken;
        await KAStorage.set('ka_settings', settings);
        // P0-Härtung (2026-09-09): Token NICHT per console.log ausgeben
        // (Leak) -- abholbar im InPageMenu-Eintrag via "Token kopieren".
        console.warn('[KA MCP Bridge] Neues Token erzeugt. Abholbar im KA-Settings-Menue (Token kopieren).');
    }

    function connect() {
        if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;
        isConnecting = true;

        try {
            ws = new WebSocket('ws://127.0.0.1:8765');
        } catch (e) {
            isConnecting = false;
            scheduleReconnect();
            return;
        }

        ws.onopen = () => {
            console.log('[KA MCP Bridge] Verbunden mit 127.0.0.1:8765');
            isConnecting = false;
        };

        ws.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                console.error('[KA MCP Bridge] Nachricht nicht parsebar:', e);
                return;
            }

            if (data.token !== bridgeToken) {
                try {
                    ws.send(JSON.stringify({
                        type: 'error',
                        requestId: data.requestId || null,
                        error: 'unauthorized'
                    }));
                } catch (e) { /* ignore */ }
                return;
            }

            if (data.action === 'get_html') {
                ws.send(JSON.stringify({
                    type: 'page_data',
                    requestId: data.requestId,
                    html: document.documentElement.outerHTML
                }));
            }
        };

        ws.onclose = () => {
            isConnecting = false;
            scheduleReconnect();
        };

        ws.onerror = () => {
            try { ws.close(); } catch (e) { /* ignore */ }
        };
    }

    function scheduleReconnect() {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 5000);
    }

    // P0-Härtung (2026-09-09): Bei Seiten-Unload Verbindung ordentlich
    // schliessen + Reconnect-Timer stoppen (keine Zombie-Verbindungen).
    window.addEventListener('beforeunload', () => {
        clearTimeout(reconnectTimer);
        try { if (ws) ws.close(); } catch (e) { /* ignore */ }
    });

    loadToken().then(connect);
});
