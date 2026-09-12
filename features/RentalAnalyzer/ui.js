const KAUI = {
    activeCategory: null,
    activeRegion: null,

    injectHeaderButton() {
        if (document.getElementById('ka-header-analyzer-btn')) return;
        
        const searchContainer = document.querySelector('[data-testid="search-bar-container"]') || 
                                document.querySelector('#site-search-form');

        if (searchContainer) {
            // WICHTIG: Den Eltern-Container auf Flex stellen, damit sie nebeneinander stehen
            const parent = searchContainer.parentNode;
            if (parent) {
                parent.style.display = 'flex';
                parent.style.alignItems = 'center';
            }

            const btn = document.createElement('button');
            btn.id = 'ka-header-analyzer-btn';
            btn.className = 'ka-header-btn';
            btn.title = 'Rental Analyzer scharfschalten';
            btn.innerHTML = `
                <svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M40 35V93M40 64L80 35M40 64L80 93" stroke="white" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;
            btn.onclick = (e) => {
                e.preventDefault();
                // FIX 2026-09-09: anzeige:angebote-Segment ist tot (57 Mio. Treffer);
                // funktionierendes Format ist Kategorie-ID im Pfad.
                window.location.href = 'https://www.kleinanzeigen.de/s-wohnung-mieten/c203+wohnung_mieten.swap_s:nein';
            };
            
            parent.insertBefore(btn, searchContainer);
            console.log("[KA-ANALYZER] Header-Button mit Flex-Zwang injiziert.");
        }
    },

    injectDashboard() {
        if (document.getElementById('ka-analyzer-dashboard')) return;
        const resultsList = document.querySelector('#srchrslt-adtable') || document.querySelector('#srchrslt-results') || document.querySelector('.ad-list');
        if (resultsList) {
            const dash = document.createElement('div');
            dash.id = 'ka-analyzer-dashboard';
            resultsList.parentNode.insertBefore(dash, resultsList);
        }
    },

    setLoading(msg = "Warte auf Anzeigen...") {
        const dash = document.getElementById('ka-analyzer-dashboard');
        if (dash) dash.innerHTML = `<div style="padding: 15px; width: 100%; text-align: center; color: #666;">${msg}</div>`;
    },

    updateDashboard(globalStats, regionalStats, db, currentAdsCount) {
        const dash = document.getElementById('ka-analyzer-dashboard');
        if (!dash) return;

        const totalDbCount = Object.keys(db.ads).length;

        const rowHtml = regionalStats.map(r => `
            <div class="ka-matrix-row">
                <div class="ka-matrix-grid">
                    <div class="ka-matrix-cell ka-low ${this.activeCategory === 'low' && this.activeRegion === r.plz ? 'active' : ''}" data-type="low" data-plz="${r.plz}">
                        <span class="ka-matrix-label">Günstig</span>
                        <span class="ka-matrix-price">${Math.round(r.q1).toLocaleString('de-DE')} €</span>
                    </div>
                    <div class="ka-matrix-cell ka-mid ${this.activeCategory === 'mid' && this.activeRegion === r.plz ? 'active' : ''}" data-type="mid" data-plz="${r.plz}">
                        <span class="ka-matrix-label">Mittel</span>
                        <span class="ka-matrix-price">${Math.round(r.median).toLocaleString('de-DE')} €</span>
                    </div>
                    <div class="ka-matrix-cell ka-high ${this.activeCategory === 'high' && this.activeRegion === r.plz ? 'active' : ''}" data-type="high" data-plz="${r.plz}">
                        <span class="ka-matrix-label">Teuer</span>
                        <span class="ka-matrix-price">${Math.round(r.q3).toLocaleString('de-DE')} €</span>
                    </div>
                </div>
                <div class="ka-matrix-footer">
                    <span>Region <b>${r.plz}</b></span>
                    <span>Basis: <b>${r.onPage}/${r.inHistory}</b> Anzeigen</span>
                </div>
            </div>
        `).join('');

        dash.innerHTML = `
            ${rowHtml || '<div style="padding:15px; text-align:center;">Warte auf regionale Daten...</div>'}
            
            <div id="ka-dash-meta">
                <div>Datenbank (Total): <b>${totalDbCount}</b> Einträge</div>
                <div style="display: flex; gap: 10px;">
                    <button id="ka-dash-export-btn">CSV Export (Alles)</button>
                    <button id="ka-dash-clear-btn">DB leeren</button>
                </div>
            </div>
        `;

        dash.querySelectorAll('.ka-matrix-cell').forEach(cell => {
            cell.onclick = () => this.toggleMatrixFilter(cell.dataset.type, cell.dataset.plz);
        });

        document.getElementById('ka-dash-clear-btn').onclick = async () => {
            if (confirm('Gesamte Datenbank löschen?')) { await KAStorage.set('rental_db', { ads: {} }); location.reload(); }
        };

        document.getElementById('ka-dash-export-btn').onclick = () => this.exportDatabaseToCSV(db.ads);
    },

    exportDatabaseToCSV(ads) {
        const rows = [["ID", "PLZ", "Euro_pro_m2", "Datum"]];
        for (const id in ads) {
            const item = ads[id];
            const date = new Date(item.t).toISOString().split('T')[0];
            rows.push([id, item.plz, item.p.toFixed(2).replace('.', ','), date]);
        }
        const csvContent = "\uFEFF" + rows.map(e => e.join(";")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `mietanalyse_gesamt_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    toggleMatrixFilter(category, plz) {
        if (this.activeCategory === category && this.activeRegion === plz) {
            this.activeCategory = null; this.activeRegion = null;
        } else {
            this.activeCategory = category; this.activeRegion = plz;
        }
        const ads = document.querySelectorAll('article[data-adid], .aditem');
        ads.forEach(ad => {
            const listItem = ad.closest('.ad-listitem') || ad;
            if (ad.style.display === 'none' && !ad.classList.contains('ka-filtered')) return; 
            if (!this.activeCategory) {
                listItem.style.display = ''; ad.classList.remove('ka-filtered');
            } else {
                const hasPriceClass = ad.classList.contains(`ka-price-${this.activeCategory}`);
                // PLZ aus dem dataset, das run() beim Markieren setzt
                // (Datenlayer-Umbau: kein On-Demand-Parser-Text-Scrape mehr)
                const adPlz = ad.dataset.kaPlz || "";
                const hasPlzMatch = adPlz.startsWith(plz.replace('X', ''));
                const matches = hasPriceClass && hasPlzMatch;
                listItem.style.display = matches ? '' : 'none';
                if (!matches) ad.classList.add('ka-filtered'); else ad.classList.remove('ka-filtered');
            }
        });
        this.updateDashboardState();
    },

    updateDashboardState() {
        document.querySelectorAll('.ka-matrix-cell').forEach(c => {
            if (c.dataset.type === this.activeCategory && c.dataset.plz === this.activeRegion) c.classList.add('active');
            else c.classList.remove('active');
        });
    },

    markAd(article, pricePerSqm, stats) {
        article.classList.remove('ka-price-low', 'ka-price-mid', 'ka-price-high', 'ka-outlier');
        let badge = article.querySelector('.ka-sqm-badge');
        if (!badge) {
            badge = document.createElement('div'); badge.className = 'ka-sqm-badge';
            // Anker-Kaskade (2026-09-09): .aditem-main--middle* ist tot (Tailwind-
            // Redesign, live verifiziert) -- Fallback haengt den Badge direkt an
            // die Karte (article, position:relative via CSS) .
            const box = article.querySelector('.aditem-main--middle--price-shipping')
                || article.querySelector('.aditem-main--middle')
                || article;
            box.appendChild(badge);
            if (box === article) badge.classList.add('ka-sqm-badge-float');
        }
        // Deal-Score (2026-09-09): >20% unter dem Such-Median = Ankaufskandidat
        // (Octoparse/jkopka-Pattern, Median kommt aus kaStats.calculate)
        badge.innerHTML = '';
        const priceSpan = document.createElement('span');
        // Ganzzahl reicht (2026-09-09): "12 EUR/m2" statt "12,50" -- die Dezimalen
        // suggerieren Genauigkeit, die die m2-Schaetzung ohnehin nicht hat.
        priceSpan.textContent = `${Math.round(pricePerSqm).toLocaleString('de-DE')} €/m²`;
        badge.appendChild(priceSpan);
        if (stats && stats.median && pricePerSqm <= stats.median * 0.8) {
            const deal = document.createElement('span');
            deal.className = 'ka-deal-chip';
            const pct = Math.round((1 - pricePerSqm / stats.median) * 100);
            deal.textContent = `Deal −${pct}%`;
            deal.title = `Median dieser Suche: ${Math.round(stats.median).toLocaleString('de-DE')} €/m²`;
            badge.appendChild(deal);
        }
        if (pricePerSqm < stats.lowerFence || pricePerSqm > stats.upperFence) article.classList.add('ka-outlier');
        else if (pricePerSqm <= stats.q1) article.classList.add('ka-price-low');
        else if (pricePerSqm <= stats.q3) article.classList.add('ka-price-mid');
        else article.classList.add('ka-price-high');
    },

    // On-Demand-Enrichment-Anzeige (2026-09-09): GPS/Seller/Views am Badge als
    // Tooltip + zweite Zeile. Wird vom KARentalEnrich-Modus gefuettert.
    updateEnrichment(article, info) {
        const badge = article.querySelector('.ka-sqm-badge');
        if (!badge || !info) return;
        const parts = [];
        if (info.location) {
            parts.push(`📍 ${info.location.zip || '?'} ${info.location.name || ''}`);
            if (info.location.lat != null) parts.push(`GPS ${info.location.lat.toFixed(3)}, ${info.location.lng.toFixed(3)}`);
        }
        if (info.seller) {
            parts.push(`👤 ${info.seller.accountType || '?'} · ★${info.seller.rating != null ? info.seller.rating : '?'} · seit ${(info.seller.since || '?').slice(0, 10)}`);
        }
        if (info.views != null) parts.push(`👁 ${info.views}`);
        if (info.ageDays != null) parts.push(`🗓 ${info.ageDays} Tage online`);
        if (info.originalAmount != null && info.price && info.price.amount != null) {
            parts.push(`⬇️ Preisreduktion von ${info.price.originalAmount} €`);
        }
        let flags = [];
        if (info.suspicious) flags.push('🚩 ' + (info.suspicious.reason || 'Gewerbe im Privat-Gewand'));
        if (info.stale) flags.push('💤 verstaubt: viele Views + alt → Verhandlungsspielraum');

        let line = badge.querySelector('.ka-enrich-line');
        if (!line) {
            line = document.createElement('div');
            line.className = 'ka-enrich-line';
            badge.appendChild(line);
        }
        line.textContent = parts.join(' · ') + (flags.length ? ' · ' + flags.join(' · ') : '');
        badge.title = parts.join('\n') + (flags.length ? '\n' + flags.join('\n') : '');
    },

    setEnrichmentPending(article) {
        const badge = article.querySelector('.ka-sqm-badge');
        if (!badge) return null;
        let line = badge.querySelector('.ka-enrich-line');
        if (!line) {
            line = document.createElement('div');
            line.className = 'ka-enrich-line';
            badge.appendChild(line);
        }
        line.textContent = '🔎 Lade Details (API)...';
        return line;
    },

    hideAd(ad) {
        const listItem = ad.closest('.ad-listitem') || ad;
        listItem.style.display = 'none';
    },

    lockFilters() {
        const filterTexts = ['Alle', 'Gesuche', 'Tauschangebot'];
        document.querySelectorAll('a, label, span').forEach(el => {
            if (filterTexts.some(txt => el.innerText.trim() === txt)) {
                el.style.opacity = '0.3'; el.style.pointerEvents = 'none';
            }
        });
        ['Filter Angebote entfernen', 'Filter Kein Tausch entfernen'].forEach(label => {
            const btn = document.querySelector(`a[aria-label="${label}"]`);
            if (btn) {
                btn.style.display = 'none';
                const p = btn.closest('.tag, .facet-active, .breadcrump-link, li');
                if (p) { p.style.pointerEvents = 'none'; p.style.opacity = '0.7'; }
            }
        });
    }
};
