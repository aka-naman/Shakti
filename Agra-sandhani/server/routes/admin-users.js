const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Apply admin middleware to all routes in this file
router.use(authenticate);
router.use(requireAdmin);

/**
 * DELETE /api/admin/users/:userId — Delete a user and all their data
 */
router.delete('/:userId', async (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId);

        // Prevent admin from deleting themselves
        if (targetUserId === req.user.id) {
            return res.status(400).json({ error: 'You cannot delete your own admin account' });
        }

        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING username', [targetUserId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Log the user deletion
        await pool.query(
            'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
            ['delete_user', req.user.id, JSON.stringify({ deleted_username: result.rows[0].username, deleted_user_id: targetUserId })]
        );

        res.json({ message: `User "${result.rows[0].username}" and all associated data deleted successfully` });
    } catch (err) {
        console.error('Admin delete user error:', err);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

/**
 * PUT /api/admin/users/:userId/profile — Update a user's profile (username/password)
 */
router.put('/:userId/profile', async (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId);
        const { username, password } = req.body;

        if (!username && !password) {
            return res.status(400).json({ error: 'Username or password is required' });
        }

        const updates = [];
        const params = [];
        let paramIdx = 1;

        if (username) {
            // Check if username already exists for another user
            const existing = await pool.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, targetUserId]);
            if (existing.rows.length > 0) {
                return res.status(409).json({ error: 'Username already taken' });
            }
            updates.push(`username = $${paramIdx++}`);
            params.push(username);
        }

        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
            }
            const passwordHash = await bcrypt.hash(password, 12);
            updates.push(`password_hash = $${paramIdx++}`);
            params.push(passwordHash);
        }

        params.push(targetUserId);
        const result = await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING username`,
            params
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: `Profile for "${result.rows[0].username}" updated successfully`, username: result.rows[0].username });
    } catch (err) {
        console.error('Admin update profile error:', err);
        res.status(500).json({ error: 'Failed to update user profile' });
    }
});

/**
 * PUT /api/admin/users/:userId/password — Reset a user's password
 */
router.put('/:userId/password', async (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId);
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        const result = await pool.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING username',
            [passwordHash, targetUserId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: `Password for "${result.rows[0].username}" updated successfully` });
    } catch (err) {
        console.error('Admin reset password error:', err);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

/**
 * PUT /api/admin/users/:userId/role — Change a user's role
 */
router.put('/:userId/role', async (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId);
        const { role } = req.body;

        if (role !== 'admin' && role !== 'user') {
            return res.status(400).json({ error: 'Invalid role' });
        }

        // Prevent admin from demoting themselves
        if (targetUserId === req.user.id && role !== 'admin') {
            return res.status(400).json({ error: 'You cannot remove your own admin status' });
        }

        const result = await pool.query(
            'UPDATE users SET role = $1 WHERE id = $2 RETURNING username, role',
            [role, targetUserId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: `User "${result.rows[0].username}" role updated to ${result.rows[0].role}` });
    } catch (err) {
        console.error('Admin change role error:', err);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

/**
 * GET /api/admin/active-users — Get status of all users for real-time monitoring
 */
router.get('/active-users', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, username, role, last_activity, current_session_id, created_at, last_login, last_logout, last_login_ip, registration_ip
            FROM users 
            ORDER BY last_activity DESC NULLS LAST
        `);
        console.log(`[ADMIN] User status fetch: found ${result.rows.length} users`);
        res.json({ activeUsers: result.rows });
    } catch (err) {
        console.error('Admin fetch active users error:', err);
        res.status(500).json({ error: 'Failed to fetch active users' });
    }
});

module.exports = router;
