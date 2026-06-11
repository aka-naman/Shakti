const express = require('express');
const pool = require('../db/pool');
const { authenticate, checkFormAccess } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// POST /api/forms/:formId/submit — Submit form
router.post('/:formId/submit', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const { values } = req.body;
        if (!values || typeof values !== 'object') {
            return res.status(400).json({ error: 'values object is required' });
        }

        const access = await checkFormAccess(req.params.formId, req.user.id, req.user.role);
        if (!access.exists) return res.status(404).json({ error: 'Form not found' });
        if (!access.hasAccess) return res.status(403).json({ error: 'Access denied' });

        const versionResult = await client.query(
            'SELECT id FROM form_versions WHERE form_id = $1 ORDER BY version_number DESC LIMIT 1',
            [req.params.formId]
        );
        if (versionResult.rows.length === 0) return res.status(404).json({ error: 'No version exists' });
        const versionId = versionResult.rows[0].id;

        const fieldsResult = await client.query(
            'SELECT * FROM form_fields WHERE form_version_id = $1 ORDER BY field_order',
            [versionId]
        );
        const fields = fieldsResult.rows;

        // 🛡️ UNIQUE FIELD VALIDATION
        for (const field of fields) {
            if (field.is_unique) {
                const val = values[field.id] !== undefined ? String(values[field.id]).trim() : '';
                if (val) {
                    const uniqueCheck = await client.query(`
                        SELECT s.id 
                        FROM submissions s
                        JOIN form_versions fv ON s.form_version_id = fv.id
                        WHERE fv.form_id = $1 
                          AND s.deleted_at IS NULL
                          AND s.data_json->>$2 = $3
                        LIMIT 1
                    `, [req.params.formId, field.label, val]);

                    if (uniqueCheck.rows.length > 0) {
                        client.release();
                        return res.status(409).json({ 
                            error: `Duplicate value found for unique field "${field.label}": "${val}"`,
                            fieldId: field.id
                        });
                    }
                }
            }
        }

        await client.query('BEGIN');

        await client.query('UPDATE forms SET is_locked = true WHERE id = $1 AND is_locked = false', [req.params.formId]);

        const { remarks = '' } = req.body;

        const subResult = await client.query(
            'INSERT INTO submissions (form_version_id, user_id, updated_by, data_json, remarks) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [versionId, req.user.id, req.user.id, {}, remarks]
        );
        const submission = subResult.rows[0];

        const dataJson = {};
        if (remarks) dataJson['Remarks'] = remarks;

        for (const field of fields) {
            const rawVal = values[field.id] !== undefined ? String(values[field.id]) : '';
            dataJson[field.label] = rawVal;
            
            await client.query(
                'INSERT INTO submission_values (submission_id, field_id, value) VALUES ($1, $2, $3)',
                [submission.id, field.id, rawVal]
            );

            // Learning logic...
            if (field.type === 'university_autocomplete' && rawVal) {
                let uState = '', uDist = '';
                for (const f of fields) {
                    const label = f.label.toLowerCase();
                    const val = values[f.id] || '';
                    if (label.includes('state') && !uState) uState = val;
                    if (label.includes('district') && !uDist) uDist = val;
                    if (f.type === 'residential_address' && val) {
                        const parts = val.split(' ||| ');
                        if (parts.length >= 3) { uDist = uDist || parts[1]; uState = uState || parts[2]; }
                    }
                }
                if (uState && uDist) {
                    await client.query(
                        'INSERT INTO universities (name, state, district) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM universities WHERE name = $1 AND state = $2 AND district = $3)',
                        [rawVal, uState, uDist]
                    );
                }
            }

            // Learn State/District from Residential Address independently
            if (field.type === 'residential_address' && rawVal) {
                const parts = rawVal.split(' ||| ');
                const dist = parts[1], state = parts[2];
                if (state && dist) {
                    // We store a dummy university entry to "learn" the state/district combination
                    // Our autocomplete/locations logic pulls from the universities table
                    await client.query(
                        `INSERT INTO universities (name, state, district, is_custom) 
                         SELECT '---', $1, $2, true 
                         WHERE NOT EXISTS (SELECT 1 FROM universities WHERE state = $1 AND district = $2)`,
                        [state, dist]
                    );
                }
            }

            // Learn Zone/Group from Organizational Groups independently
            if (field.type === 'zone_group' && rawVal) {
                const parts = rawVal.split(' ||| ');
                const zone = parts[0], group = parts[1];
                if (zone && group) {
                    await client.query(
                        `INSERT INTO organizational_groups (zone, group_name, is_custom) 
                         SELECT $1, $2, true 
                         WHERE NOT EXISTS (SELECT 1 FROM organizational_groups WHERE zone = $1 AND group_name = $2)`,
                        [zone, group]
                    );
                }
            }
            if (field.type === 'branch' && rawVal) {
                await client.query('INSERT INTO branches (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [rawVal]);
            }
        }

        // Finalize data_json for AI
        await client.query('UPDATE submissions SET data_json = $1 WHERE id = $2', [dataJson, submission.id]);

        // Log submission
        const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await client.query(
            'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
            ['submit_form', req.user.id, JSON.stringify({ 
                submission_id: submission.id, 
                form_id: req.params.formId,
                ip: clientIp 
            })]
        );

        await client.query('COMMIT');
        res.status(201).json({ submission });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Submission failed' });
    } finally {
        client.release();
    }
});

// GET /api/forms/:formId/submissions — All Submissions for Form
router.get('/:formId/submissions', authenticate, async (req, res) => {
    try {
        const { search = '', sortMode = 'date_desc' } = req.query;

        const access = await checkFormAccess(req.params.formId, req.user.id, req.user.role);
        if (!access.exists) return res.status(404).json({ error: 'Form not found' });
        if (!access.hasAccess) return res.status(403).json({ error: 'Access denied' });

        // Get the LATEST version to know which fields to show in columns and identify special fields
        const versionResult = await pool.query(
            'SELECT id FROM form_versions WHERE form_id = $1 ORDER BY version_number DESC LIMIT 1',
            [req.params.formId]
        );
        if (versionResult.rows.length === 0) return res.status(404).json({ error: 'Form not found' });
        const latestVersionId = versionResult.rows[0].id;

        const fieldsResult = await pool.query(
            'SELECT * FROM form_fields WHERE form_version_id = $1 ORDER BY field_order',
            [latestVersionId]
        );
        const fields = fieldsResult.rows;

        // Identify special field labels for sorting
        const cgpaField = fields.find(f => f.type === 'cgpa_converter');
        const branchField = fields.find(f => f.type === 'branch');

        // Fetch ALL submissions for this form (across all versions)
        let searchQuery = `
            SELECT s.id, s.submitted_at, s.updated_at, s.data_json, 
                u1.username as submitted_by_username,
                u2.username as updated_by_username,
                json_agg(
                    json_build_object('field_id', sv.field_id, 'value', sv.value)
                    ORDER BY sv.field_id
                ) as values
            FROM submissions s
            JOIN form_versions fv ON s.form_version_id = fv.id
            LEFT JOIN submission_values sv ON sv.submission_id = s.id
            LEFT JOIN users u1 ON s.user_id = u1.id
            LEFT JOIN users u2 ON s.updated_by = u2.id
            WHERE fv.form_id = $1 AND s.deleted_at IS NULL
        `;
        const params = [req.params.formId];

        if (search) {
            searchQuery += ` AND s.id IN (SELECT submission_id FROM submission_values WHERE value ILIKE $2)`;
            params.push(`%${search}%`);
        }

        searchQuery += ` GROUP BY s.id, s.submitted_at, s.updated_at, s.data_json, u1.username, u2.username`;

        // Dynamic Sorting logic
        let orderBy = 'ORDER BY s.submitted_at DESC'; // Default
        if (sortMode === 'cgpa_desc' && cgpaField) {
            orderBy = `ORDER BY (NULLIF(substring(data_json->>'${cgpaField.label}' from '^[0-9.]+'), '')::numeric) DESC NULLS LAST`;
        } else if (sortMode === 'branch_alpha' && branchField) {
            orderBy = `ORDER BY (data_json->>'${branchField.label}') ASC NULLS LAST`;
        } else if (sortMode === 'branch_cgpa' && branchField && cgpaField) {
            orderBy = `ORDER BY (data_json->>'${branchField.label}') ASC NULLS LAST, 
                       (NULLIF(substring(data_json->>'${cgpaField.label}' from '^[0-9.]+'), '')::numeric) DESC NULLS LAST`;
        } else if (sortMode === 'branch_cgpa' && branchField) { // Fallback if only branch exists
            orderBy = `ORDER BY (data_json->>'${branchField.label}') ASC NULLS LAST`;
        }

        searchQuery += ` ${orderBy}`;

        const subsResult = await pool.query(searchQuery, params);

        res.json({
            fields: fields,
            submissions: subsResult.rows,
            pagination: {
                total: subsResult.rows.length,
                page: 1,
                limit: subsResult.rows.length,
                pages: 1
            }
        });
    } catch (err) {
        console.error('List submissions error:', err);
        res.status(500).json({ error: 'Failed to list submissions' });
    }
});

// PUT /api/forms/:formId/submissions/:submissionId — Audit Trail Edit
router.put('/:formId/submissions/:submissionId', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const { values } = req.body;
        const access = await checkFormAccess(req.params.formId, req.user.id, req.user.role);
        if (!access.hasAccess) return res.status(403).json({ error: 'Access denied' });

        // 0. PREVENT EDITING DELETED
        const deletedCheck = await client.query('SELECT deleted_at FROM submissions WHERE id = $1', [req.params.submissionId]);
        if (deletedCheck.rows.length === 0) return res.status(404).json({ error: 'Submission not found' });
        if (deletedCheck.rows[0].deleted_at) return res.status(400).json({ error: 'Cannot edit a deleted submission' });

        await client.query('BEGIN');

        // 1. CREATE AUDIT SNAPSHOT
        const currentValues = await client.query(
            `SELECT json_object_agg(field_id, value) as snapshot 
             FROM submission_values WHERE submission_id = $1`,
            [req.params.submissionId]
        );

        await client.query(
            `INSERT INTO submission_audit (submission_id, changed_by, old_values_json, change_type)
             VALUES ($1, $2, $3, 'update')`,
            [req.params.submissionId, req.user.id, currentValues.rows[0].snapshot || {}]
        );

        // 2. UPDATE MAIN DATA
        await client.query('UPDATE submissions SET updated_at = NOW(), updated_by = $1 WHERE id = $2', [req.user.id, req.params.submissionId]);
        await client.query('DELETE FROM submission_values WHERE submission_id = $1', [req.params.submissionId]);

        const fieldsResult = await client.query(
            `SELECT ff.id, ff.label, ff.validation_rules FROM form_fields ff 
             JOIN form_versions fv ON ff.form_version_id = fv.id
             JOIN submissions s ON s.form_version_id = fv.id
             WHERE s.id = $1`,
            [req.params.submissionId]
        );
        const fields = fieldsResult.rows;
        const fieldMap = {};
        fields.forEach(f => fieldMap[f.id] = f);

        const dataJson = {};
        const emptyOptionalFields = [];

        for (const field of fields) {
            const val = values[field.id] !== undefined ? String(values[field.id]) : '';
            dataJson[field.label] = val;

            await client.query(
                'INSERT INTO submission_values (submission_id, field_id, value) VALUES ($1, $2, $3)',
                [req.params.submissionId, field.id, val]
            );

            // Check for empty optional fields to update remarks
            if (!field.validation_rules?.required && !val) {
                emptyOptionalFields.push(field.label);
            }
        }

        const newRemarks = emptyOptionalFields.length > 0 ? `Missing Entries: ${emptyOptionalFields.join(', ')}` : '';
        if (newRemarks) dataJson['Remarks'] = newRemarks;

        await client.query('UPDATE submissions SET data_json = $1, remarks = $2 WHERE id = $3', [dataJson, newRemarks, req.params.submissionId]);

        // Log the edit action
        const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await client.query(
            'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
            ['edit_submission', req.user.id, JSON.stringify({
                submission_id: req.params.submissionId,
                form_id: req.params.formId,
                form_name: (await client.query('SELECT name FROM forms WHERE id = $1', [req.params.formId])).rows[0].name,
                ip: clientIp
            })]
        );

        await client.query('COMMIT');
        res.json({ message: 'Submission updated and audited' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Update failed' });
    } finally {
        client.release();
    }
});

// DELETE /api/forms/:formId/submissions/:submissionId — Soft Delete
router.delete('/:formId/submissions/:submissionId', authenticate, async (req, res) => {
    try {
        const access = await checkFormAccess(req.params.formId, req.user.id, req.user.role);
        if (!access.hasAccess) return res.status(403).json({ error: 'Access denied' });

        await pool.query('UPDATE submissions SET deleted_at = NOW() WHERE id = $1', [req.params.submissionId]);

        // Log the delete action
        await pool.query(
            'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
            ['delete_submission', req.user.id, JSON.stringify({
                submission_id: req.params.submissionId,
                form_id: req.params.formId,
                form_name: (await pool.query('SELECT name FROM forms WHERE id = $1', [req.params.formId])).rows[0].name
            })]
        );

        res.json({ message: 'Submission deleted (archived)' });
    } catch (err) {
        res.status(500).json({ error: 'Delete failed' });
    }
});

// GET /api/forms/:formId/submissions/:submissionId/audit — Fetch Audit History
router.get('/:formId/submissions/:submissionId/audit', authenticate, async (req, res) => {
    try {
        const access = await checkFormAccess(req.params.formId, req.user.id, req.user.role);
        if (!access.hasAccess) return res.status(403).json({ error: 'Access denied' });

        const result = await pool.query(
            `SELECT a.*, u.username as changed_by_username
             FROM submission_audit a
             LEFT JOIN users u ON a.changed_by = u.id
             WHERE a.submission_id = $1
             ORDER BY a.changed_at DESC`,
            [req.params.submissionId]
        );

        res.json({ audit: result.rows });
    } catch (err) {
        console.error('Fetch audit error:', err);
        res.status(500).json({ error: 'Failed to fetch audit history' });
    }
});

module.exports = router;
