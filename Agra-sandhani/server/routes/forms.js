const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireAdmin, checkFormAccess, checkFormOwnership } = require('../middleware/auth');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Configure storage for large file uploads (1GB)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit
});

/**
 * POST /api/forms/import-excel
 * @desc Create a new form and import data from an Excel file
 */
router.post('/import-excel', authenticate, upload.single('file'), async (req, res) => {
    console.log('[IMPORT] Request received');
    const client = await pool.connect();
    try {
        if (!XLSX || typeof XLSX.readFile !== 'function') {
            throw new Error('XLSX library is not properly loaded');
        }

        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Form name is required' });

        console.log(`[IMPORT] Processing file: ${req.file.path}`);

        const workbook = XLSX.readFile(req.file.path, { cellDates: true });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!worksheet) throw new Error('Excel file has no valid sheets');

        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        if (rows.length === 0) throw new Error('Excel file is empty');

        const rawHeaders = rows[0];
        const headerLabels = [];
        const seen = new Set();

        rawHeaders.forEach((h, i) => {
            let label = h?.toString().trim() || `Column_${i + 1}`;
            let uniqueLabel = label;
            let counter = 1;
            while (seen.has(uniqueLabel)) {
                uniqueLabel = `${label}_${counter++}`;
            }
            seen.add(uniqueLabel);
            headerLabels.push(uniqueLabel);
        });

        await client.query('BEGIN');

        const formRes = await client.query(
            'INSERT INTO forms (name, user_id) VALUES ($1, $2) RETURNING id',
            [name, req.user.id]
        );
        const formId = formRes.rows[0].id;

        const versionRes = await client.query(
            'INSERT INTO form_versions (form_id, version_number) VALUES ($1, 1) RETURNING id',
            [formId]
        );
        const versionId = versionRes.rows[0].id;

        const fieldIds = []; 
        for (let i = 0; i < headerLabels.length; i++) {
            const label = headerLabels[i];
            const lowerLabel = label.toLowerCase();
            
            let type = 'text';
            let isUnique = false;
            
            if (lowerLabel.includes('pis') || lowerLabel.includes('personnel')) isUnique = true;
            else if (lowerLabel.includes('date') || lowerLabel.includes('dob')) type = 'date';
            else if (lowerLabel.includes('email')) type = 'email';
            else if (lowerLabel.includes('mobile') || lowerLabel.includes('phone') || lowerLabel.includes('contact')) type = 'phone';

            const fieldRes = await client.query(
                `INSERT INTO form_fields (form_version_id, label, type, field_order, is_unique) 
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [versionId, label, type, i, isUnique]
            );
            fieldIds.push(fieldRes.rows[0].id);
        }

        let importedCount = 0;
        for (let i = 1; i < rows.length; i++) {
            const rowArr = rows[i];
            const cleanRowData = {};
            let hasValue = false;
            
            headerLabels.forEach((label, idx) => {
                let val = rowArr[idx];
                if (val instanceof Date) {
                    const d = val.getDate().toString().padStart(2, '0');
                    const m = (val.getMonth() + 1).toString().padStart(2, '0');
                    const y = val.getFullYear();
                    val = `${d}-${m}-${y}`;
                } else {
                    val = (val === null || val === undefined) ? '' : val.toString().trim();
                }
                if (val) hasValue = true;
                cleanRowData[label] = val;
            });

            if (hasValue) {
                const subRes = await client.query(
                    `INSERT INTO submissions (form_version_id, user_id, data_json) 
                     VALUES ($1, $2, $3) RETURNING id`,
                    [versionId, req.user.id, JSON.stringify(cleanRowData)]
                );
                const submissionId = subRes.rows[0].id;

                for (let idx = 0; idx < headerLabels.length; idx++) {
                    await client.query(
                        'INSERT INTO submission_values (submission_id, field_id, value) VALUES ($1, $2, $3)',
                        [submissionId, fieldIds[idx], cleanRowData[headerLabels[idx]]]
                    );
                }
                importedCount++;
            }
        }

        await client.query('COMMIT');
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.json({ message: `Successfully created form "${name}" and imported ${importedCount} records`, formId });

    } catch (err) {
        console.error('[IMPORT] FATAL:', err);
        await client.query('ROLLBACK');
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: err.message || 'Excel import failed' });
    } finally {
        client.release();
    }
});

/**
 * GET /api/forms/:id/validate-unique
 */
router.get('/:id/validate-unique', authenticate, async (req, res) => {
    try {
        const { label, value } = req.query;
        if (!label || !value) return res.status(400).json({ error: 'Label and value are required' });

        const result = await pool.query(`
            SELECT s.id
            FROM submissions s
            JOIN form_versions fv ON s.form_version_id = fv.id
            WHERE fv.form_id = $1
              AND s.deleted_at IS NULL
              AND LOWER(s.data_json->>$2) = LOWER($3)
            LIMIT 1
        `, [req.params.id, label, value.trim()]);

        res.json({ exists: result.rows.length > 0 });
    } catch (err) {
        console.error('Validate unique error:', err);
        res.status(500).json({ error: 'Validation failed' });
    }
});

/**
 * POST /api/forms/upload
 */
router.post('/upload', authenticate, upload.array('files', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
        const uploadDir = path.join(__dirname, '..', 'uploads');
        const sessionFolder = `batch_${Date.now()}_${Math.round(Math.random() * 1E9)}`;
        const targetDir = path.join(uploadDir, sessionFolder);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        for (const file of req.files) {
            const newPath = path.join(targetDir, file.filename);
            fs.renameSync(file.path, newPath);
        }
        res.json({ folderPath: `/uploads/${sessionFolder}` });
    } catch (err) {
        res.status(500).json({ error: 'Upload failed' });
    }
});

/**
 * GET /api/forms/upload-files
 */
router.get('/upload-files', (req, res) => {
    try {
        const { folderPath } = req.query;
        if (!folderPath || !folderPath.startsWith('/uploads/')) return res.status(400).json({ error: 'Invalid path' });
        const targetDir = path.join(__dirname, '..', 'uploads', folderPath.replace('/uploads/', ''));
        if (!fs.existsSync(targetDir)) return res.status(404).json({ error: 'Not found' });
        res.json({ files: fs.readdirSync(targetDir) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list' });
    }
});

/**
 * GET /api/forms
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const isAdmin = req.user.role === 'admin';

        const result = await pool.query(
            `SELECT f.*,
                u.username as owner_username,
                u.role as owner_role,
                CASE 
                    WHEN f.user_id = $1::int OR $2 = true OR ud.id IS NOT NULL OR fp.status = 'approved' THEN fv.id 
                    ELSE NULL 
                END as latest_version_id,
                fv.version_number,
                COALESCE(sub_count.count, 0)::int as submission_count,
                CASE
                    WHEN f.user_id = $1::int THEN 'owner'
                    WHEN $2 = true THEN 'admin'
                    WHEN ud.id IS NOT NULL THEN 'delegate'
                    WHEN fp.status = 'ignored' THEN 'pending'
                    ELSE COALESCE(fp.status, 'none')
                END as access_status
            FROM forms f
            LEFT JOIN users u ON f.user_id = u.id
            LEFT JOIN form_permissions fp ON f.id = fp.form_id AND fp.user_id = $1::int 
                AND (fp.expires_at IS NULL OR fp.expires_at > NOW())
            LEFT JOIN user_delegations ud ON f.user_id = ud.grantor_id AND ud.grantee_id = $1::int
                AND ud.expires_at > NOW()
            LEFT JOIN LATERAL (
                SELECT id, version_number FROM form_versions
                WHERE form_id = f.id ORDER BY version_number DESC LIMIT 1
            ) fv ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int as count FROM submissions
                WHERE form_version_id = fv.id AND deleted_at IS NULL
            ) sub_count ON true
            WHERE ((u.role != 'admin') OR (f.user_id = $1::int)) AND f.deleted_at IS NULL
            ORDER BY u.username ASC, f.created_at DESC`,
            [userId, isAdmin]
        );

        res.json({ forms: result.rows });
    } catch (err) {
        console.error('List forms error:', err);
        res.status(500).json({ error: 'Failed to list forms' });
    }
});

/**
 * POST /api/forms
 */
router.post('/', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Form name is required' });
        
        await client.query('BEGIN');
        const formResult = await client.query('INSERT INTO forms (name, user_id) VALUES ($1, $2) RETURNING *', [name.trim(), req.user.id]);
        const form = formResult.rows[0];
        await client.query('INSERT INTO form_versions (form_id, version_number) VALUES ($1, 1)', [form.id]);

        await client.query('COMMIT');
        res.status(201).json({ form });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to create form' });
    } finally { client.release(); }
});

/**
 * POST /api/forms/:id/duplicate
 */
router.post('/:id/duplicate', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const access = await checkFormAccess(req.params.id, req.user.id, req.user.role);
        if (!access.exists || !access.hasAccess) return res.status(403).json({ error: 'Denied' });

        await client.query('BEGIN');
        const originalForm = access.form;
        
        const newFormResult = await client.query('INSERT INTO forms (name, user_id) VALUES ($1, $2) RETURNING *', [`Copy of ${originalForm.name}`, req.user.id]);
        const newForm = newFormResult.rows[0];

        const versionResult = await client.query('SELECT * FROM form_versions WHERE form_id = $1 ORDER BY version_number DESC LIMIT 1', [originalForm.id]);
        if (versionResult.rows.length > 0) {
            const originalVersion = versionResult.rows[0];
            const newVersionResult = await client.query('INSERT INTO form_versions (form_id, version_number) VALUES ($1, 1) RETURNING *', [newForm.id]);
            const newVersion = newVersionResult.rows[0];

            const fieldsResult = await client.query('SELECT label, type, options_json, field_order, validation_rules, data_type, is_unique FROM form_fields WHERE form_version_id = $1', [originalVersion.id]);
            for (const field of fieldsResult.rows) {
                await client.query(
                    'INSERT INTO form_fields (form_version_id, label, type, options_json, field_order, validation_rules, data_type, is_unique) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                    [newVersion.id, field.label, field.type, JSON.stringify(field.options_json), field.field_order, JSON.stringify(field.validation_rules), field.data_type, !!field.is_unique]
                );
            }
        }
        await client.query('COMMIT');

        const finalResult = await client.query(
            `SELECT f.*, fv.id as latest_version_id, fv.version_number
             FROM forms f
             LEFT JOIN LATERAL (SELECT id, version_number FROM form_versions WHERE form_id = f.id ORDER BY version_number DESC LIMIT 1) fv ON true
             WHERE f.id = $1`, [newForm.id]
        );

        res.status(201).json({ form: finalResult.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to duplicate' });
    } finally { client.release(); }
});

/**
 * POST /api/forms/:id/duplicate-with-records
 */
router.post('/:id/duplicate-with-records', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const access = await checkFormAccess(req.params.id, req.user.id, req.user.role);
        if (!access.exists || !access.hasAccess) return res.status(403).json({ error: 'Denied' });

        await client.query('BEGIN');
        const originalForm = access.form;
        
        const newFormRes = await client.query(
            'INSERT INTO forms (name, user_id) VALUES ($1, $2) RETURNING *',
            [`Copy of ${originalForm.name} (with records)`, req.user.id]
        );
        const newForm = newFormRes.rows[0];

        const versionsRes = await client.query('SELECT * FROM form_versions WHERE form_id = $1', [originalForm.id]);
        
        for (const oldVer of versionsRes.rows) {
            const newVerRes = await client.query(
                'INSERT INTO form_versions (form_id, version_number, created_at) VALUES ($1, $2, $3) RETURNING id',
                [newForm.id, oldVer.version_number, oldVer.created_at]
            );
            const newVerId = newVerRes.rows[0].id;

            const fieldsRes = await client.query('SELECT * FROM form_fields WHERE form_version_id = $1', [oldVer.id]);
            const fieldMap = {}; 
            for (const f of fieldsRes.rows) {
                const newFieldRes = await client.query(
                    'INSERT INTO form_fields (form_version_id, label, type, options_json, field_order, validation_rules, data_type, is_unique) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
                    [newVerId, f.label, f.type, JSON.stringify(f.options_json), f.field_order, JSON.stringify(f.validation_rules), f.data_type, !!f.is_unique]
                );
                fieldMap[f.id] = newFieldRes.rows[0].id;
            }

            const subsRes = await client.query('SELECT * FROM submissions WHERE form_version_id = $1', [oldVer.id]);
            for (const s of subsRes.rows) {
                const newSubRes = await client.query(
                    'INSERT INTO submissions (form_version_id, user_id, submitted_at, updated_at, updated_by, data_json, remarks, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
                    [newVerId, s.user_id, s.submitted_at, s.updated_at, s.updated_by, JSON.stringify(s.data_json), s.remarks, s.deleted_at]
                );
                const newSubId = newSubRes.rows[0].id;

                await client.query(
                    `INSERT INTO submission_values (submission_id, field_id, value)
                     SELECT $1, 
                            ($3::int[])[array_position($2::int[], field_id)], 
                            value
                     FROM submission_values 
                     WHERE submission_id = $4 
                       AND field_id = ANY($2::int[])`,
                    [newSubId, Object.keys(fieldMap).map(Number), Object.values(fieldMap).map(Number), s.id]
                );
            }
        }

        await client.query('COMMIT');
        
        const finalResult = await client.query(
            `SELECT f.*, fv.id as latest_version_id, fv.version_number
             FROM forms f
             LEFT JOIN LATERAL (SELECT id, version_number FROM form_versions WHERE form_id = f.id ORDER BY version_number DESC LIMIT 1) fv ON true
             WHERE f.id = $1`, [newForm.id]
        );

        res.status(201).json({ form: finalResult.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to duplicate' });
    } finally { client.release(); }
});

/**
 * POST /api/forms/:id/lock
 */
router.post('/:id/lock', authenticate, async (req, res) => {
    try {
        const ownership = await checkFormOwnership(req.params.id, req.user.id, req.user.role);
        if (!ownership.hasAccess) return res.status(403).json({ error: 'Denied' });
        await pool.query('UPDATE forms SET is_locked = true WHERE id = $1', [req.params.id]);
        res.json({ message: 'Locked' });
    } catch (err) { res.status(500).json({ error: 'Lock failed' }); }
});

/**
 * GET /api/forms/:id
 */
router.get('/:id', authenticate, async (req, res) => {
    try {
        const access = await checkFormAccess(req.params.id, req.user.id, req.user.role);
        if (!access.exists) return res.status(404).json({ error: 'Not found' });
        if (!access.hasAccess) return res.status(403).json({ error: 'Denied' });

        const result = await pool.query(
            `SELECT f.*, u.username as owner_username, fv.id as latest_version_id, fv.version_number
             FROM forms f
             LEFT JOIN users u ON f.user_id = u.id
             LEFT JOIN LATERAL (SELECT id, version_number FROM form_versions WHERE form_id = f.id ORDER BY version_number DESC LIMIT 1) fv ON true
             WHERE f.id = $1`, [req.params.id]
        );
        res.json({ form: result.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

/**
 * PUT /api/forms/:id
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const { name } = req.body;
        const ownership = await checkFormOwnership(req.params.id, req.user.id, req.user.role);
        if (!ownership.hasAccess) return res.status(403).json({ error: 'Denied' });
        
        const result = await pool.query('UPDATE forms SET name = $1 WHERE id = $2 RETURNING *', [name.trim(), req.params.id]);
        res.json({ form: result.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Rename failed' }); }
});

/**
 * DELETE /api/forms/:id
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const ownership = await checkFormOwnership(req.params.id, req.user.id, req.user.role);
        if (!ownership.hasAccess) return res.status(403).json({ error: 'Denied' });
        await pool.query('UPDATE forms SET deleted_at = NOW() WHERE id = $1', [req.params.id]);
        res.json({ message: 'Moved to trash' });
    } catch (err) { res.status(500).json({ error: 'Delete failed' }); }
});

/**
 * ADMIN ROUTES
 */
router.get('/admin/all', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
        const result = await pool.query(`
            SELECT f.*, u.username as owner_username, fv.id as latest_version_id, fv.version_number,
              COALESCE(sub_count.count, 0)::int as submission_count
            FROM forms f
            LEFT JOIN users u ON f.user_id = u.id
            LEFT JOIN LATERAL (SELECT id, version_number FROM form_versions WHERE form_id = f.id ORDER BY version_number DESC LIMIT 1) fv ON true
            LEFT JOIN LATERAL (SELECT COUNT(*)::int as count FROM submissions WHERE form_version_id = fv.id AND deleted_at IS NULL) sub_count ON true
            WHERE f.deleted_at IS NULL
            ORDER BY f.created_at DESC
        `);
        res.json({ forms: result.rows });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/admin/stats', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
        const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users');
        const totalForms = await pool.query('SELECT COUNT(*) as count FROM forms WHERE deleted_at IS NULL');
        const totalSubmissions = await pool.query('SELECT COUNT(*) as count FROM submissions WHERE deleted_at IS NULL');
        res.json({ stats: { total_users: parseInt(totalUsers.rows[0].count), total_forms: parseInt(totalForms.rows[0].count), total_submissions: parseInt(totalSubmissions.rows[0].count) } });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
