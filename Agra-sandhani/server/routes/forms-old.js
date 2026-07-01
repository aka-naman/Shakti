const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/forms — List all forms with latest version info and submission count
router.get('/', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT f.*,
        fv.id as latest_version_id,
        fv.version_number,
        COALESCE(sub_count.count, 0)::int as submission_count
      FROM forms f
      LEFT JOIN LATERAL (
        SELECT id, version_number FROM form_versions
        WHERE form_id = f.id ORDER BY version_number DESC LIMIT 1
      ) fv ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as count FROM submissions
        WHERE form_version_id = fv.id
      ) sub_count ON true
      ORDER BY f.created_at DESC
    `);
        res.json({ forms: result.rows });
    } catch (err) {
        console.error('List forms error:', err);
        res.status(500).json({ error: 'Failed to list forms' });
    }
});

// POST /api/forms — Create new form + initial version
router.post('/', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Form name is required' });
        }

        await client.query('BEGIN');

        const formResult = await client.query(
            'INSERT INTO forms (name) VALUES ($1) RETURNING *',
            [name.trim()]
        );
        const form = formResult.rows[0];

        const versionResult = await client.query(
            'INSERT INTO form_versions (form_id, version_number) VALUES ($1, 1) RETURNING *',
            [form.id]
        );

        await client.query('COMMIT');

        res.status(201).json({
            form,
            version: versionResult.rows[0],
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Create form error:', err);
        res.status(500).json({ error: 'Failed to create form' });
    } finally {
        client.release();
    }
});

// PUT /api/forms/:id — Rename form
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Form name is required' });
        }

        const result = await pool.query(
            'UPDATE forms SET name = $1 WHERE id = $2 RETURNING *',
            [name.trim(), req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Form not found' });
        }

        res.json({ form: result.rows[0] });
    } catch (err) {
        console.error('Rename form error:', err);
        res.status(500).json({ error: 'Failed to rename form' });
    }
});

// DELETE /api/forms/:id — Delete form + cascade
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM forms WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Form not found' });
        }
        res.json({ message: 'Form deleted' });
    } catch (err) {
        console.error('Delete form error:', err);
        res.status(500).json({ error: 'Failed to delete form' });
    }
});

// POST /api/forms/:id/duplicate — Duplicate form + latest version + fields
router.post('/:id/duplicate', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get original form
        const formResult = await client.query('SELECT * FROM forms WHERE id = $1', [req.params.id]);
        if (formResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Form not found' });
        }
        const originalForm = formResult.rows[0];

        // Create duplicated form
        const newFormResult = await client.query(
            'INSERT INTO forms (name) VALUES ($1) RETURNING *',
            [`Copy of ${originalForm.name}`]
        );
        const newForm = newFormResult.rows[0];

        // Get latest version of original
        const versionResult = await client.query(
            'SELECT * FROM form_versions WHERE form_id = $1 ORDER BY version_number DESC LIMIT 1',
            [originalForm.id]
        );

        if (versionResult.rows.length > 0) {
            const originalVersion = versionResult.rows[0];

            // Create new version
            const newVersionResult = await client.query(
                'INSERT INTO form_versions (form_id, version_number) VALUES ($1, 1) RETURNING *',
                [newForm.id]
            );
            const newVersion = newVersionResult.rows[0];

            // Copy fields
            const fieldsResult = await client.query(
                'SELECT label, type, options_json, field_order, validation_rules FROM form_fields WHERE form_version_id = $1 ORDER BY field_order',
                [originalVersion.id]
            );

            for (const field of fieldsResult.rows) {
                await client.query(
                    'INSERT INTO form_fields (form_version_id, label, type, options_json, field_order, validation_rules) VALUES ($1, $2, $3, $4, $5, $6)',
                    [newVersion.id, field.label, field.type, JSON.stringify(field.options_json || []), field.field_order, JSON.stringify(field.validation_rules || {})]
                );
            }
        }

        await client.query('COMMIT');

        res.status(201).json({ form: newForm });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Duplicate form error:', err);
        res.status(500).json({ error: 'Failed to duplicate form' });
    } finally {
        client.release();
    }
});

// POST /api/forms/:id/lock — Lock form schema
router.post('/:id/lock', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE forms SET is_locked = true WHERE id = $1 RETURNING *',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Form not found' });
        }
        res.json({ form: result.rows[0] });
    } catch (err) {
        console.error('Lock form error:', err);
        res.status(500).json({ error: 'Failed to lock form' });
    }
});

module.exports = router;
