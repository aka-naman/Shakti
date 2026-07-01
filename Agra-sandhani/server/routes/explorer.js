const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const pdfmake = require('pdfmake');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { generateSql } = require('../services/textToSql');

// PDF Font Configuration (Standard Fonts)
const fonts = {
    Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
    }
};
pdfmake.setFonts(fonts);

/**
 * Helper to wrap SQL with user isolation and selected form bounds
 */
function enforceIsolation(sql, userId, userRole, selectedFormIds = []) {
    const isAdmin = userRole === 'admin';
    const ownerSubquery = `(SELECT role FROM users WHERE id = f.user_id)`;
    
    // Base filters: User access + Not deleted
    const isolationFilter = `(f.user_id = ${userId} OR (${ownerSubquery} != 'admin' AND (f.id IN (SELECT form_id FROM form_permissions WHERE user_id = ${userId} AND status = 'approved' AND (expires_at IS NULL OR expires_at > NOW())) OR f.user_id IN (SELECT grantor_id FROM user_delegations WHERE grantee_id = ${userId} AND expires_at > NOW())))) AND f.deleted_at IS NULL`;
    const adminFilter = `(f.user_id = ${userId} OR ${ownerSubquery} != 'admin') AND f.deleted_at IS NULL`;
    
    // Add submission soft-delete check if table 's' is used
    let submissionFilter = '';
    if (sql.toLowerCase().includes('submissions s') || sql.toLowerCase().includes('submissions as s')) {
        submissionFilter = 's.deleted_at IS NULL';
    }

    // 1. Ensure the SQL actually has the forms join if we are going to use 'f'
    let finalSql = sql;
    if (!sql.toLowerCase().includes('join forms f')) {
        if (sql.toLowerCase().includes('from submissions s')) {
            finalSql = sql.replace(/from submissions s/i, 'FROM submissions s JOIN form_versions fv ON s.form_version_id = fv.id JOIN forms f ON fv.form_id = f.id');
        } else {
            finalSql = sql.replace(/from submissions/i, 'FROM submissions s JOIN form_versions fv ON s.form_version_id = fv.id JOIN forms f ON fv.form_id = f.id');
        }
    }

    // 2. Build the combined security + selection + deletion filters
    let filters = [];
    if (isAdmin) {
        filters.push(adminFilter);
    } else {
        filters.push(isolationFilter);
    }
    
    if (submissionFilter) filters.push(submissionFilter);

    if (selectedFormIds && selectedFormIds.length > 0) {
        filters.push(`f.id IN (${selectedFormIds.join(',')})`);
    }

    if (filters.length === 0) return finalSql;

    const combinedFilter = `(${filters.join(' AND ')})`;

    // 3. Check if isolation/filter is already present (from model)
    const hasIsolation = finalSql.toLowerCase().includes('f.user_id =') || finalSql.toLowerCase().includes('current_user_id()');
    
    if (hasIsolation) {
        return finalSql.replace(/current_user_id\(\)/gi, userId)
                     .replace(/f\.user_id\s*=\s*\d+/gi, `f.user_id = ${userId}`);
    }

    const hasWhere = finalSql.toLowerCase().includes('where');
    
    if (hasWhere) {
        return finalSql.replace(/\bwhere\b/i, `WHERE ${combinedFilter} AND `);
    } else {
        if (finalSql.toLowerCase().includes('group by')) {
            return finalSql.replace(/group by/i, `WHERE ${combinedFilter} GROUP BY`);
        }
        if (finalSql.toLowerCase().includes('order by')) {
            return finalSql.replace(/order by/i, `WHERE ${combinedFilter} ORDER BY`);
        }
        return `${finalSql} WHERE ${combinedFilter}`;
    }
}

/**
 * @route GET /api/explorer/schema
 * @desc  Get all forms and unique field labels the user has access to
 * @access Private
 */
router.get('/schema', authenticate, async (req, res) => {
    try {
        // 1. Get forms the user has access to (Owner, Admin, Approved, or Delegate)
        // STRICT RULE: Admin forms are only visible to their owners.
        const formsResult = await pool.query(`
            SELECT f.id, f.name 
            FROM forms f
            JOIN users u ON f.user_id = u.id
            LEFT JOIN form_permissions fp ON f.id = fp.form_id AND fp.user_id = $1 
                AND (fp.expires_at IS NULL OR fp.expires_at > NOW())
            LEFT JOIN user_delegations ud ON f.user_id = ud.grantor_id AND ud.grantee_id = $1
                AND ud.expires_at > NOW()
            WHERE f.deleted_at IS NULL AND ((f.user_id = $1)
               OR (u.role != 'admin' AND ($2 = 'admin' OR fp.status = 'approved' OR ud.id IS NOT NULL)))
            ORDER BY f.name ASC
        `, [req.user.id, req.user.role]);

        const formIds = formsResult.rows.map(f => f.id);

        if (formIds.length === 0) {
            return res.json({ forms: [], fields: [] });
        }

        // 2. Get unique field labels and their types across those forms
        const fieldsResult = await pool.query(`
            SELECT DISTINCT label, data_type 
            FROM form_fields 
            WHERE form_version_id IN (
                SELECT fv.id 
                FROM form_versions fv
                INNER JOIN (
                    SELECT form_id, MAX(version_number) as max_v
                    FROM form_versions
                    WHERE form_id = ANY($1)
                    GROUP BY form_id
                ) latest ON fv.form_id = latest.form_id AND fv.version_number = latest.max_v
            )
            ORDER BY label ASC
        `, [formIds]);

        res.json({
            forms: formsResult.rows,
            fields: fieldsResult.rows.map(r => ({ label: r.label, type: r.data_type }))
        });
    } catch (err) {
        console.error('❌ Schema Error:', err);
        res.status(500).json({ error: 'Failed to fetch explorer schema' });
    }
});

/**
 * @route POST /api/explorer/query
 * @desc  Translate natural language to SQL and execute it (Isolated)
 * @access Private
 */
router.post('/query', authenticate, async (req, res) => {
    try {
        const { prompt, selectedForms } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // 1. Fetch metadata context for ALL selected forms
        let schemaContext = null;
        if (selectedForms && selectedForms.length > 0) {
            const formIds = selectedForms.map(f => f.id);
            
            // Get unique fields and their types across all selected forms
            const fieldsResult = await pool.query(`
                SELECT DISTINCT label, data_type 
                FROM form_fields 
                WHERE form_version_id IN (
                    SELECT id FROM form_versions 
                    WHERE form_id = ANY($1)
                )
                ORDER BY label ASC
            `, [formIds]);
            
            schemaContext = {
                formNames: selectedForms.map(f => f.name),
                fields: fieldsResult.rows
            };
        }

        // 2. Generate SQL from prompt with Multi-Form Metadata context
        let sql = await generateSql(prompt, schemaContext);
        if (!sql) {
            return res.status(500).json({ error: 'Failed to generate SQL' });
        }

        // 3. Enforce Security Isolation & Scope
        const formIds = selectedForms ? selectedForms.map(f => f.id) : [];
        sql = enforceIsolation(sql, req.user.id, req.user.role, formIds);
        console.log(`📡 [USER:${req.user.username}] AI SQL: ${sql}`);

        // 4. Execute SQL
        const result = await pool.query(sql);

        // 5. Aggressive Normalization: Map any variation of data_json/data to "Data"
        const normalizedRows = result.rows.map(row => {
            const newRow = { ...row };
            
            // Find if there's any key that looks like our data column
            const dataKey = Object.keys(row).find(k => 
                k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data'
            );

            if (dataKey) {
                // Ensure it's an object (pg driver does this for jsonb)
                newRow.Data = row[dataKey];
                // Remove the original if it was named something else (e.g., data_json, DATA, etc.)
                if (dataKey !== 'Data') delete newRow[dataKey];
            }
            return newRow;
        });

        res.json({
            sql: sql,
            rowCount: result.rowCount,
            rows: normalizedRows
        });

    } catch (err) {
        console.error('❌ Explorer Error:', err);
        res.status(500).json({ 
            error: 'AI Query failed',
            details: err.message
        });
    }
});

/**
 * @route POST /api/explorer/export
 * @desc  Export AI results to Excel (Streaming)
 * @access Private
 */
router.post('/export', authenticate, async (req, res) => {
    try {
        const { prompt, selectedForms, selectedFields } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        // 1. Fetch metadata context for ALL selected forms
        let schemaContext = null;
        let canonicalFieldOrder = [];

        if (selectedForms && selectedForms.length > 0) {
            const formIds = selectedForms.map(f => f.id);
            
            // Get fields and their DESIGN order
            const fieldsResult = await pool.query(`
                SELECT DISTINCT label, data_type, MIN(field_order) as min_order
                FROM form_fields 
                WHERE form_version_id IN (
                    SELECT id FROM form_versions 
                    WHERE form_id = ANY($1)
                )
                GROUP BY label, data_type
                ORDER BY min_order ASC
            `, [formIds]);
            
            canonicalFieldOrder = fieldsResult.rows.map(f => f.label);

            schemaContext = {
                formNames: selectedForms.map(f => f.name),
                fields: fieldsResult.rows
            };
        }

        let sql = await generateSql(prompt, schemaContext);
        if (!sql) return res.status(500).json({ error: 'Failed to generate SQL' });
        
        const formIds = selectedForms ? selectedForms.map(f => f.id) : [];
        sql = enforceIsolation(sql, req.user.id, req.user.role, formIds);
        
        const result = await pool.query(sql);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No data to export' });
        }

        // 2. Setup Streaming Excel
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="ai_explorer_export.xlsx"`);

        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
            stream: res,
            useStyles: true,
            useSharedStrings: true
        });

        const worksheet = workbook.addWorksheet('AI Query Results');

        // 3. Header Discovery & Ordering
        const dataKeys = new Set();
        result.rows.forEach(row => {
            const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
            if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
            }
        });

        const fixedHeaders = Object.keys(result.rows[0]).filter(k => 
            !['data_json', 'data', 'Data'].includes(k)
        );

        // Sort dynamic headers by canonical design order, then alphabetically for unknown ones
        let dynamicHeaders = Array.from(dataKeys).sort((a, b) => {
            const idxA = canonicalFieldOrder.indexOf(a);
            const idxB = canonicalFieldOrder.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        // Apply user's field selection if provided
        if (selectedFields && selectedFields.length > 0) {
            dynamicHeaders = dynamicHeaders.filter(h => selectedFields.includes(h));
        }

        const allHeaders = [...fixedHeaders, ...dynamicHeaders];
        worksheet.columns = allHeaders.map(h => ({ header: h, key: h, width: 25 }));

        // 4. Stream Rows
        result.rows.forEach(row => {
            const cleanedRow = {};
            
            // Normalize JSON data source
            const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
            const rowData = dataKey ? row[dataKey] : (row.Data || {});

            // Process fixed columns
            fixedHeaders.forEach(k => {
                let val = row[k];
                if (typeof val === 'string') val = val.replace(/ \|\|\| /g, ', ');
                cleanedRow[k] = val;
            });

            // Process dynamic Data columns
            dynamicHeaders.forEach(k => {
                let val = rowData[k] || '';
                if (typeof val === 'string') {
                    val = val.replace(/ \|\|\| /g, ', ');
                    // Convert relative upload paths to absolute URLs for LAN access
                    if (val.startsWith('/uploads/')) {
                        const host = req.get('host');
                        const protocol = req.protocol;
                        val = `${protocol}://${host}${val}`;
                    }
                }
                cleanedRow[k] = val;
            });

            worksheet.addRow(cleanedRow).commit();
        });

        await worksheet.commit();
        await workbook.commit();
        res.end();

    } catch (err) {
        console.error('❌ Explorer Export Error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Export failed' });
        }
    }
});

/**
 * @route POST /api/explorer/export/pdf
 * @desc  Export AI results to PDF (Landscape)
 * @access Private
 */
router.post('/export/pdf', authenticate, async (req, res) => {
    try {
        const { prompt, selectedForms, selectedFields, groupBy, specialMode } = req.body;
        console.log(`📡 [PDF EXPORT] Starting for Prompt: "${prompt}", GroupBy: ${groupBy}, SpecialMode: ${specialMode}`);
        
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        // 1. Fetch metadata context for ALL selected forms
        let schemaContext = null;
        let canonicalFieldOrder = [];
        if (selectedForms && selectedForms.length > 0) {
            const formIds = selectedForms.map(f => f.id);
            
            // Get fields and their DESIGN order
            const fieldsResult = await pool.query(`
                SELECT DISTINCT label, data_type, MIN(field_order) as min_order
                FROM form_fields 
                WHERE form_version_id IN (
                    SELECT id FROM form_versions 
                    WHERE form_id = ANY($1)
                )
                GROUP BY label, data_type
                ORDER BY min_order ASC
            `, [formIds]);
            
            canonicalFieldOrder = fieldsResult.rows.map(f => f.label);

            schemaContext = {
                formNames: selectedForms.map(f => f.name),
                fields: fieldsResult.rows
            };
        }

        let sql = await generateSql(prompt, schemaContext);
        if (!sql) return res.status(500).json({ error: 'Failed to generate SQL' });
        
        const formIds = selectedForms ? selectedForms.map(f => f.id) : [];
        sql = enforceIsolation(sql, req.user.id, req.user.role, formIds);
        
        const result = await pool.query(sql);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No data to export' });
        }

        // 2. Prepare Headers & Layout
        console.log('📡 [PDF EXPORT] Headers Discovery...');
        const dataKeyName = Object.keys(result.rows[0]).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
        const fixedHeaders = Object.keys(result.rows[0]).filter(k => 
            !['data_json', 'data', 'Data'].includes(k)
        );
        
        // Dynamic headers sorted by canonical design order
        let dynamicHeaders = selectedFields || [];
        if (canonicalFieldOrder.length > 0) {
            dynamicHeaders.sort((a, b) => {
                const idxA = canonicalFieldOrder.indexOf(a);
                const idxB = canonicalFieldOrder.indexOf(b);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return a.localeCompare(b);
            });
        }
        
        const allHeaders = [...fixedHeaders, ...dynamicHeaders];

        // Layout Metrics (Nuclear scaling)
        const columnCount = allHeaders.length + 1; // +1 for S.No
        console.log(`📡 [PDF EXPORT] Columns: ${columnCount}, Headers:`, allHeaders);

        // Sort rows by Group By if specified
        let rows = [...result.rows];
        if (groupBy) {
            console.log(`📡 [PDF EXPORT] Sorting by Group: ${groupBy}`);
            rows.sort((a, b) => {
                const dataA = dataKeyName ? a[dataKeyName] : (a.Data || {});
                const dataB = dataKeyName ? b[dataKeyName] : (b.Data || {});
                
                const valA = (dataA[groupBy] || a[groupBy] || '').toString();
                const valB = (dataB[groupBy] || b[groupBy] || '').toString();
                
                // Primary: Group Field (Asc)
                const groupCompare = valA.localeCompare(valB);
                if (groupCompare !== 0) return groupCompare;

                // Secondary: CGPA (Desc) if it's the specialized group
                if (specialMode === 'branch_cgpa') {
                    const cgpaField = allHeaders.find(h => h.toLowerCase() === 'cgpa' || h.toLowerCase().includes('cgpa'));
                    if (cgpaField) {
                        const getCgpa = (d, r) => parseFloat((d[cgpaField] || r[cgpaField] || '0').toString().match(/[0-9.]+/)?.[0] || '0');
                        return getCgpa(dataB, b) - getCgpa(dataA, a);
                    }
                }
                return 0;
            });
        }

        let fontSize = 9;
        let headerFontSize = 10;
        let cellPadding = [3, 5, 3, 5];
        let margins = [40, 40, 40, 40];

        if (columnCount >= 12) {
            fontSize = 5.5;
            headerFontSize = 6.5;
            cellPadding = [1, 2, 1, 2];
            margins = [10, 25, 10, 25];
        } else if (columnCount >= 9) {
            fontSize = 7.5;
            headerFontSize = 8.5;
            cellPadding = [2, 3, 2, 3];
            margins = [20, 35, 20, 35];
        }

        const docDefinition = {
            pageOrientation: 'landscape',
            pageSize: 'A4',
            pageMargins: margins,
            defaultStyle: { 
                font: 'Helvetica', 
                fontSize: fontSize, 
                lineHeight: 1.0 
            },
            header: (currentPage, pageCount) => {
                return {
                    text: `AI Explorer Export | Page ${currentPage} of ${pageCount}`,
                    alignment: 'right',
                    margin: [0, 10, 10, 0],
                    fontSize: 6,
                    color: '#999'
                };
            },
            content: [
                { text: 'AI Explorer Results', style: 'title' },
                { text: `Prompt: ${prompt}`, fontSize: 8, margin: [0, 0, 0, 10], color: '#666' }
            ],
            styles: {
                title: { fontSize: 14, bold: true, margin: [0, 0, 0, 10] },
                tableHeader: { 
                    bold: true, 
                    fontSize: headerFontSize, 
                    color: 'white', 
                    fillColor: '#2c3e50', 
                    alignment: 'center' 
                },
                tableCell: { margin: cellPadding },
                groupHeader: { fontSize: 10, bold: true, margin: [0, 8, 0, 4], color: '#2c3e50' }
            }
        };

        const tableHeaders = [
            { text: 'S.No', style: 'tableHeader' },
            ...allHeaders.map(h => ({ text: h, style: 'tableHeader' }))
        ];

        const widths = ['auto', ...allHeaders.map(() => '*')];

        let currentGroup = null;
        let currentTableData = [];

        const finalizeTable = (groupVal) => {
            if (currentTableData.length > 0) {
                if (groupVal) {
                    docDefinition.content.push({ 
                        text: `${groupBy.toUpperCase()}: ${groupVal}`, 
                        style: 'groupHeader', 
                        pageBreak: docDefinition.content.length > 2 ? 'before' : undefined 
                    });
                }
                docDefinition.content.push({
                    table: {
                        headerRows: 1,
                        widths: widths,
                        body: [tableHeaders, ...currentTableData]
                    },
                    layout: {
                        fillColor: (rowIndex) => (rowIndex % 2 === 0 && rowIndex !== 0) ? '#fbfbfb' : null,
                        hLineWidth: () => 0.2,
                        vLineWidth: () => 0.2,
                        hLineColor: () => '#eee',
                        vLineColor: () => '#eee'
                    }
                });
                currentTableData = [];
            }
        };

        let sno = 1;
        rows.forEach(row => {
            const rowData = dataKeyName ? row[dataKeyName] : (row.Data || {});
            const groupVal = groupBy ? (rowData[groupBy] || row[groupBy] || 'Not Specified') : null;

            if (groupBy && groupVal !== currentGroup) {
                finalizeTable(currentGroup);
                currentGroup = groupVal;
                sno = 1;
            }

            const tableRow = [
                { text: sno++, style: 'tableCell', alignment: 'center' },
                ...fixedHeaders.map(h => {
                    let val = row[h] || '';
                    if (typeof val === 'string') val = val.replace(/ \|\|\| /g, ', ');
                    return { text: val, style: 'tableCell' };
                }),
                ...dynamicHeaders.map(h => {
                    let val = rowData[h] || '';
                    if (typeof val === 'string') val = val.replace(/ \|\|\| /g, ', ');
                    return { text: val, style: 'tableCell' };
                })
            ];
            currentTableData.push(tableRow);
        });

        finalizeTable(currentGroup);

        const pdfStream = await pdfmake.createPdf(docDefinition).getStream();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="ai_explorer_export.pdf"`);
        pdfStream.pipe(res);
        pdfStream.end();

    } catch (err) {
        console.error('❌ Explorer PDF Error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'PDF Export failed', details: err.message });
        }
    }
});

/**
 * @route POST /api/explorer/discovery
 * @desc  Get fields and sample values for specific forms to aid prompt engineering
 * @access Private
 */
router.post('/discovery', authenticate, async (req, res) => {
    try {
        const { formIds } = req.body;
        if (!formIds || !Array.isArray(formIds) || formIds.length === 0) {
            return res.status(400).json({ error: 'formIds array is required' });
        }

        // 1. Get unique fields and their types across all selected forms
        const fieldsResult = await pool.query(`
            SELECT DISTINCT label, data_type 
            FROM form_fields 
            WHERE form_version_id IN (
                SELECT id FROM form_versions 
                WHERE form_id = ANY($1)
            )
            ORDER BY label ASC
        `, [formIds]);

        const fieldsWithSamples = [];

        // 2. For each field, fetch top 3 sample values from submissions
        for (const field of fieldsResult.rows) {
            const label = field.label;
            const samplesRes = await pool.query(`
                SELECT DISTINCT data_json->>$1 as val
                FROM submissions
                WHERE form_version_id IN (
                    SELECT id FROM form_versions WHERE form_id = ANY($2)
                )
                AND deleted_at IS NULL
                AND data_json->>$1 IS NOT NULL
                AND data_json->>$1 != ''
                LIMIT 3
            `, [label, formIds]);

            fieldsWithSamples.push({
                label: label,
                type: field.data_type,
                samples: samplesRes.rows.map(r => r.val)
            });
        }

        res.json({ fields: fieldsWithSamples });
    } catch (err) {
        console.error('❌ Discovery Error:', err);
        res.status(500).json({ error: 'Discovery failed' });
    }
});

/**
 * @route POST /api/explorer/suggestions
 * @desc  Get flattened suggestions (fields + samples) for autocomplete
 * @access Private
 */
router.post('/suggestions', authenticate, async (req, res) => {
    try {
        const { formIds } = req.body;
        if (!formIds || !Array.isArray(formIds) || formIds.length === 0) {
            return res.json({ suggestions: [] });
        }

        // 1. Get unique fields
        const fieldsResult = await pool.query(`
            SELECT DISTINCT label 
            FROM form_fields 
            WHERE form_version_id IN (
                SELECT id FROM form_versions WHERE form_id = ANY($1)
            )
        `, [formIds]);

        let allSuggestions = [];

        // 2. Add fields to suggestions
        fieldsResult.rows.forEach(f => {
            allSuggestions.push({ type: 'field', value: f.label });
        });

        // 3. Add top sample values for each field
        for (const field of fieldsResult.rows) {
            const samplesRes = await pool.query(`
                SELECT DISTINCT data_json->>$1 as val
                FROM submissions
                WHERE form_version_id IN (
                    SELECT id FROM form_versions WHERE form_id = ANY($2)
                )
                AND deleted_at IS NULL
                AND data_json->>$1 IS NOT NULL
                AND data_json->>$1 != ''
                LIMIT 5
            `, [field.label, formIds]);

            samplesRes.rows.forEach(s => {
                allSuggestions.push({ type: 'value', value: s.val, field: field.label });
            });
        }

        res.json({ suggestions: allSuggestions });
    } catch (err) {
        console.error('❌ Suggestions Error:', err);
        res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
});

module.exports = router;
