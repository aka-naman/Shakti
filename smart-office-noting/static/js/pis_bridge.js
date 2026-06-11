/**
 * PIS Bridge - Integration between smart-office-noting and Agra-sandhani
 * Handles auto-filling nominee tables or plain form inputs based on PIS/Trigger number.
 * Upgraded with: Caching, Explicit Mapping, Health Checks, and Plain Form Support.
 */

const PISBridge = {
    // Configuration
    pisKeywords: ['pis', 'personnel', 'emp id', 'fax', 'roll no', 'id'],
    debounceTimer: null,
    config: {
        fieldMap: {},
        agraFormId: '',
        statusId: null
    },
    
    /**
     * Initializes the bridge with specific settings
     */
    init: function(options) {
        this.config = { ...this.config, ...options };
        this.checkHealth();
        
        // If we are on a plain form (not a table-based noting), auto-attach to inputs
        const dynamicForm = document.getElementById('template-generation-form');
        if (dynamicForm) {
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
            if (data.error) throw new Error(data.error);
            
            const form = data.forms.find(f => f.id.toString() === this.config.agraFormId);
            if (form) {
                dot.style.background = '#2d7a2d';
                text.textContent = `Connected: ${form.name}`;
                statusEl.style.color = '#2d7a2d';
            } else {
                dot.style.background = '#f0c040';
                text.textContent = `Using Global Default (ID: ${this.config.agraFormId || '23'})`;
            }
        } catch (e) {
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

        // 1. Check explicit map entries - if it's in the map, it CAN be a trigger
        const mapKeys = Object.keys(this.config.fieldMap || {});
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
     * Finds the best value to fill into a specific column from fetched data
     */
    getBestValueForCol: function(colName, fetchedData) {
        if (!fetchedData || !fetchedData.data) return null;
        const data = fetchedData.data;
        const lowerCol = colName.toLowerCase().replace(/\./g, '');
        
        // 1. Explicit map
        const explicit = this.config.fieldMap || {};
        if (explicit[colName] && data[explicit[colName]]) return data[explicit[colName]];

        // 2. Fuzzy match in suggested mapping
        const suggested = fetchedData.suggested_mapping || {};
        
        // Special case for PIS: if column looks like PIS/ID
        if (lowerCol.includes('pis') || lowerCol.includes('id') || lowerCol.includes('token')) {
            if (suggested.pis && data[suggested.pis]) return data[suggested.pis];
        }

        for (const [key, label] of Object.entries(suggested)) {
            if (lowerCol.includes(key)) return data[label];
        }

        // 3. Exact key match
        for (const key of Object.keys(data)) {
            if (key.toLowerCase() === lowerCol) return data[key];
        }

        return null;
    },

    /**
     * Fetches data for a given PIS/Trigger number (Full Record)
     */
    fetchData: async function(pisValue) {
        if (!pisValue || pisValue.trim() === '') return null;
        
        const cacheKey = `pis_cache_${this.config.agraFormId}_${pisValue.trim()}`;
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) return JSON.parse(cached);
        
        const formId = this.config.agraFormId;
        
        try {
            const url = `/api/fetch_pis?pis=${encodeURIComponent(pisValue.trim())}${formId ? '&formId=' + formId : ''}`;
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            
            // Cache for session
            sessionStorage.setItem(cacheKey, JSON.stringify(data));
            return data;
        } catch (error) {
            console.error('PIS Bridge Error:', error);
            return null;
        }
    },

    /**
     * Searches for PIS/Trigger numbers (Autocomplete)
     */
    searchPIS: async function(query) {
        if (!query || query.length < 2) return [];

        const formId = this.config.agraFormId;

        try {
            const url = `/api/search_pis?query=${encodeURIComponent(query)}${formId ? '&formId=' + formId : ''}`;
            const response = await fetch(url);
            const data = await response.json();
            return data.results || [];
        } catch (error) {
            return [];
        }
    },

    /**
     * Auto-fills a plain form (non-table)
     */
    fillPlainForm: function(fetchedData) {
        if (!fetchedData || !fetchedData.data) return;
        const data = fetchedData.data;
        const explicit = this.config.fieldMap || {};

        Object.entries(explicit).forEach(([notingVar, agraLabel]) => {
            // notingVar might contain spaces or be uppercase, e.g. "FAX NO"
            // The input ID is usually the variable name, e.g. "FAX_NO" or "FAX NO"
            // We search by ID or name
            const input = document.getElementById(notingVar) || 
                          document.getElementById(notingVar.replace(/ /g, '_')) ||
                          document.querySelector(`[name="${notingVar}"]`);
            
            if (input && !this.isTriggerField(notingVar)) {
                const foundValue = data[agraLabel];
                if (foundValue) {
                    input.value = foundValue;
                    input.style.backgroundColor = '#e6fffa';
                    setTimeout(() => { input.style.backgroundColor = ''; }, 2000);
                }
            }
        });
    },

    /**
     * Auto-fills a row in a table based on fetched data
     */
    fillRow: function(rowIndex, fetchedData) {
        if (!fetchedData || !fetchedData.data) return;

        const data = fetchedData.data;
        const suggested = fetchedData.suggested_mapping || {};
        const explicit = this.config.fieldMap || {};
        
        const rowInputs = document.querySelectorAll(`.nominee-cell-input[data-row="${rowIndex}"]`);
        
        rowInputs.forEach(input => {
            const colName = input.getAttribute('data-col');
            if (this.isTriggerField(colName)) return;

            const lowerCol = colName.toLowerCase();
            let foundValue = null;

            // 1. Priority: Explicit Mapping (User defined)
            if (explicit[colName]) {
                foundValue = data[explicit[colName]];
            }

            // 2. Secondary: Fuzzy Mapping from Backend
            if (!foundValue) {
                for (const [key, label] of Object.entries(suggested)) {
                    if (lowerCol.includes(key)) {
                        foundValue = data[label];
                        break;
                    }
                }
            }

            // 3. Fallback: Standard Keywords
            if (!foundValue) {
                if (lowerCol.includes('name')) foundValue = data[suggested.name];
                if (lowerCol.includes('desig')) {
                    const desigVal = data[suggested.designation];
                    if (desigVal) {
                        if (lowerCol.includes('name') && foundValue) foundValue = `${foundValue}, ${desigVal}`;
                        else foundValue = desigVal;
                    }
                }
                else if (lowerCol.includes('gen')) foundValue = data[suggested.gender];
                else if (lowerCol.includes('dob')) foundValue = data[suggested.dob];
                else if (lowerCol.includes('email') || lowerCol.includes('drona')) foundValue = data[suggested.email];
                else if (lowerCol.includes('cont') || lowerCol.includes('mobile') || lowerCol.includes('phone')) foundValue = data[suggested.mobile];
                else if (lowerCol.includes('quali')) foundValue = data[suggested.qualification];
            }

            if (foundValue) {
                input.value = foundValue;
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
        const inputs = form.querySelectorAll('input[type="text"], textarea');
        inputs.forEach(input => {
            const varName = input.id || input.name;
            if (this.isTriggerField(varName)) {
                this.attachToInput(input, true);
            }
        });
    },

    /**
     * Attaches Autocomplete to an input
     * @param {HTMLElement} input The input element
     * @param {Boolean} isPlainForm If true, fills the whole form instead of a row
     */
    attachToInput: function(input, isPlainForm = false) {
        input.classList.add('pis-input');
        const rowIndex = input.getAttribute('data-row');
        const list = this.getGlobalList();

        const positionList = () => {
            const rect = input.getBoundingClientRect();
            list.style.top = (rect.bottom + 5) + 'px';
            list.style.left = rect.left + 'px';
            list.style.width = Math.max(rect.width, 320) + 'px';
            list.style.display = 'block';
        };

        const triggerSearch = async () => {
            const query = input.value;
            
            if (query.length < 2) {
                list.style.display = 'none';
                return;
            }

            const results = await this.searchPIS(query);

            if (results.length > 0) {
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
                        
                        // 1. Clear autocomplete
                        list.style.display = 'none';
                        
                        // 2. Fetch full record
                        const fullResult = await this.fetchData(r.pis);
                        if (!fullResult) {
                            input.value = r.pis;
                            return;
                        }

                        // 3. Context-aware value injection
                        // Find what SHOULD go into the current input box based on its column name
                        const colName = input.getAttribute('data-col') || input.id || input.name;
                        const contextValue = this.getBestValueForCol(colName, fullResult);
                        
                        input.value = contextValue || r.pis;

                        // 4. Fill the rest of the form/row
                        if (isPlainForm) this.fillPlainForm(fullResult);
                        else this.fillRow(rowIndex, fullResult);
                        
                        input.focus();
                    };
                });
            } else {
                list.style.display = 'none';
            }
        };

        input.addEventListener('input', () => {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(triggerSearch, 300);
        });

        input.addEventListener('focus', () => {
            if (input.value.length >= 2) triggerSearch();
        });

        input.addEventListener('blur', async () => {
            // Wait slightly to see if we clicked an autocomplete item instead
            setTimeout(async () => {
                if (list.style.display === 'none' && input.value.length >= 2) {
                    const result = await this.fetchData(input.value);
                    if (result) {
                        // Context-aware value correction for the current input
                        const colName = input.getAttribute('data-col') || input.id || input.name;
                        const contextValue = this.getBestValueForCol(colName, result);
                        if (contextValue) input.value = contextValue;

                        if (isPlainForm) this.fillPlainForm(result);
                        else this.fillRow(rowIndex, result);
                    }
                }
            }, 250);
        });

        // Also trigger on 'Enter' key
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                list.style.display = 'none';
                const result = await this.fetchData(input.value);
                if (result) {
                    const colName = input.getAttribute('data-col') || input.id || input.name;
                    const contextValue = this.getBestValueForCol(colName, result);
                    if (contextValue) input.value = contextValue;

                    if (isPlainForm) this.fillPlainForm(result);
                    else this.fillRow(rowIndex, result);
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
                const result = await this.fetchData(input.value);
                if (result) {
                    if (isPlainForm) this.fillPlainForm(result);
                    else this.fillRow(rowIndex, result);
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
    }
};
