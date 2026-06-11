const express = require('express');
const pool = require('../db/pool');
const { authenticate, checkFormAccess, checkFormOwnership } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// GET /api/forms/:formId/versions/:versionId/fields
router.get('/:formId/versions/:versionId/fields', authenticate, async (req, res) => {
    try {
        const access = await checkFormAccess(req.params.formId, req.user.id, req.user.role);
        if (!access.exists) return res.status(404).json({ error: 'Form not found' });
        if (!access.hasAccess) return res.status(403).json({ error: 'Access denied' });

        const result = await pool.query(
            'SELECT * FROM form_fields WHERE form_version_id = $1 ORDER BY field_order',
            [req.params.versionId]
        );
        res.json({ fields: result.rows });
    } catch (err) {
        console.error('Get fields error:', err);
        res.status(500).json({ error: 'Failed to get fields' });
    }
});

// PUT /api/forms/:formId/versions/:versionId/fields — Bulk save (replace all fields)
router.put('/:formId/versions/:versionId/fields', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const { fields } = req.body;
        if (!Array.isArray(fields)) {
            return res.status(400).json({ error: 'fields must be an array' });
        }

        // Check ownership (only owners/admins can edit schema)
        const ownership = await checkFormOwnership(req.params.formId, req.user.id, req.user.role);
        if (!ownership.exists) {
            return res.status(404).json({ error: 'Form not found' });
        }
        if (!ownership.hasAccess) {
            return res.status(403).json({ error: 'You do not have permission to edit this form' });
        }

        // Check if form is locked
        const formResult = await client.query('SELECT is_locked FROM forms WHERE id = $1', [req.params.formId]);
        if (formResult.rows[0].is_locked) {
            return res.status(403).json({ error: 'Form schema is locked and cannot be modified' });
        }

        await client.query('BEGIN');

        // 1. Fetch current fields to identify renames and deletions
        const currentFieldsRes = await client.query('SELECT * FROM form_fields WHERE form_version_id = $1', [req.params.versionId]);
        const currentFields = currentFieldsRes.rows;
        const currentFieldsMap = {};
        currentFields.forEach(f => currentFieldsMap[f.id] = f);

        // Normalize incoming IDs to numbers for reliable comparison
        const incomingFields = fields.map(f => ({
            ...f,
            id: f.id ? Number(f.id) : null
        }));

        const newFieldIds = incomingFields.filter(f => f.id && currentFieldsMap[f.id]).map(f => f.id);
        const fieldsToDelete = currentFields.filter(f => !newFieldIds.includes(f.id));

        // 2. Perform Migration for Renames (Across ALL versions of this form)
        for (const f of incomingFields) {
            if (f.id && currentFieldsMap[f.id]) {
                const oldField = currentFieldsMap[f.id];
                if (oldField.label && f.label && oldField.label !== f.label) {
                    console.log(`[MIGRATION] Renaming field label from "${oldField.label}" to "${f.label}" for all versions of form ${req.params.formId}`);
                    try {
                        await client.query(`
                            UPDATE submissions 
                            SET data_json = (data_json - $1::text) || jsonb_build_object($2::text, data_json->$1)
                            WHERE form_version_id IN (SELECT id FROM form_versions WHERE form_id = $3::int)
                              AND (data_json ? $1)
                        `, [oldField.label, f.label, req.params.formId]);
                    } catch (migrationErr) {
                        console.error('[MIGRATION] Error:', migrationErr);
                        throw migrationErr;
                    }
                }
            }
        }

        // 3. Delete fields that are no longer present
        if (fieldsToDelete.length > 0) {
            const deleteIds = fieldsToDelete.map(f => f.id);
            console.log(`[FIELDS] Deleting fields: ${deleteIds.join(', ')}`);
            try {
                await client.query('DELETE FROM form_fields WHERE id = ANY($1)', [deleteIds]);
            } catch (deleteErr) {
                console.error('[FIELDS] Delete error:', deleteErr);
                throw deleteErr;
            }
        }

        // 4. Upsert/Insert fields
        const insertedFields = [];
        for (let i = 0; i < incomingFields.length; i++) {
            const f = incomingFields[i];
            
            let dataType = 'text';
            if (['number', 'rating', 'cgpa'].includes(f.type)) dataType = 'number';
            else if (['date', 'date_time'].includes(f.type)) dataType = 'date';
            else if (['checkbox', 'toggle'].includes(f.type)) dataType = 'boolean';

            let result;
            if (f.id && currentFieldsMap[f.id]) {
                // Update existing
                result = await client.query(
                    `UPDATE form_fields 
                     SET label = $1, type = $2, options_json = $3, field_order = $4, validation_rules = $5, data_type = $6, is_unique = $7
                     WHERE id = $8 RETURNING *`,
                    [
                        f.label || '',
                        f.type || 'text',
                        JSON.stringify(f.options_json || []),
                        i,
                        JSON.stringify(f.validation_rules || {}),
                        dataType,
                        !!f.is_unique,
                        f.id
                    ]
                );
            } else {
                // Insert new
                result = await client.query(
                    `INSERT INTO form_fields (form_version_id, label, type, options_json, field_order, validation_rules, data_type, is_unique)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                    [
                        req.params.versionId,
                        f.label || '',
                        f.type || 'text',
                        JSON.stringify(f.options_json || []),
                        i,
                        JSON.stringify(f.validation_rules || {}),
                        dataType,
                        !!f.is_unique
                    ]
                );
            }
            insertedFields.push(result.rows[0]);
        }

        await client.query('COMMIT');

        res.json({ fields: insertedFields });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Save fields error:', err);
        res.status(500).json({ error: 'Failed to save fields' });
    } finally {
        client.release();
    }
});

module.exports = router;
