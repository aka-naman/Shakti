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
        const { query, formId } = req.query;
        if (!query || query.length < 2) {
            return res.json({ results: [] });
        }

        let whereClause = 'WHERE s.deleted_at IS NULL';
        const params = [`%${query}%`];

        if (formId) {
            whereClause += ' AND fv.form_id = $2';
            params.push(formId);
        }

        // 🚀 OPTIMIZED GENERALIZED SEARCH
        const result = await pool.query(`
            WITH matched_subs AS (
                SELECT s.id, s.data_json
                FROM submissions s
                JOIN form_versions fv ON s.form_version_id = fv.id
                ${whereClause}
                  AND (
                      -- Fast-path for common fields
                      s.data_json->>'pis' ILIKE $1 OR 
                      s.data_json->>'PIS' ILIKE $1 OR 
                      s.data_json->>'name' ILIKE $1 OR 
                      s.data_json->>'Name' ILIKE $1 OR
                      -- Complete fallback for dynamic keys (Optimized with Trigram)
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
                    -- Candidate for PIS
                    (SELECT value FROM flattened f2 WHERE f2.id = matched_subs.id AND (f2.key ILIKE '%pis%' OR f2.key ILIKE '%p.i.s.%' OR f2.key ILIKE '%emp id%' OR f2.key ILIKE '%personnel%' OR f2.key = 'id') LIMIT 1) as pis_direct,
                    (SELECT value FROM flattened f2 WHERE f2.id = matched_subs.id AND f2.value ILIKE $1 AND f2.key NOT ILIKE '%date%' AND f2.key NOT ILIKE '%dob%' ORDER BY length(value) ASC LIMIT 1) as pis_fallback,
                    -- Candidate for Name
                    (SELECT value FROM flattened f2 WHERE f2.id = matched_subs.id AND f2.key ILIKE '%name%' LIMIT 1) as name_direct,
                    (SELECT value FROM flattened f2 WHERE f2.id = matched_subs.id AND length(value) > 5 AND value NOT ILIKE '%@%' LIMIT 1) as name_fallback
                FROM matched_subs
            )
            SELECT DISTINCT ON (pis)
                COALESCE(pis_direct, pis_fallback) as pis,
                COALESCE(name_direct, name_fallback, 'No Name Identified') as name
            FROM candidates
            WHERE (pis_direct ILIKE $1 OR pis_fallback ILIKE $1 OR name_direct ILIKE $1 OR name_fallback ILIKE $1)
            LIMIT 15
        `, params);

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

        // 2. Identify the PIS/Trigger label dynamically (fuzzy matching)
        let pisLabel = fields.find(f => {
            const l = f.label.toLowerCase();
            const cleanL = l.replace(/\./g, '').replace(/_/g, ' ');
            return cleanL.includes('pis') || l.includes('personnel') || l.includes('emp id') || 
                   l.includes('fax') || l.includes('roll') || l === 'id';
        })?.label;

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
            // Case-insensitive search across all values
            query += ` AND EXISTS (SELECT 1 FROM jsonb_each_text(s.data_json) WHERE value ILIKE $2)`;
            params.push(pis);
        }

        query += ` ORDER BY s.submitted_at DESC LIMIT 1`;

        let result = await pool.query(query, params);

        // 🛡️ FALLBACK: If not found in specified form, search ALL forms
        if (result.rows.length === 0) {
            result = await pool.query(`
                SELECT s.id, s.data_json, f.name as form_name
                FROM submissions s
                JOIN form_versions fv ON s.form_version_id = fv.id
                JOIN forms f ON fv.form_id = f.id
                WHERE s.deleted_at IS NULL
                  AND EXISTS (SELECT 1 FROM jsonb_each_text(s.data_json) WHERE value ILIKE $1)
                ORDER BY s.submitted_at DESC
                LIMIT 1
            `, [pis]);
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'PIS not found' });
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

        const labels = Object.keys(data);
        labels.forEach(label => {
            const low = label.toLowerCase();
            const cleanLow = low.replace(/\./g, '').replace(/_/g, ' ');

            // PIS/ID/Fax
            if (!response.suggested_mapping.pis && (cleanLow.includes('pis') || low.includes('personnel') || low.includes('emp id') || low.includes('fax') || low === 'id')) {
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
            // Email/Contact
            else if (!response.suggested_mapping.email && (low.includes('email') || low.includes('drona') || low.includes('mail'))) {
                response.suggested_mapping.email = label;
            }
            // Mobile
            else if (!response.suggested_mapping.mobile && (low.includes('mobile') || low.includes('phone') || low.includes('contact'))) {
                response.suggested_mapping.mobile = label;
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

// Initialize global prefill cache for service-to-client exchange
global.prefillCache = global.prefillCache || new Map();

/**
 * @route GET /api/service/forms/:formId/fields
 * @desc  Fetch field list for a form to map them dynamically in master manager
 * @access Internal (Service-to-Service)
 */
router.get('/forms/:formId/fields', async (req, res) => {
    try {
        const formId = req.params.formId;
        const versionResult = await pool.query(
            'SELECT id FROM form_versions WHERE form_id = $1 ORDER BY version_number DESC LIMIT 1',
            [formId]
        );
        if (versionResult.rows.length === 0) return res.status(404).json({ error: 'Form not found' });
        const latestVersionId = versionResult.rows[0].id;

        const fieldsResult = await pool.query(
            'SELECT id, label, type FROM form_fields WHERE form_version_id = $1 ORDER BY field_order',
            [latestVersionId]
        );
        res.json({ fields: fieldsResult.rows });
    } catch (err) {
        console.error('Service fields error:', err);
        res.status(500).json({ error: 'Failed to fetch fields' });
    }
});

/**
 * @route POST /api/service/prefill-session
 * @desc  Create a temporary prefilled form session from external service
 * @access Internal (Service-to-Service)
 */
router.post('/prefill-session', async (req, res) => {
    try {
        const { formId, values, submissionId } = req.body;
        if (!formId) return res.status(400).json({ error: 'formId is required' });

        const prefillToken = `prefill_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

        global.prefillCache.set(prefillToken, {
            formId: String(formId),
            values: values || {},
            submissionId: submissionId || null,
            createdAt: Date.now()
        });

        // Auto-cleanup after 5 minutes
        setTimeout(() => {
            global.prefillCache.delete(prefillToken);
        }, 5 * 60 * 1000);

        res.json({ prefillToken });
    } catch (err) {
        console.error('Create prefill session error:', err);
        res.status(500).json({ error: 'Failed to create prefill session' });
    }
});

module.exports = router;
