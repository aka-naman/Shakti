const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // Ensure ID is a number to match DB integer type
        if (decoded.id) decoded.id = Number(decoded.id);
        
        // --- SESSION VALIDATION ---
        const userResult = await pool.query(
            'SELECT current_session_id, last_activity FROM users WHERE id = $1',
            [decoded.id]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        const user = userResult.rows[0];
        
        // If session_id exists in token, it must match the DB
        if (decoded.session_id && user.current_session_id !== decoded.session_id) {
            return res.status(401).json({ error: 'Your account is logged in on another device. This session has been terminated.' });
        }

        // Update last activity to keep session alive and for admin monitoring
        try {
            await pool.query('UPDATE users SET last_activity = NOW() WHERE id = $1', [decoded.id]);
        } catch (err) {
            console.error('Failed to update last_activity:', err);
        }
        // ---------------------------

        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

/**
 * Check if user has access to a form (owner, admin, or approved collaborator)
 */
const checkFormAccess = async (formId, userId, userRole) => {
    const formResult = await pool.query(
        `SELECT f.*, u.role as owner_role 
         FROM forms f 
         JOIN users u ON f.user_id = u.id 
         WHERE f.id = $1 AND f.deleted_at IS NULL`, 
        [formId]
    );
    if (formResult.rows.length === 0) return { exists: false, hasAccess: false };
    
    const form = formResult.rows[0];
    const isOwner = Number(form.user_id) === Number(userId);
    const isAdmin = userRole === 'admin';

    // 1. Owner always has access
    if (isOwner) {
        return { exists: true, hasAccess: true, isOwner, isAdmin, form };
    }

    // 2. STRICT RULE: If form is owned by an admin, only that admin (handled above) can access it.
    // This overrides any other permission (admin role, delegation, or approved collaborator)
    if (form.owner_role === 'admin') {
        return { exists: true, hasAccess: false, isOwner, isAdmin, form };
    }

    // 3. If form is owned by a non-admin:
    // Check admin role
    if (isAdmin) {
        return { exists: true, hasAccess: true, isOwner, isAdmin, form };
    }

    // Check user-level delegations (Complete data access)
    const delegationResult = await pool.query(
        'SELECT 1 FROM user_delegations WHERE grantor_id = $1 AND grantee_id = $2 AND expires_at > NOW()',
        [Number(form.user_id), Number(userId)]
    );
    if (delegationResult.rows.length > 0) {
        return { exists: true, hasAccess: true, isOwner: false, isAdmin: false, form };
    }

    // Check collaborator approval (with expiration check)
    const permResult = await pool.query(
        `SELECT status FROM form_permissions 
         WHERE form_id = $1 AND user_id = $2 AND status = $3 
         AND (expires_at IS NULL OR expires_at > NOW())`,
        [formId, Number(userId), 'approved']
    );
    
    if (permResult.rows.length > 0) {
        return { exists: true, hasAccess: true, isOwner: false, isAdmin: false, form };
    }

    return { 
        exists: true, 
        hasAccess: false, 
        isOwner: false,
        isAdmin: false,
        form
    };
};

/**
 * Check if user strictly owns a form (or is admin) - used for Rename, Delete, Lock
 */
const checkFormOwnership = async (formId, userId, userRole) => {
    const result = await pool.query(
        `SELECT f.*, u.role as owner_role 
         FROM forms f 
         JOIN users u ON f.user_id = u.id 
         WHERE f.id = $1 AND f.deleted_at IS NULL`, 
        [formId]
    );
    if (result.rows.length === 0) {
        return { exists: false, hasAccess: false };
    }
    const form = result.rows[0];
    const isOwner = Number(form.user_id) === Number(userId);
    const isAdmin = userRole === 'admin';

    // 1. Owner always has access
    if (isOwner) {
        return { exists: true, hasAccess: true, isOwner, isAdmin, form };
    }

    // 2. STRICT RULE: If form is owned by an admin, only that admin can access it.
    if (form.owner_role === 'admin') {
        return { exists: true, hasAccess: false, isOwner, isAdmin, form };
    }

    // 3. For non-admin forms, admins and delegates have access
    const delegationResult = await pool.query(
        'SELECT 1 FROM user_delegations WHERE grantor_id = $1 AND grantee_id = $2 AND expires_at > NOW()',
        [Number(form.user_id), Number(userId)]
    );
    const isDelegate = delegationResult.rows.length > 0;

    return { exists: true, hasAccess: isAdmin || isDelegate, isOwner, isAdmin, form };
};

module.exports = { authenticate, requireAdmin, checkFormAccess, checkFormOwnership, JWT_SECRET };
