/**
 * PIS Bridge - Integration between smart-office-noting and Agra-sandhani
 * Handles auto-filling nominee tables or plain form inputs based on PIS/Trigger number.
 * Upgraded with: Caching, Explicit Mapping, Health Checks, and Plain Form Support.
 */

const PISBridge = {
    // Configuration
    pisKeywords: ['pis', 'personnel', 'emp id', 'fax', 'roll no', 'id'],
    debounceTimer: null,
    searchAbortController: null,
    config: {
        fieldMap: {},    // Legacy fallback
        importMap: {},   // Maps: Noting Field -> Agra Field (For Lookup)
        exportMap: {},   // Maps: Noting Field -> Agra Field (For Export)
        agraFormId: '',
        agraImportFormId: '', // Form ID to import from
        agraExportFormId: '', // Form ID to export to
        statusId: null
    },
    
    /**
     * Initializes the bridge with specific settings
     */
    init: function(options) {
        console.log('[PIS Bridge] Initializing with options:', options);
        this.config = { ...this.config, ...options };
        
        // Setup separate Form IDs
        if (!this.config.agraImportFormId) {
            this.config.agraImportFormId = this.config.agraFormId;
        }
        if (!this.config.agraExportFormId) {
            this.config.agraExportFormId = this.config.agraFormId;
        }
        
        // Dynamic fallbacks for backward compatibility
        if (Object.keys(this.config.importMap || {}).length === 0) {
            this.config.importMap = this.config.fieldMap || {};
        }
        if (Object.keys(this.config.exportMap || {}).length === 0) {
            this.config.exportMap = this.config.fieldMap || {};
        }
        
        this.checkHealth();
        
        // If we are on a plain form (not a table-based noting), auto-attach to inputs
        const dynamicForm = document.getElementById('template-generation-form');
        if (dynamicForm) {
            console.log('[PIS Bridge] Detected Dynamic Form, scanning fields...');
            this.attachToPlainForm(dynamicForm);
        }
    },

    /**
     * Checks connection health to Agra-sandhani
     */
    checkHealth: async function() {
        if (!this.config.statusId) return;
        const statusEl = document.getElementById(this.config.statusId);
        if (!statusEl) return;
        const dot = statusEl.querySelector('#status-dot');
        const text = statusEl.querySelector('#status-text');

        try {
            const res = await fetch('/api/agra_forms');
            const data = await res.json();
            
            const form = data.forms?.find(f => f.id.toString() === this.config.agraFormId);
            if (form) {
                console.log('[PIS Bridge] Connected to Agra Form:', form.name);
                dot.style.background = '#2d7a2d';
                text.textContent = `Connected: ${form.name}`;
                statusEl.style.color = '#2d7a2d';
            } else {
                console.warn('[PIS Bridge] Form ID not found in Agra list:', this.config.agraFormId);
                dot.style.background = '#f0c040';
                text.textContent = `Using Global Default (ID: ${this.config.agraFormId || '23'})`;
            }
        } catch (e) {
            console.error('[PIS Bridge] Connection failed:', e);
            dot.style.background = '#cc3333';
            text.textContent = 'Agra-sandhani Offline';
            statusEl.style.color = '#cc3333';
        }
    },

    /**
     * Checks if a column or field name represents a trigger column (PIS, Fax, etc.)
     * Alias for isTriggerField used in some templates.
     */
    isPISColumn: function(name) {
        return this.isTriggerField(name);
    },

    /**
     * Checks if a column or field name represents a trigger column (PIS, Fax, etc.)
     */
    isTriggerField: function(name) {
        if (!name) return false;
        const normalizedName = name.toLowerCase().replace(/_/g, ' ').trim();
        
        // 0. Explicitly exclude data-only fields that might contain trigger keywords
        if (normalizedName.includes('email') || normalizedName.includes('drona')) return false;

        // 1. Check explicit map entries - if it's in the importMap, it CAN be a trigger
        const mapKeys = Object.keys(this.config.importMap || {});
        for (let key of mapKeys) {
            const normalizedKey = key.toLowerCase().replace(/_/g, ' ').trim();
            if (normalizedKey === normalizedName) return true;
        }
        
        // 2. Fallback to generalized trigger keywords
        const triggerKeywords = ['pis', 'personnel', 'emp id', 'fax', 'roll no', 'id', 'p.i.s.'];
        return triggerKeywords.some(kw => {
            if (kw === 'id') {
                return normalizedName === 'id' || normalizedName.includes('emp id') || normalizedName.includes('pis');
            }
            return normalizedName.includes(kw);
        });
    },

    /**
     * Finds the best value to fill into a specific input based on configuration
     * This is the "Engine" that powers the dynamic mapping from Master Manager
     */
    getBestValueForCol: function(colName, fetchedData) {
        if (!fetchedData || !fetchedData.data) return null;
        const data = fetchedData.data;
        
        // Normalize the input name/ID (e.g., "FAX_NO" or "fax no" -> "faxno")
        const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const target = normalize(colName);
        
        const explicitMap = this.config.importMap || {};

        // 1. Check Explicit Mapping (Priority)
        for (const [notingVar, agraLabel] of Object.entries(explicitMap)) {
            if (normalize(notingVar) === target) {
                const actualAgraKey = Object.keys(data).find(k => normalize(k) === normalize(agraLabel));
                if (actualAgraKey) {
                    console.log(`[PIS Bridge] Mapping hit: ${notingVar} -> ${agraLabel}`);
                    return data[actualAgraKey];
                }
            }
        }

        // 2. Exact/Normalized Direct Match
        const directMatch = Object.keys(data).find(k => normalize(k) === target);
        if (directMatch) {
            console.log(`[PIS Bridge] Direct hit: ${colName}`);
            return data[directMatch];
        }

        // 3. Fuzzy Compound Matching (e.g., "Name & Design." contains "Name")
        // Also handle "Qualification/DOB/Venue" matching "DOB"
        const agraKeys = Object.keys(data);
        
        // Handle multi-value columns (e.g., "Name & Design" or "Email / Mobile")
        if (colName.includes('&') || colName.includes('/') || colName.toLowerCase().includes(' and ')) {
            const parts = colName.split(/[&/]| and /i).map(p => normalize(p));
            let combinedValues = [];
            
            parts.forEach(part => {
                if (part.length < 2) return;
                const match = agraKeys.find(k => {
                    const nk = normalize(k);
                    return nk === part || (nk.length > 3 && (part.includes(nk) || nk.includes(part)));
                });
                if (match && data[match]) combinedValues.push(data[match]);
            });
            
            if (combinedValues.length > 0) {
                console.log(`[PIS Bridge] Multi-match hit for ${colName}:`, combinedValues);
                return combinedValues.join(' / ');
            }
        }

        for (const key of agraKeys) {
            const normKey = normalize(key);
            if (normKey.length < 3) continue; // Skip very short keys to avoid false positives

            // If the noting column contains the Agra key as a word or segment
            // e.g., "namedesign" contains "name" or "design"
            if (target.includes(normKey) || normKey.includes(target)) {
                console.log(`[PIS Bridge] Fuzzy hit: ${colName} matches ${key}`);
                return data[key];
            }
        }

        // 4. Special cases for common noting columns
        if (target.includes('namedesign')) {
            const nameKey = agraKeys.find(k => normalize(k) === 'name');
            const desigKey = agraKeys.find(k => normalize(k).includes('desig') || normalize(k).includes('rank'));
            if (nameKey && desigKey) return `${data[nameKey]} / ${data[desigKey]}`;
            if (nameKey) return data[nameKey];
        }

        return null;
    },

    /**
     * Fetches data for a given PIS/Trigger number (Full Record)
     */
    fetchData: async function(pisValue, bypassCache = false) {
        if (!pisValue || pisValue.trim() === '') return null;
        
        const formId = this.config.agraImportFormId || this.config.agraFormId;
        const cacheKey = `pis_cache_${formId}_${pisValue.trim()}`;
        
        if (!bypassCache) {
            const cachedEntry = sessionStorage.getItem(cacheKey);
            if (cachedEntry) {
                try {
                    const parsed = JSON.parse(cachedEntry);
                    // Handle both old format (direct data) and new format ({data, timestamp})
                    const data = parsed.data || parsed;
                    const timestamp = parsed.timestamp || 0;
                    
                    const ttl = 10 * 60 * 1000; // 10 minutes TTL
                    if (Date.now() - timestamp < ttl) {
                        console.log('[PIS Bridge] Serving from cache:', pisValue);
                        return data;
                    }
                } catch (e) {
                    sessionStorage.removeItem(cacheKey);
                }
            }
        }

        console.log('[PIS Bridge] Fetching from API:', pisValue);
        
        try {
            const url = `/api/fetch_pis?pis=${encodeURIComponent(pisValue.trim())}${formId ? '&formId=' + formId : ''}`;
            const response = await fetch(url);
            if (!response.ok) {
                console.error('[PIS Bridge] Fetch failed:', response.status);
                return null;
            }
            const data = await response.json();
            console.log('[PIS Bridge] Data received');
            
            // Cache for session with timestamp
            const entry = { data: data, timestamp: Date.now() };
            sessionStorage.setItem(cacheKey, JSON.stringify(entry));
            return data;
        } catch (error) {
            console.error('[PIS Bridge] Fetch error:', error);
            return null;
        }
    },

    searchPIS: async function(query) {
        if (!query || query.length < 2) return [];
        console.log('[PIS Bridge] Searching for:', query);

        // Abort previous search request if still running
        if (this.searchAbortController) {
            try {
                this.searchAbortController.abort();
            } catch(e) {}
        }
        this.searchAbortController = new AbortController();

        const formId = this.config.agraImportFormId || this.config.agraFormId;

        try {
            const url = `/api/search_pis?query=${encodeURIComponent(query)}${formId ? '&formId=' + formId : ''}`;
            const response = await fetch(url, { signal: this.searchAbortController.signal });
            if (!response.ok) {
                console.error('[PIS Bridge] Search API failed:', response.status);
                return [];
            }
            const data = await response.json();
            console.log(`[PIS Bridge] Search returned ${data.results?.length || 0} results`);
            return data.results || [];
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('[PIS Bridge] Search request aborted');
            } else {
                console.error('[PIS Bridge] Search error:', error);
            }
            return [];
        }
    },

    /**
     * Auto-fills a plain form (Dynamic Form or Standard Form)
     */
    fillPlainForm: function(fetchedData, triggerFieldKey = null) {
        if (!fetchedData || !fetchedData.data) return;
        
        // Find all inputs in the active form container or globally if not found
        let container = document.getElementById('template-generation-form') || 
                        document.getElementById('notingForm') || 
                        document.querySelector('.form-container') || 
                        document.body;

        const inputs = container.querySelectorAll('input[type="text"], input[type="date"], textarea');
        
        inputs.forEach(input => {
            const varName = input.id || input.name;
            if (!varName) return;

            // Skip the field the user is currently typing in
            if (triggerFieldKey && this.getMapKeyForInput(input) === triggerFieldKey) return;

            const val = this.getBestValueForCol(varName, fetchedData);
            if (val !== null && val !== undefined) {
                input.value = val;
                // Trigger change event for any listeners
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.style.backgroundColor = '#e6fffa';
                setTimeout(() => { input.style.backgroundColor = ''; }, 2000);
            }
        });
    },

    /**
     * Auto-fills a row in a table (Standard Noting)
     */
    fillRow: function(rowIndex, fetchedData, triggerColName = null) {
        if (!fetchedData || !fetchedData.data) return;
        
        const rowInputs = document.querySelectorAll(`.nominee-cell-input[data-row="${rowIndex}"]`);
        
        rowInputs.forEach(input => {
            const colName = input.getAttribute('data-col');
            if (!colName) return;

            // Skip the active trigger column
            if (triggerColName && colName === triggerColName) return;

            const val = this.getBestValueForCol(colName, fetchedData);
            if (val !== null && val !== undefined) {
                input.value = val;
                input.style.backgroundColor = '#e6fffa';
                setTimeout(() => { input.style.backgroundColor = ''; }, 2000);
            }
        });
    },

    /**
     * Create or get global list element
     */
    getGlobalList: function() {
        let list = document.getElementById('global-pis-autocomplete');
        if (!list) {
            console.log('[PIS Bridge] Creating global list element');
            list = document.createElement('div');
            list.id = 'global-pis-autocomplete';
            list.style.cssText = `
                position: fixed;
                z-index: 2147483647;
                background: #ffffff;
                border: 2px solid #002D62;
                border-radius: 6px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.6);
                display: none;
                max-height: 350px;
                overflow-y: auto;
                min-width: 320px;
                pointer-events: auto;
            `;
            document.body.appendChild(list);
            
            // Close on click outside
            document.addEventListener('mousedown', (e) => {
                const activeInput = document.activeElement;
                if (!list.contains(e.target) && (!activeInput || !activeInput.classList.contains('pis-input'))) {
                    list.style.display = 'none';
                }
            });
        }
        return list;
    },

    /**
     * Attaches to a plain form (non-table)
     */
    attachToPlainForm: function(form) {
        console.log('[PIS Bridge] Scanning form for trigger fields...');
        const inputs = form.querySelectorAll('input[type="text"], input[type="date"], textarea');
        inputs.forEach(input => {
            const varName = input.id || input.name;
            if (this.isTriggerField(varName)) {
                console.log(`[PIS Bridge] Attaching to field: ${varName}`);
                this.attachToInput(input, true);
            }
        });
    },

    /**
     * Resolves the actual key from fieldMap that matches an input
     */
    getMapKeyForInput: function(input) {
        const name = input.getAttribute('data-col') || input.id || input.name;
        if (!name) return null;
        const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const target = normalize(name);
        
        const mapKeys = Object.keys(this.config.importMap || {});
        // Try to find the exact key used in the map
        return mapKeys.find(key => normalize(key) === target) || name;
    },

    /**
     * Attaches Autocomplete to an input
     * @param {HTMLElement} input The input element
     * @param {Boolean} isPlainForm If true, fills the whole form instead of a row
     */
    attachToInput: function(input, isPlainForm = false) {
        const self = this; // Capture context for event handlers
        input.classList.add('pis-input');
        const rowIndex = input.getAttribute('data-row');
        const list = self.getGlobalList();

        const positionList = () => {
            const rect = input.getBoundingClientRect();
            list.style.top = (rect.bottom + 5) + 'px';
            list.style.left = rect.left + 'px';
            list.style.width = Math.max(rect.width, 320) + 'px';
            list.style.display = 'block';
        };

        const triggerSearch = async () => {
            const query = input.value;
            console.log('[PIS Bridge] Triggering search for:', query);
            
            if (query.length < 2) {
                list.style.display = 'none';
                return;
            }

            const results = await self.searchPIS(query);

            if (results.length > 0) {
                console.log('[PIS Bridge] Displaying results list');
                list.innerHTML = results.map(r => `
                    <div class="pis-item" style="padding: 12px 15px; cursor: pointer; border-bottom: 1px solid #eee; background: #fff;" 
                         onmouseover="this.style.background='#f0f7ff'" onmouseout="this.style.background='#fff'">
                        <div style="font-weight: 800; color: #002D62; font-size: 0.95rem; margin-bottom: 2px;">${r.pis}</div>
                        <div style="font-size: 0.8rem; color: #333; line-height: 1.2;">${r.name}</div>
                    </div>
                `).join('');
                
                positionList();

                const items = list.querySelectorAll('.pis-item');
                results.forEach((r, idx) => {
                    items[idx].onclick = async (ev) => {
                        ev.stopPropagation();
                        ev.preventDefault();
                        console.log('[PIS Bridge] Selected item:', r.pis);
                        
                        // 1. Clear autocomplete
                        list.style.display = 'none';
                        
                        // 2. Fetch full record
                        const fullResult = await self.fetchData(r.pis);
                        if (!fullResult) {
                            input.value = r.pis;
                            return;
                        }

                        // 3. Context-aware value injection
                        const colName = input.getAttribute('data-col') || input.id || input.name;
                        const triggerKey = self.getMapKeyForInput(input);
                        const contextValue = self.getBestValueForCol(colName, fullResult);
                        
                        input.value = contextValue || r.pis;

                        // 4. Fill the rest of the form/row
                        if (isPlainForm) self.fillPlainForm(fullResult, triggerKey);
                        else self.fillRow(rowIndex, fullResult, colName);
                        
                        input.focus();
                    };
                });
            } else {
                console.log('[PIS Bridge] No results found to show');
                list.style.display = 'none';
            }
        };

        input.addEventListener('input', () => {
            clearTimeout(self.debounceTimer);
            self.debounceTimer = setTimeout(triggerSearch, 300);
        });

        input.addEventListener('focus', () => {
            if (input.value.length >= 2) triggerSearch();
        });

        input.addEventListener('blur', async () => {
            // Wait slightly to see if we clicked an autocomplete item instead
            setTimeout(async () => {
                if (list.style.display === 'none' && input.value.length >= 2) {
                    const result = await self.fetchData(input.value);
                    if (result) {
                        const colName = input.getAttribute('data-col') || input.id || input.name;
                        const triggerKey = self.getMapKeyForInput(input);
                        const contextValue = self.getBestValueForCol(colName, result);
                        if (contextValue) input.value = contextValue;

                        if (isPlainForm) self.fillPlainForm(result, triggerKey);
                        else self.fillRow(rowIndex, result, colName);
                    }
                }
            }, 250);
        });

        // Also trigger on 'Enter' key
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                list.style.display = 'none';
                const result = await self.fetchData(input.value);
                if (result) {
                    const colName = input.getAttribute('data-col') || input.id || input.name;
                    const triggerKey = self.getMapKeyForInput(input);
                    const contextValue = self.getBestValueForCol(colName, result);
                    if (contextValue) input.value = contextValue;

                    if (isPlainForm) self.fillPlainForm(result, triggerKey);
                    else self.fillRow(rowIndex, result, colName);
                }
            }
        });

        // Track scroll/resize to keep pinned to input
        const updateOnScroll = () => {
            if (list.style.display === 'block' && document.activeElement === input) {
                positionList();
            }
        };

        window.addEventListener('scroll', updateOnScroll, true);
        window.addEventListener('resize', updateOnScroll);

        // Add Manual Fetch Button
        const parent = input.parentElement;
        if (parent && !parent.querySelector('.btn-pis-fetch')) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-link p-0 ms-1 btn-pis-fetch';
            btn.style.cssText = 'font-size: 0.9rem; text-decoration: none;';
            btn.innerHTML = '🔍';
            btn.onclick = async (e) => {
                e.stopPropagation();
                const result = await self.fetchData(input.value, true);
                if (result) {
                    const colName = input.getAttribute('data-col') || input.id || input.name;
                    const triggerKey = self.getMapKeyForInput(input);
                    if (isPlainForm) self.fillPlainForm(result, triggerKey);
                    else self.fillRow(rowIndex, result, colName);
                }
                else alert('PIS/ID not found');
            };
            if (parent.classList.contains('form-group') || parent.tagName === 'TD') {
                parent.style.position = 'relative';
                // For plain forms, we might need a different placement
                if (isPlainForm) {
                    btn.style.position = 'absolute';
                    btn.style.right = '10px';
                    btn.style.top = '35px';
                }
                parent.appendChild(btn);
            }
        }
    },

    /**
     * Exports noting data to Agra-sandhani by generating a prefill token session
     * and redirecting the browser to the prefilled form.
     * @param {Object} rowData Nominee row details (optional)
     */
    exportToForm: async function(rowData = null) {
        const exportFormId = this.config.agraExportFormId || this.config.agraFormId;
        if (!exportFormId) {
            alert("No target Agra-sandhani form mapped to this master.");
            return;
        }

        // 1. Gather all flat form inputs
        const flatValues = {};
        const container = document.getElementById('notingForm') || 
                          document.getElementById('template-generation-form') || 
                          document.querySelector('.form-container') || 
                          document.body;
        const inputs = container.querySelectorAll('input[type="text"], input[type="date"], select, textarea');
        
        inputs.forEach(input => {
            const name = input.name || input.id;
            if (name && !input.classList.contains('nominee-cell-input') && !input.classList.contains('pis-input')) {
                flatValues[name] = input.value;
            }
        });

        // Add special computed fields
        const refSource = document.getElementById('ref_source')?.value;
        const refMailDate = document.getElementById('ref_mail_date')?.value;
        if (refSource && refMailDate) {
            flatValues['reference_text'] = `${refSource} Dated: ${refMailDate}`;
        }

        // 2. Combine flat fields and row data
        const mergedData = { ...flatValues };
        if (rowData) {
            Object.assign(mergedData, rowData);
        }

        // 3. Map Noting variables to Agra-sandhani labels using exportMap
        const mappedPrefill = {};
        const explicitMap = this.config.exportMap || {};

        // Normalize helper
        const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9]/g, '').trim();

        // Map values
        Object.entries(mergedData).forEach(([notingVar, val]) => {
            if (!val) return;
            const targetMapKey = Object.keys(explicitMap).find(k => normalize(k) === normalize(notingVar));
            if (targetMapKey) {
                const agraLabel = explicitMap[targetMapKey];
                mappedPrefill[agraLabel] = val;
            }
        });

        console.log('[PIS Bridge] Mapped prefill data:', mappedPrefill);

        if (Object.keys(mappedPrefill).length === 0) {
            alert("None of the fields on this form are currently mapped to the target Agra-sandhani form. Please configure mapping in Master Manager first.");
            return;
        }

        try {
            // 4. Create prefill session on Node backend via Flask proxy
            const response = await fetch('/api/prefill_proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    formId: exportFormId,
                    values: mappedPrefill
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to create prefill session: ${response.statusText}`);
            }

            const sessionData = await response.json();
            const token = sessionData.prefillToken;

            // 5. Redirect browser to Agra-sandhani Form submit page with prefillToken
            const port = 5000;
            const agraHost = `${window.location.protocol}//${window.location.hostname}:${port}`;
            const targetUrl = `${agraHost}/forms/${exportFormId}/submit?prefillToken=${token}`;

            console.log('[PIS Bridge] Redirecting to:', targetUrl);
            window.open(targetUrl, '_blank');
        } catch (e) {
            alert(`Error exporting to form: ${e.message}`);
        }
    }
};
