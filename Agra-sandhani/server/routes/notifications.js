const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications — Fetch all uncleared notifications for current user
router.get('/', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT n.*, f.name as form_name, u.username as actor_username
             FROM notifications n
             LEFT JOIN forms f ON n.form_id = f.id
             LEFT JOIN users u ON n.actor_id = u.id
             WHERE n.user_id = $1 AND n.status != 'cleared'
             ORDER BY n.created_at DESC`,
            [req.user.id]
        );
        res.json({ notifications: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// PATCH /api/notifications/:id/read — Mark as read
router.patch('/:id/read', authenticate, async (req, res) => {
    try {
        await pool.query(
            "UPDATE notifications SET status = 'read' WHERE id = $1 AND user_id = $2",
            [req.params.id, req.user.id]
        );
        res.json({ message: 'Notification marked as read' });
    } catch (err) {
        res.status(500).json({ error: 'Update failed' });
    }
});

// PATCH /api/notifications/:id/clear — Individual clear
router.patch('/:id/clear', authenticate, async (req, res) => {
    try {
        await pool.query(
            "UPDATE notifications SET status = 'cleared' WHERE id = $1 AND user_id = $2",
            [req.params.id, req.user.id]
        );
        res.json({ message: 'Notification cleared' });
    } catch (err) {
        res.status(500).json({ error: 'Clear failed' });
    }
});

// PATCH /api/notifications/clear-all — Clear all for user
router.patch('/clear-all', authenticate, async (req, res) => {
    try {
        await pool.query(
            "UPDATE notifications SET status = 'cleared' WHERE user_id = $1 AND status != 'cleared'",
            [req.user.id]
        );
        res.json({ message: 'All notifications cleared' });
    } catch (err) {
        res.status(500).json({ error: 'Clear all failed' });
    }
});

module.exports = router;
