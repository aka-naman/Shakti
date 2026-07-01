const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/admin-analytics/logs — Unified System Logs Feed
 */
router.get('/logs', authenticate, requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const actionType = req.query.actionType;
        const timeRange = req.query.timeRange; // '1h', '5h', '24h', '7d', '30d'

        let query = `
            SELECT l.*, u.username 
            FROM system_logs l
            LEFT JOIN users u ON l.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (actionType) {
            params.push(actionType);
            query += ` AND l.action_type = $${params.length}`;
        }

        if (timeRange) {
            let interval = '1 hour';
            if (timeRange === '5h') interval = '5 hours';
            else if (timeRange === '24h') interval = '24 hours';
            else if (timeRange === '7d') interval = '7 days';
            else if (timeRange === '30d') interval = '30 days';
            
            query += ` AND l.timestamp > NOW() - INTERVAL '${interval}'`;
        }

        const countQuery = `SELECT COUNT(*) FROM system_logs l WHERE 1=1 ${actionType ? ` AND action_type = $1` : ''} ${timeRange ? ` AND timestamp > NOW() - INTERVAL '${timeRange === '5h' ? '5 hours' : timeRange === '24h' ? '24 hours' : timeRange === '7d' ? '7 days' : timeRange === '30d' ? '30 days' : '1 hour'}'` : ''}`;
        const totalResult = await pool.query(countQuery, actionType ? [actionType] : []);
        const total = parseInt(totalResult.rows[0].count);

        query += ` ORDER BY l.timestamp DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        
        res.json({
            logs: result.rows,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Logs fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

/**
 * GET /api/admin-analytics/data-health — Missing Entries Monitoring (Lazy Calculation)
 */
router.get('/data-health', authenticate, requireAdmin, async (req, res) => {
    try {
        // Query to find forms and their "missing entries" count
        // We look for 'Missing Entries:' inside data_json->>'Remarks'
        const result = await pool.query(`
            SELECT 
                f.id, 
                f.name as form_name,
                u.username as owner,
                COUNT(s.id) as total_submissions,
                COUNT(s.id) FILTER (WHERE s.data_json->>'Remarks' LIKE 'Missing Entries%') as missing_count
            FROM forms f
            JOIN users u ON f.user_id = u.id
            JOIN form_versions fv ON f.id = fv.form_id
            LEFT JOIN submissions s ON fv.id = s.form_version_id AND s.deleted_at IS NULL
            GROUP BY f.id, f.name, u.username
            HAVING COUNT(s.id) > 0
            ORDER BY missing_count DESC, total_submissions DESC
        `);

        res.json({ health: result.rows });
    } catch (err) {
        console.error('Data health fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch data health metrics' });
    }
});

/**
 * GET /api/admin-analytics/trash-bin — Soft-deleted items (Forms and Submissions)
 */
router.get('/trash-bin', authenticate, requireAdmin, async (req, res) => {
    try {
        // Fetch deleted submissions
        const submissionsResult = await pool.query(`
            SELECT s.id, s.submitted_at, s.deleted_at, s.data_json, f.name as form_name, u.username as deleted_by, 'submission' as type
            FROM submissions s
            JOIN form_versions fv ON s.form_version_id = fv.id
            JOIN forms f ON fv.form_id = f.id
            LEFT JOIN users u ON s.updated_by = u.id
            WHERE s.deleted_at IS NOT NULL
            ORDER BY s.deleted_at DESC
        `);

        // Fetch deleted forms
        const formsResult = await pool.query(`
            SELECT f.id, f.created_at as submitted_at, f.deleted_at, f.name as form_name, u.username as deleted_by, 'form' as type
            FROM forms f
            JOIN users u ON f.user_id = u.id
            WHERE f.deleted_at IS NOT NULL
            ORDER BY f.deleted_at DESC
        `);

        res.json({ trash: [...submissionsResult.rows, ...formsResult.rows] });
    } catch (err) {
        console.error('Trash bin fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch trash bin' });
    }
});

/**
 * POST /api/admin-analytics/restore/:type/:id — Restore a soft-deleted item
 */
router.post('/restore/:type/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { type, id } = req.params;
        
        if (type === 'submission') {
            const subCheck = await pool.query(
                'SELECT fv.form_id, f.name FROM submissions s JOIN form_versions fv ON s.form_version_id = fv.id JOIN forms f ON fv.form_id = f.id WHERE s.id = $1', 
                [id]
            );
            if (subCheck.rows.length === 0) return res.status(404).json({ error: 'Submission not found' });
            
            await pool.query('UPDATE submissions SET deleted_at = NULL WHERE id = $1', [id]);
            await pool.query(
                'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
                ['restore_submission', req.user.id, JSON.stringify({ submission_id: id, form_id: subCheck.rows[0].form_id, form_name: subCheck.rows[0].name })]
            );
        } else if (type === 'form') {
            await pool.query('UPDATE forms SET deleted_at = NULL WHERE id = $1', [id]);
            await pool.query(
                'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
                ['restore_form', req.user.id, JSON.stringify({ form_id: id })]
            );
        }

        res.json({ message: 'Item restored successfully' });
    } catch (err) {
        console.error('Restore error:', err);
        res.status(500).json({ error: 'Failed to restore item' });
    }
});

/**
 * DELETE /api/admin-analytics/purge/:type/:id — Permanently delete an item
 */
router.delete('/purge/:type/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { type, id } = req.params;
        
        let details = { type, id };
        if (type === 'form') {
            const formRes = await pool.query('SELECT name FROM forms WHERE id = $1', [id]);
            if (formRes.rows.length > 0) details.form_name = formRes.rows[0].name;
        }

        if (type === 'submission') {
            await pool.query('DELETE FROM submissions WHERE id = $1', [id]);
        } else if (type === 'form') {
            // CASCADE delete will handle versions and submissions
            await pool.query('DELETE FROM forms WHERE id = $1', [id]);
        }

        // Log the purge
        await pool.query(
            'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
            ['purge_item', req.user.id, JSON.stringify(details)]
        );

        res.json({ message: 'Item permanently deleted' });
    } catch (err) {
        console.error('Purge error:', err);
        res.status(500).json({ error: 'Failed to purge item' });
    }
});

/**
 * DELETE /api/admin-analytics/empty-trash — Permanently delete everything in trash
 */
router.delete('/empty-trash', authenticate, requireAdmin, async (req, res) => {
    try {
        const subCount = (await pool.query('DELETE FROM submissions WHERE deleted_at IS NOT NULL')).rowCount;
        const formCount = (await pool.query('DELETE FROM forms WHERE deleted_at IS NOT NULL')).rowCount;

        // Log the empty trash action
        await pool.query(
            'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
            ['empty_trash', req.user.id, JSON.stringify({ purged_submissions: subCount, purged_forms: formCount })]
        );

        res.json({ message: 'Trash bin emptied' });
    } catch (err) {
        console.error('Empty trash error:', err);
        res.status(500).json({ error: 'Failed to empty trash' });
    }
});

module.exports = router;
