const express = require('express');
const ExcelJS = require('exceljs');
const pdfmake = require('pdfmake');
const pool = require('../db/pool');
const { authenticate, checkFormAccess } = require('../middleware/auth');

const router = express.Router();

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

// GET /api/export/:id (Existing Excel Export)
router.get('/:id', authenticate, async (req, res) => {
    console.log(`[EXPORT] Started for form ID: ${req.params.id} by ${req.user.username}`);
    try {
        const formId = req.params.id;
    const { 
        search = '', 
        sortMode = 'date_desc', 
        includeRemarks = 'false',
        includeAt = 'false', 
        includeBy = 'false',
        selectedFields: selectedFieldsQuery
    } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    const access = await checkFormAccess(formId, userId, userRole);
    if (!access.exists) return res.status(404).json({ error: 'Form not found' });
    if (!access.hasAccess) return res.status(403).json({ error: 'Access denied' });

    // 1. Get Fields for Headers and Sorting

        // Parse selectedFields if provided
        let selectedFieldLabels = null;
        if (selectedFieldsQuery) {
            selectedFieldLabels = Array.isArray(selectedFieldsQuery) ? selectedFieldsQuery : selectedFieldsQuery.split(',');
        }

        const fieldsResult = await pool.query(
            `SELECT label, type FROM form_fields 
             WHERE form_version_id = (
                SELECT id FROM form_versions WHERE form_id = $1 ORDER BY version_number DESC LIMIT 1
             ) 
             ORDER BY field_order`,
            [formId]
        );
        const allFields = fieldsResult.rows;
        
        // Filter fields if selection is provided
        const fields = selectedFieldLabels 
            ? allFields.filter(f => selectedFieldLabels.includes(f.label))
            : allFields;

        const dynamicHeaders = fields.map(f => f.label);
        if (includeRemarks === 'true') {
            dynamicHeaders.push('Missing Entries:');
        }

        const cgpaField = allFields.find(f => f.type === 'cgpa_converter');
        const branchField = allFields.find(f => f.type === 'branch');

        // 2. Setup Streaming Excel
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="export_${formId}.xlsx"`);

        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
            stream: res,
            useStyles: true,
            useSharedStrings: true
        });

        const worksheet = workbook.addWorksheet('Submissions', {
            views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
        });

        const columns = [
            { header: 'S.No', key: 'sno', width: 8 }
        ];

        if (includeAt === 'true') {
            columns.push({ header: 'Submitted At', key: 'submitted_at', width: 22 });
        }
        if (includeBy === 'true') {
            columns.push({ header: 'Submitted By', key: 'submitted_by', width: 20 });
        }

        // Add dynamic headers
        dynamicHeaders.forEach(label => {
            columns.push({ header: label, key: label, width: 25 });
        });

        worksheet.columns = columns;

        // 3. Fetch and Stream Rows in Batches
        let offset = 0;
        const limit = 2000;
        let hasMore = true;
        let sno = 1;

        while (hasMore) {
            let searchQuery = `
                SELECT s.id, s.submitted_at, u.username as submitted_by, s.data_json
                FROM submissions s
                JOIN form_versions fv ON s.form_version_id = fv.id
                LEFT JOIN users u ON s.user_id = u.id
                WHERE fv.form_id = $1 AND s.deleted_at IS NULL
            `;
            const params = [formId];

            if (search && search.trim() !== '') {
                searchQuery += ` AND s.data_json::text ILIKE $2`; 
                params.push(`%${search.trim()}%`);
            }

            // Dynamic Sorting logic for Export
            let orderBy = 'ORDER BY s.submitted_at DESC'; // Default
            if (sortMode === 'cgpa_desc' && cgpaField) {
                orderBy = `ORDER BY (NULLIF(substring(s.data_json->>'${cgpaField.label}' from '^[0-9.]+'), '')::numeric) DESC NULLS LAST`;
            } else if (sortMode === 'branch_alpha' && branchField) {
                orderBy = `ORDER BY (s.data_json->>'${branchField.label}') ASC NULLS LAST`;
            } else if (sortMode === 'branch_cgpa' && branchField && cgpaField) {
                orderBy = `ORDER BY (s.data_json->>'${branchField.label}') ASC NULLS LAST, 
                           (NULLIF(substring(s.data_json->>'${cgpaField.label}' from '^[0-9.]+'), '')::numeric) DESC NULLS LAST`;
            } else if (sortMode === 'branch_cgpa' && branchField) {
                orderBy = `ORDER BY (s.data_json->>'${branchField.label}') ASC NULLS LAST`;
            }

            searchQuery += ` ${orderBy} LIMIT ${limit} OFFSET ${offset}`;

            const subsResult = await pool.query(searchQuery, params);

            if (subsResult.rows.length === 0) {
                hasMore = false;
                break;
            }

            subsResult.rows.forEach(sub => {
                const rowData = {
                    sno: sno++
                };

                if (includeAt === 'true') {
                    rowData.submitted_at = new Date(sub.submitted_at).toLocaleString();
                }
                if (includeBy === 'true') {
                    rowData.submitted_by = sub.submitted_by || 'Anonymous';
                }

                // Fill dynamic data from data_json
                if (sub.data_json) {
                    Object.keys(sub.data_json).forEach(label => {
                        let val = sub.data_json[label] || '';
                        if (typeof val === 'string') {
                            val = val.replace(/ \|\|\| /g, ', ');
                            // Convert relative upload paths to absolute URLs for LAN access
                            if (val.startsWith('/uploads/')) {
                                const host = req.get('host');
                                const protocol = req.protocol;
                                const baseUrl = process.env.FRONTEND_URL || `${protocol}://${host}`;

                                if (val.startsWith('/uploads/batch_')) {
                                    val = `${baseUrl}/shared/files?path=${encodeURIComponent(val)}`;
                                } else {
                                    val = `${protocol}://${host}${val}`;
                                }
                            }
                        }

                        // Map 'Remarks' key to 'Missing Entries:' header if requested
                        if (label === 'Remarks' && includeRemarks === 'true') {
                            rowData['Missing Entries:'] = val;
                        } else {
                            rowData[label] = val;
                        }
                    });
                }

                const row = worksheet.addRow(rowData);

                // Apply Wrapping and Vertical Alignment to every cell in the row
                row.eachCell((cell) => {
                    cell.alignment = { 
                        wrapText: true, 
                        vertical: 'top', 
                        horizontal: 'left' 
                    };
                });

                row.commit();
            });
            offset += limit;
            if (subsResult.rows.length < limit) hasMore = false;
        }

        await worksheet.commit();
        await workbook.commit();

        // Log the export action
        await pool.query(
            'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
            ['export', userId, JSON.stringify({
                format: 'excel',
                form_id: formId,
                form_name: (await pool.query('SELECT name FROM forms WHERE id = $1', [formId])).rows[0].name,
                options: { includeRemarks, includeAt, includeBy },
                search_term: search,
                sort_mode: sortMode
            })]
        );

        res.end();
    } catch (err) {
        console.error('Export error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Export failed internally' });
        }
    }
});

// POST /api/export/pdf/:id
router.post('/pdf/:id', authenticate, async (req, res) => {
    try {
        const formId = req.params.id;
        const { 
            selectedFields = [], 
            groupBy = null, 
            sortMode = 'date_desc', 
            searchTerm = '' 
        } = req.body;
        
        const userId = req.user.id;
        const userRole = req.user.role;

        const access = await checkFormAccess(formId, userId, userRole);
        if (!access.exists) return res.status(404).json({ error: 'Form not found' });
        if (!access.hasAccess) return res.status(403).json({ error: 'Access denied' });

        // 1. Get Form Details and Fields
        const formResult = await pool.query('SELECT name FROM forms WHERE id = $1', [formId]);
        const formName = formResult.rows[0].name;

        const fieldsResult = await pool.query(
            `SELECT label, type FROM form_fields 
             WHERE form_version_id = (
                SELECT id FROM form_versions WHERE form_id = $1 ORDER BY version_number DESC LIMIT 1
             ) 
             ORDER BY field_order`,
            [formId]
        );
        const allFields = fieldsResult.rows;
        const cgpaField = allFields.find(f => f.type === 'cgpa_converter');
        const branchField = allFields.find(f => f.type === 'branch');

        // 2. Build Query
        let query = `
            SELECT s.submitted_at, s.data_json
            FROM submissions s
            JOIN form_versions fv ON s.form_version_id = fv.id
            WHERE fv.form_id = $1 AND s.deleted_at IS NULL
        `;
        const params = [formId];

        if (searchTerm && searchTerm.trim() !== '') {
            query += ` AND s.data_json::text ILIKE $2`;
            params.push(`%${searchTerm.trim()}%`);
        }

        // Apply Sorting & Grouping
        let orderBy = '';
        const groupFieldLabel = groupBy; // Assuming groupBy is the label string

        if (groupFieldLabel) {
            orderBy = `ORDER BY (s.data_json->>'${groupFieldLabel}') ASC NULLS LAST`;
            if ((sortMode === 'cgpa_desc' || sortMode === 'branch_cgpa') && cgpaField) {
                orderBy += `, (NULLIF(substring(s.data_json->>'${cgpaField.label}' from '^[0-9.]+'), '')::numeric) DESC NULLS LAST`;
            } else {
                orderBy += `, s.submitted_at DESC`;
            }
        } else {
            if (sortMode === 'cgpa_desc' && cgpaField) {
                orderBy = `ORDER BY (NULLIF(substring(s.data_json->>'${cgpaField.label}' from '^[0-9.]+'), '')::numeric) DESC NULLS LAST`;
            } else if (sortMode === 'branch_alpha' && branchField) {
                orderBy = `ORDER BY (s.data_json->>'${branchField.label}') ASC NULLS LAST`;
            } else if (sortMode === 'branch_cgpa' && branchField && cgpaField) {
                orderBy = `ORDER BY (s.data_json->>'${branchField.label}') ASC NULLS LAST, 
                           (NULLIF(substring(s.data_json->>'${cgpaField.label}' from '^[0-9.]+'), '')::numeric) DESC NULLS LAST`;
            } else {
                orderBy = `ORDER BY s.submitted_at DESC`;
            }
        }

        query += ` ${orderBy}`;
        const subsResult = await pool.query(query, params);
        const submissions = subsResult.rows;

        // 3. Calculate Layout Metrics (Nuclear Auto-Scaling)
        const columnCount = selectedFields.length + 1; // +1 for S.No
        let fontSize = 9;
        let headerFontSize = 10;
        let cellPadding = [3, 5, 3, 5];
        let margins = [40, 40, 40, 40];

        if (columnCount >= 12) {
            fontSize = 5.5; // Nuclear scale
            headerFontSize = 6.5;
            cellPadding = [1, 2, 1, 2];
            margins = [10, 25, 10, 25]; // Absolute minimum margins
        } else if (columnCount >= 9) {
            fontSize = 7.5;
            headerFontSize = 8.5;
            cellPadding = [2, 3, 2, 3];
            margins = [20, 35, 20, 35];
        }

        // 4. Prepare PDF Document Definition
        const docDefinition = {
            pageOrientation: 'landscape',
            pageSize: 'A4',
            pageMargins: margins,
            defaultStyle: { 
                font: 'Helvetica', 
                fontSize: fontSize, 
                lineHeight: 1.0,
                columnGap: 2
            },
            header: (currentPage, pageCount) => {
                return {
                    text: `${formName} | Page ${currentPage} of ${pageCount}`,
                    alignment: 'right',
                    margin: [0, 10, 10, 0],
                    fontSize: 6,
                    color: '#999'
                };
            },
            content: [],
            styles: {
                title: { fontSize: 14, bold: true, margin: [0, 0, 0, 5] },
                groupHeader: { fontSize: 10, bold: true, margin: [0, 8, 0, 4], color: '#2c3e50' },
                tableHeader: { 
                    bold: true, 
                    fontSize: headerFontSize, 
                    color: 'white', 
                    fillColor: '#2c3e50', 
                    alignment: 'center' 
                },
                tableCell: { 
                    margin: cellPadding,
                    // Force word breaking for extremely tight layouts
                    ...(columnCount >= 12 ? { noWrap: false } : {})
                }
            }
        };

        // 5. Generate Content (Grouping Logic)
        let currentGroup = null;
        let currentTableData = [];

        const tableHeaders = [
            { text: 'S.No', style: 'tableHeader' },
            ...selectedFields.map(f => ({ text: f, style: 'tableHeader' }))
        ];

        // Column Widths logic: When tight, everything except S.No is '*'
        const widths = ['auto'];
        selectedFields.forEach(() => {
            widths.push('*'); // Distribute space equally among all data fields
        });

        const finalizeTable = (groupVal) => {
            if (currentTableData.length > 0) {
                if (groupVal) {
                    docDefinition.content.push({ 
                        text: `${groupFieldLabel.toUpperCase()}: ${groupVal}`, 
                        style: 'groupHeader', 
                        pageBreak: docDefinition.content.length > 0 ? 'before' : undefined 
                    });
                } else if (docDefinition.content.length === 0) {
                    docDefinition.content.push({ text: formName, style: 'title' });
                }

                docDefinition.content.push({
                    table: {
                        headerRows: 1,
                        widths: widths,
                        // Ensure the table takes exactly 100% of available width
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
        submissions.forEach((sub, idx) => {
            const groupVal = groupFieldLabel ? (sub.data_json[groupFieldLabel] || 'Not Specified') : null;

            if (groupFieldLabel && groupVal !== currentGroup) {
                finalizeTable(currentGroup);
                currentGroup = groupVal;
                sno = 1; // Reset S.No for new group/page
            }

            const row = [
                { text: sno++, style: 'tableCell', alignment: 'center' },
                ...selectedFields.map(label => {
                    let val = sub.data_json[label] || '';
                    if (typeof val === 'string') val = val.replace(/ \|\|\| /g, ', ');
                    return { text: val, style: 'tableCell' };
                })
            ];
            currentTableData.push(row);
        });

        finalizeTable(currentGroup);

        // 5. Generate and Stream PDF
        const pdfStream = await pdfmake.createPdf(docDefinition).getStream();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="export_${formId}.pdf"`);
        pdfStream.pipe(res);

        // Log the export action
        await pool.query(
            'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
            ['export', userId, JSON.stringify({
                format: 'pdf',
                form_id: formId,
                form_name: formName,
                selected_fields: selectedFields,
                group_by: groupBy,
                sort_mode: sortMode,
                search_term: searchTerm
            })]
        );

        pdfStream.end();

    } catch (err) {
        console.error('PDF Export error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'PDF Export failed' });
        }
    }
});

module.exports = router;
