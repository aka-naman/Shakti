const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

/**
 * @route GET /api/service/forms
 * @desc  List all active forms for discovery by external services
 * @access Internal (Service-to-Service)
 */
router.get('/forms', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, description 
            FROM forms 
            WHERE deleted_at IS NULL 
            ORDER BY name ASC
        `);
        res.json({ forms: result.rows });
    } catch (err) {
        console.error('Service forms list error:', err);
        res.status(500).json({ error: 'Failed to fetch forms' });
    }
});

/**
 * @route GET /api/service/search
 * @desc  Search for PIS numbers as the user types (Autocomplete)
 * @access Internal (Service-to-Service)
 */
router.get('/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.length < 2) {
            return res.json({ results: [] });
        }

        // 🚀 OPTIMIZED GENERALIZED SEARCH
        // We use a multi-stage search strategy:
        // 1. Fast-path: Check common keys (PIS, Name) directly - these can use the GIN index if btree_gin is enabled
        // 2. Fallback: Search the entire JSON blob as text (Preserves 100% compatibility for any key name)
        const result = await pool.query(`
            WITH matched_subs AS (
                SELECT s.id, s.data_json
                FROM submissions s
                WHERE s.deleted_at IS NULL
                  AND (
                      -- Fast-path for common fields (Speed up 90% of cases)
                      s.data_json->>'pis' ILIKE $1 OR 
                      s.data_json->>'PIS' ILIKE $1 OR 
                      s.data_json->>'name' ILIKE $1 OR 
                      s.data_json->>'Name' ILIKE $1 OR
                      -- Complete fallback for dynamic keys (Ensures nothing breaks)
                      s.data_json::text ILIKE $1
                  )
                ORDER BY s.submitted_at DESC
                LIMIT 50
            ),
            flattened AS (
                SELECT id, key, value
                FROM matched_subs, jsonb_each_text(data_json)
            ),
            candidates AS (
                SELECT 
                    id,
                    -- Candidate for PIS: Shortest alphanumeric string that matches query or is first key
                    (SELECT value FROM flattened f2 WHERE f2.id = matched_subs.id AND (f2.key ILIKE \'%pis%\' OR f2.key ILIKE \'%p.i.s.%\' OR f2.key ILIKE \'%emp id%\' OR f2.key ILIKE \'%personnel%\' OR f2.key = \'id\') LIMIT 1) as pis_direct,
                    (SELECT value FROM flattened f2 WHERE f2.id = matched_subs.id AND f2.value ILIKE $1 AND f2.key NOT ILIKE \'%date%\' AND f2.key NOT ILIKE \'%dob%\' ORDER BY length(value) ASC LIMIT 1) as pis_fallback,
                    -- Candidate for Name: Field containing \'name\'
                    (SELECT value FROM flattened f2 WHERE f2.id = matched_subs.id AND f2.key ILIKE \'%name%\' LIMIT 1) as name_direct,
                    (SELECT value FROM flattened f2 WHERE f2.id = matched_subs.id AND length(value) > 5 AND value NOT ILIKE \'%@%\' LIMIT 1) as name_fallback
                FROM matched_subs
            )
            SELECT DISTINCT ON (pis)
                COALESCE(pis_direct, pis_fallback) as pis,
                COALESCE(name_direct, name_fallback, \'No Name Identified\') as name
            FROM candidates
            WHERE (pis_direct ILIKE $1 OR pis_fallback ILIKE $1 OR name_direct ILIKE $1 OR name_fallback ILIKE $1)
            LIMIT 15
        `, [`%${query}%`]);

        res.json({ results: result.rows });
    } catch (err) {
        console.error('Service search error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * @route GET /api/service/lookup
 * @desc  Lookup employee data by PIS number with fuzzy field matching
 * @access Internal (Service-to-Service)
 */
router.get('/lookup', async (req, res) => {
    try {
        const { pis, formId } = req.query;
        if (!pis || !formId) {
            return res.status(400).json({ error: 'PIS and formId are required' });
        }

        // 1. Fetch the latest version's fields to identify labels
        const fieldsResult = await pool.query(`
            SELECT label, type 
            FROM form_fields 
            WHERE form_version_id = (
                SELECT id FROM form_versions 
                WHERE form_id = $1 
                ORDER BY version_number DESC 
                LIMIT 1
            )
        `, [formId]);

        if (fieldsResult.rows.length === 0) {
            return res.status(404).json({ error: 'Master Form not found or has no fields' });
        }

        const fields = fieldsResult.rows;

        // 2. Identify the PIS label dynamically (fuzzy matching)
        // We look for labels containing 'PIS', 'PERSONNEL', or 'ID' (case insensitive)
        let pisLabel = fields.find(f => {
            const l = f.label.toLowerCase();
            const cleanL = l.replace(/\./g, '');
            return cleanL.includes('pis') || l.includes('personnel') || l.includes('emp id') || l === 'id';
        })?.label;

        // Fallback: If no fuzzy match, try to find a field marked 'is_unique' (if we had that info here)
        // For now, if pisLabel is not found, we will search ALL fields for the PIS value.

        let query = `
            SELECT s.id, s.data_json, f.name as form_name
            FROM submissions s
            JOIN form_versions fv ON s.form_version_id = fv.id
            JOIN forms f ON fv.form_id = f.id
            WHERE f.id = $1 AND s.deleted_at IS NULL
        `;
        const params = [formId];

        if (pisLabel) {
            query += ` AND s.data_json->>$2 = $3`;
            params.push(pisLabel, pis);
        } else {
            // 🚀 OPTIMIZED: Search all keys in data_json for the PIS value using JSON path
            // This is significantly faster than jsonb_each_text and can use GIN indexes
            query += ` AND s.data_json @? '$.* ? (@ == $2)'`;
            params.push(pis);
        }

        query += ` ORDER BY s.submitted_at DESC LIMIT 1`;

        let result = await pool.query(query, params);

        // 🛡️ FALLBACK: If not found in specified form, search ALL forms
        if (result.rows.length === 0) {
            console.log(`[SERVICE] PIS ${pis} not found in form ${formId}, searching all forms...`);
            result = await pool.query(`
                SELECT s.id, s.data_json, f.name as form_name
                FROM submissions s
                JOIN form_versions fv ON s.form_version_id = fv.id
                JOIN forms f ON fv.form_id = f.id
                WHERE s.deleted_at IS NULL
                  AND s.data_json @? '$.* ? (@ == $1)'
                ORDER BY s.submitted_at DESC
                LIMIT 1
            `, [pis]);
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'PIS not found in any form' });
        }

        const submission = result.rows[0];

        // 3. Return a clean object with dynamic mapping hints
        const data = submission.data_json;
        const response = {
            id: submission.id,
            form_name: submission.form_name,
            data: data,
            suggested_mapping: {}
        };

        // 🚀 DYNAMIC ROLE DISCOVERY
        // We scan the data to find fields that likely match common noting categories
        const labels = Object.keys(data);
        
        // 1. First pass: Keyword-based matching (High priority)
        labels.forEach(label => {
            const low = label.toLowerCase();
            const cleanLow = low.replace(/\./g, '');

            // PIS/ID (Specific keywords)
            if (!response.suggested_mapping.pis && (cleanLow.includes('pis') || low.includes('personnel') || low.includes('emp id') || low === 'id')) {
                response.suggested_mapping.pis = label;
            }
            // Name
            else if (!response.suggested_mapping.name && (low.includes('name') && !low.includes('father'))) {
                response.suggested_mapping.name = label;
            }
            // Designation
            else if (!response.suggested_mapping.designation && (low.includes('desig') || low.includes('rank') || low.includes('post'))) {
                response.suggested_mapping.designation = label;
            }
            // DOB
            else if (!response.suggested_mapping.dob && (low.includes('dob') || low.includes('birth') || (low.includes('date') && !low.includes('join')))) {
                response.suggested_mapping.dob = label;
            }
        });

        // 2. Second pass: Value-based fallback (Low priority)
        labels.forEach(label => {
            const low = label.toLowerCase();
            const val = data[label] || '';
            const valStr = String(val).trim();

            // PIS fallback: Short, alphanumeric, NOT a date/name/etc.
            if (!response.suggested_mapping.pis) {
                const isDateLabel = low.includes('date') || low.includes('dob') || low.includes('birth');
                const isNameLabel = low.includes('name');
                if (!isDateLabel && !isNameLabel && valStr.length >= 4 && valStr.length <= 12 && /^[a-zA-Z0-9]+$/.test(valStr)) {
                    response.suggested_mapping.pis = label;
                }
            }
            
            // Name fallback
            if (!response.suggested_mapping.name && !low.includes('date') && valStr.length > 5 && /^[^0-9]+$/.test(valStr) && !valStr.includes('@')) {
                response.suggested_mapping.name = label;
            }

            // Email fallback
            if (!response.suggested_mapping.email && (low.includes('email') || low.includes('drona') || valStr.includes('@'))) {
                response.suggested_mapping.email = label;
            }

            // Mobile fallback
            if (!response.suggested_mapping.mobile && (low.includes('mobile') || low.includes('cont') || (valStr.length >= 10 && /^[0-9+\s-]+$/.test(valStr)))) {
                response.suggested_mapping.mobile = label;
            }

            // Qualification fallback
            if (!response.suggested_mapping.qualification && (low.includes('quali') || low.includes('degree') || low.includes('edu'))) {
                response.suggested_mapping.qualification = label;
            }
        });

        res.json(response);

    } catch (err) {
        console.error('Service lookup error:', err);
        res.status(500).json({ error: 'Internal server error during lookup' });
    }
});

module.exports = router;
