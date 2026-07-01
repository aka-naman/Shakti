const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Helper to create notifications
async function createNotification(client, userId, actorId, formId, type, permissionId, message) {
    await client.query(
        `INSERT INTO notifications (user_id, actor_id, form_id, type, permission_id, message) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, actorId, formId, type, permissionId, message]
    );
}

// Helper to log permission actions
async function logPermissionAction(client, permissionId, formId, userId, action, performedBy) {
    await client.query(
        `INSERT INTO permission_logs (permission_id, form_id, user_id, action, performed_by) 
         VALUES ($1, $2, $3, $4, $5)`,
        [permissionId, formId, userId, action, performedBy]
    );
}

// GET /api/permissions/status/:formId
router.get('/status/:formId', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT status FROM form_permissions WHERE form_id = $1 AND user_id = $2',
            [req.params.formId, req.user.id]
        );
        res.json({ status: result.rows[0]?.status || 'none' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get permission status' });
    }
});

// POST /api/permissions/request/:formId
router.post('/request/:formId', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Get form owner
        const formOwnerRes = await client.query('SELECT user_id, name FROM forms WHERE id = $1', [req.params.formId]);
        if (formOwnerRes.rows.length === 0) return res.status(404).json({ error: 'Form not found' });
        const formOwnerId = formOwnerRes.rows[0].user_id;
        const formName = formOwnerRes.rows[0].name;

        const result = await client.query(
            'INSERT INTO form_permissions (form_id, user_id, status) VALUES ($1, $2, $3) ON CONFLICT (form_id, user_id) DO UPDATE SET status = $3 RETURNING id',
            [req.params.formId, req.user.id, 'pending']
        );
        
        const permissionId = result.rows[0].id;
        await logPermissionAction(client, permissionId, req.params.formId, req.user.id, 'requested', req.user.id);
        
        // Notify form owner
        await createNotification(
            client, 
            formOwnerId, 
            req.user.id, 
            req.params.formId, 
            'access_request', 
            permissionId, 
            `${req.user.username} requested access to "${formName}"`
        );

        // Get owner role to check if we should notify other admins
        const ownerCheck = await client.query("SELECT role FROM users WHERE id = $1", [formOwnerId]);
        const isOwnerAdmin = ownerCheck.rows[0]?.role === 'admin';

        // Also notify all other admins ONLY if the form is NOT owned by an admin
        if (!isOwnerAdmin) {
            const adminsRes = await client.query("SELECT id FROM users WHERE role = 'admin' AND id != $1 AND id != $2", [formOwnerId, req.user.id]);
            for (const adminRow of adminsRes.rows) {
                await createNotification(
                    client,
                    adminRow.id,
                    req.user.id,
                    req.params.formId,
                    'access_request',
                    permissionId,
                    `${req.user.username} requested access to "${formName}"`
                );
            }
        }
        
        await client.query('COMMIT');
        res.json({ message: 'Request sent' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Failed to send request' });
    } finally {
        client.release();
    }
});

// GET /api/permissions/pending (For owners/admins)
router.get('/pending', authenticate, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const result = await pool.query(
            `SELECT p.*, f.name as form_name, u.username as requester_username
             FROM form_permissions p
             JOIN forms f ON p.form_id = f.id
             JOIN users u ON p.user_id = u.id
             JOIN users fo ON f.user_id = fo.id
             WHERE p.status = 'pending' 
             AND ( (f.user_id = $1) OR (fo.role != 'admin' AND $2 = true) )`,
            [req.user.id, isAdmin]
        );
        res.json({ requests: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

// POST /api/permissions/:action/:permissionId (Approve, Reject, Ignore)
router.post('/:action/:permissionId', authenticate, async (req, res) => {
    const { action, permissionId } = req.params;
    const { duration, durationUnit, expiresAt: customExpiresAt } = req.body;
    const validActions = ['approve', 'reject', 'ignore'];
    
    if (!validActions.includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
    }

    const statusMap = {
        approve: 'approved',
        reject: 'rejected',
        ignore: 'ignored'
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Only owner or admin can decide
        const permResult = await client.query(
            `SELECT p.form_id, p.user_id as requester_id, f.name as form_name 
             FROM form_permissions p 
             JOIN forms f ON p.form_id = f.id 
             WHERE p.id = $1`, [permissionId]);
             
        if (permResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        
        const { form_id, requester_id, form_name } = permResult.rows[0];
        const formResult = await client.query('SELECT user_id FROM forms WHERE id = $1', [form_id]);
        
        if (req.user.role !== 'admin' && formResult.rows[0].user_id !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        let expiresAt = null;
        if (action === 'approve') {
            if (customExpiresAt) {
                expiresAt = new Date(customExpiresAt);
            } else if (duration && durationUnit) {
                expiresAt = new Date();
                if (durationUnit === 'hours') expiresAt.setHours(expiresAt.getHours() + parseInt(duration));
                else if (durationUnit === 'days') expiresAt.setDate(expiresAt.getDate() + parseInt(duration));
            } else if (duration) { // Fallback for old simple duration (hours)
                expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + parseInt(duration));
            }
        }

        await client.query(
            'UPDATE form_permissions SET status = $1, expires_at = $2 WHERE id = $3', 
            [statusMap[action], expiresAt, permissionId]
        );
        
        await logPermissionAction(client, permissionId, form_id, requester_id, action, req.user.id);
        
        // Notify requester (except for 'ignore')
        if (action !== 'ignore') {
            const typeMap = {
                approve: 'request_approved',
                reject: 'request_rejected'
            };

            const durationText = expiresAt ? ` until ${expiresAt.toLocaleString()}` : '';
            await createNotification(
                client,
                requester_id,
                req.user.id,
                form_id,
                typeMap[action],
                permissionId,
                `Access to "${form_name}" was ${statusMap[action]}${durationText}`
            );
        }

        // Also mark the original 'access_request' notification as read/cleared for the recipient
        await client.query(
            "UPDATE notifications SET status = 'read' WHERE form_id = $1 AND actor_id = $2 AND type = 'access_request'",
            [form_id, requester_id]
        );
        
        await client.query('COMMIT');
        res.json({ message: `Successfully ${statusMap[action]}` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: `${action} failed` });
    } finally {
        client.release();
    }
});

// ═══════════════════════════════════════ DELEGATION ROUTES ═══════════════════════════════════════

/**
 * POST /api/permissions/delegate
 * Grant complete data access to another user for a limited time
 */
router.post('/delegate', authenticate, async (req, res) => {
    const { granteeId, duration, durationUnit, expiresAt: customExpiresAt, grantorId } = req.body;
    
    if (!granteeId || (!duration && !customExpiresAt)) {
        return res.status(400).json({ error: 'granteeId and duration/expiresAt are required' });
    }

    const finalGrantorId = (req.user.role === 'admin' && grantorId) ? grantorId : req.user.id;
    
    if (finalGrantorId === granteeId) {
        return res.status(400).json({ error: 'Cannot delegate to yourself' });
    }

    let expiresAt = null;
    if (customExpiresAt) {
        expiresAt = new Date(customExpiresAt);
    } else if (duration && durationUnit) {
        expiresAt = new Date();
        if (durationUnit === 'hours') expiresAt.setHours(expiresAt.getHours() + parseInt(duration));
        else if (durationUnit === 'days') expiresAt.setDate(expiresAt.getDate() + parseInt(duration));
    } else {
        expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + parseInt(duration));
    }

    try {
        await pool.query(
            `INSERT INTO user_delegations (grantor_id, grantee_id, expires_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (grantor_id, grantee_id) 
             DO UPDATE SET expires_at = $3`,
            [finalGrantorId, granteeId, expiresAt]
        );

        // Fetch usernames for notification
        const usersRes = await pool.query('SELECT id, username FROM users WHERE id = $1 OR id = $2', [finalGrantorId, granteeId]);
        
        const grantor = usersRes.rows.find(u => String(u.id) === String(finalGrantorId));
        const grantee = usersRes.rows.find(u => String(u.id) === String(granteeId));

        // Fallback for grantor if not found in query (shouldn't happen, but for safety)
        const finalGrantorUsername = grantor ? grantor.username : req.user.username;
        const finalGranteeUsername = grantee ? grantee.username : 'User';

        // Notify grantee
        const client = await pool.connect();
        try {
            await createNotification(
                client,
                granteeId,
                req.user.id,
                null,
                'delegation_granted',
                null,
                `${finalGrantorUsername} granted you complete data access until ${expiresAt.toLocaleString()}`
            );
        } finally {
            client.release();
        }

        res.json({ message: `Access delegated to ${finalGranteeUsername} until ${expiresAt.toLocaleString()}` });
    } catch (err) {
        console.error('Delegation error:', err);
        res.status(500).json({ error: 'Failed to delegate access' });
    }
});

/**
 * GET /api/permissions/delegations
 * List active delegations involving the current user
 */
router.get('/delegations', authenticate, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        
        // Outgoing delegations (I am the grantor, I granted access to someone else)
        const outgoing = await pool.query(
            `SELECT d.*, u.username as recipient_username
             FROM user_delegations d
             JOIN users u ON d.grantee_id = u.id
             WHERE d.grantor_id = $1 AND d.expires_at > NOW()`,
            [req.user.id]
        );

        // Incoming delegations (I am the grantee, someone else granted access to me)
        const incoming = await pool.query(
            `SELECT d.*, u.username as owner_username
             FROM user_delegations d
             JOIN users u ON d.grantor_id = u.id
             WHERE d.grantee_id = $1 AND d.expires_at > NOW()`,
            [req.user.id]
        );

        let allActive = [];
        if (isAdmin) {
            allActive = await pool.query(
                `SELECT d.*, u1.username as grantor_username, u2.username as recipient_username
                 FROM user_delegations d
                 JOIN users u1 ON d.grantor_id = u1.id
                 JOIN users u2 ON d.grantee_id = u2.id
                 WHERE d.expires_at > NOW()
                 ORDER BY d.expires_at DESC`
            );
        }

        res.json({ 
            outgoing: outgoing.rows, 
            incoming: incoming.rows,
            allActive: isAdmin ? allActive.rows : []
        });
    } catch (err) {
        console.error('Fetch delegations error:', err);
        res.status(500).json({ error: 'Failed to fetch delegations' });
    }
});

/**
 * DELETE /api/permissions/delegate/:id
 * Revoke a delegation
 */
router.delete('/delegate/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const isAdmin = req.user.role === 'admin';

        if (isAdmin) {
            await pool.query('DELETE FROM user_delegations WHERE id = $1', [id]);
        } else {
            await pool.query('DELETE FROM user_delegations WHERE id = $1 AND grantor_id = $2', [id, req.user.id]);
        }
        
        res.json({ message: 'Delegation revoked' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to revoke delegation' });
    }
});


// GET /api/permissions/logs (Admin only or Owner for their forms)
router.get('/logs', authenticate, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const result = await pool.query(
            `SELECT l.*, f.name as form_name, u.username as requester, p.username as performer
             FROM permission_logs l
             JOIN forms f ON l.form_id = f.id
             JOIN users fo ON f.user_id = fo.id
             JOIN users u ON l.user_id = u.id
             LEFT JOIN users p ON l.performed_by = p.id
             WHERE ( (f.user_id = $1) OR (fo.role != 'admin' AND $2 = true) )
             ORDER BY l.timestamp DESC LIMIT 100`,
            [req.user.id, isAdmin]
        );
        res.json({ logs: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

/**
 * GET /api/permissions/users
 * List users available for delegation
 */
router.get('/users', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username FROM users WHERE id != $1 ORDER BY username ASC',
            [req.user.id]
        );
        res.json({ users: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

module.exports = router;
