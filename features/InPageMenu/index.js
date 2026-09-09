(function() {
    'use strict';

    const MODULES = [
        { id: 'feature_RentalAnalyzer', name: 'Rental Analyzer', desc: 'Preis/m2 und Historie fuer Mietwohnungen berechnen.' },
        { id: 'feature_WasdNavigation', name: 'WASD Navigation', desc: 'Mit A und D durch die Seiten blaettern.' },
        { id: 'feature_UiCleaner', name: 'UI Cleaner', desc: 'Entfernt aggressive Werbebanner und Popups (Tier 1).' },
        { id: 'feature_HighResZoom', name: 'High-Res Zoom (Hover)', desc: 'Laedt knackscharfe Bilder und oeffnet Galerie bei Hover.' },
        { id: 'feature_SortSaver', name: 'Sortierung speichern', desc: 'Speichert deine bevorzugte Sortierung (z.B. Neueste).' },
        { id: 'feature_WidescreenLayout', name: 'Widescreen Layout', desc: 'Nutzt den Platz auf grossen Monitoren besser aus.' },
        { id: 'feature_AutoShowMore', name: 'Auto Mehr anzeigen', desc: 'Klickt automatisch auf Mehr anzeigen auf der Startseite.' },
        // feature_TrackerBlocker: FELSENFEST (2026-09-09) -- Ruleset laeuft immer,
        // kein Toggle. Ebenso BadgeRemover (gar nicht gelistet, hartverdrahtet).
        { id: 'feature_CleanHomepage', name: 'Startseite aufraeumen', desc: 'Versteckt Kategorien und irrelevante Bloecke (Tier 2).' },
        // feature_ProAdManager: FELSENFEST (2026-09-09) -- Filler-Slots und
        // TOP/PRO-Anzeigen werden immer ausgeblendet, kein Toggle mehr.
        { id: 'feature_DataExport', name: 'Datenexport (Auto-Scraper)', desc: 'Vollautomatischer Such-Scraper fuer LLM-Daten (JSONL).' },
        { id: 'feature_AdRecorder', name: 'Such-Aufnahme (REC)', desc: 'REC druecken, durch die Seiten blaettern, alle Anzeigen werden per API (ohne Bilder) gesammelt.' },
        { id: 'feature_McpBridge', name: 'MCP Bridge (DevTools)', desc: 'Lokaler WS 127.0.0.1:8765, nur mit Token. Dev-only.' }
    ];

    function injectHamburger() {
        if (document.getElementById('ka-inpage-menu-btn')) return;
        const targetContainer = document.querySelector('span.flex.grow.flex-row.flex-nowrap.items-center.justify-end');
        if (!targetContainer) {
            setTimeout(injectHamburger, 500);
            return;
        }
        const btn = document.createElement('button');
        btn.id = 'ka-inpage-menu-btn';
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>';
        btn.title = 'Kleinanzeigen Rental Analyzer Settings';
        btn.addEventListener('click', openSidebar);
        targetContainer.appendChild(btn);
    }

    function renderContextInvalidatedNotice(content) {
        content.innerHTML = '';
        const notice = document.createElement('div');
        notice.className = 'ka-context-invalidated-notice';
        notice.style.cssText = 'padding: 16px; text-align: center; font-size: 13px; line-height: 1.5;';
        notice.innerHTML = 'Die Erweiterung wurde neu geladen, seit diese Seite geöffnet wurde.<br>Bitte die Seite einmal neu laden.<br><button class="ka-reload-btn" id="ka-context-reload-btn" style="margin-top: 10px;">Seite neu laden</button>';
        content.appendChild(notice);
        document.getElementById('ka-context-reload-btn')?.addEventListener('click', () => window.location.reload());
    }

    function createSidebar() {
        if (document.getElementById('ka-inpage-sidebar')) return;
        const overlay = document.createElement('div');
        overlay.id = 'ka-inpage-sidebar-overlay';
        overlay.addEventListener('click', closeSidebar);
        const sidebar = document.createElement('div');
        sidebar.id = 'ka-inpage-sidebar';
        const header = document.createElement('div');
        header.className = 'ka-sidebar-header';
        header.innerHTML = '<h2>KA Settings</h2><button class="ka-close-btn">&times;</button>';
        header.querySelector('.ka-close-btn').addEventListener('click', closeSidebar);
        const content = document.createElement('div');
        content.className = 'ka-sidebar-content';
        sidebar.appendChild(header);
        sidebar.appendChild(content);
        document.body.appendChild(overlay);
        document.body.appendChild(sidebar);
        try {
            chrome.storage.local.get(['ka_settings'], (result) => {
                try {
                    const settings = result.ka_settings || {};
                    if (settings.McpBridge === true && settings.feature_McpBridge !== true) {
                        settings.feature_McpBridge = true;
                        delete settings.McpBridge;
                        chrome.storage.local.set({ ka_settings: settings });
                    }
                    MODULES.forEach(mod => {
                        const isEnabled = KAStorage.isFeatureEnabled(settings, mod.id);
                        const item = document.createElement('div');
                        item.className = 'ka-module-item';
                        item.innerHTML = '<div class="ka-module-info"><h3>' + mod.name + '</h3><p>' + mod.desc + '</p></div><label class="ka-switch"><input type="checkbox" id="ka-ui-' + mod.id + '" ' + (isEnabled ? 'checked' : '') + '><span class="ka-slider"></span></label>';
                        const checkbox = item.querySelector('#ka-ui-' + mod.id);
                        checkbox.addEventListener('change', () => {
                            try {
                                settings[KAStorage.featureKey(mod.id)] = checkbox.checked === true;
                                chrome.storage.local.set({ ka_settings: settings });
                                window.location.reload();
                            } catch (e) {
                                console.error('[KA InPageMenu] Fehler beim Speichern:', e);
                                renderContextInvalidatedNotice(content);
                            }
                        });
                        content.appendChild(item);
                    });
                } catch (e) {
                    console.error('[KA InPageMenu] Fehler beim Rendern:', e);
                    renderContextInvalidatedNotice(content);
                }
            });
        } catch (e) {
            console.error('[KA InPageMenu] Extension-Kontext ungueltig:', e);
            renderContextInvalidatedNotice(content);
        }
    }

    function openSidebar() {
        try {
            createSidebar();
            setTimeout(() => {
                document.getElementById('ka-inpage-sidebar-overlay')?.classList.add('active');
                document.getElementById('ka-inpage-sidebar')?.classList.add('active');
            }, 10);
        } catch (e) {
            console.error('[KA InPageMenu] Fehler beim Oeffnen:', e);
        }
    }

    function closeSidebar() {
        document.getElementById('ka-inpage-sidebar-overlay')?.classList.remove('active');
        document.getElementById('ka-inpage-sidebar')?.classList.remove('active');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectHamburger);
    } else {
        injectHamburger();
    }

    function initObserver() {
        if (!document.documentElement) {
            setTimeout(initObserver, 50);
            return;
        }
        let debounceTimer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(injectHamburger, 400);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    initObserver();
})();
