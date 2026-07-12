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
                // Optimized GIN search using JSON Path
                searchQuery += ` AND s.data_json @? '$.* ? (@.type() == "string" && @ like_regex $2 flag "i")'`; 
                params.push(search.trim());
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

        // 2. Fetch and Process Rows in Batches for PDF
        let offset = 0;
        const limit = 2000;
        let hasMore = true;
        let sno = 1;
        let currentGroup = null;
        let currentTableData = [];
        
        const groupFieldLabel = groupBy;
        const tableHeaders = [
            { text: 'S.No', style: 'tableHeader' },
            ...selectedFields.map(f => ({ text: f, style: 'tableHeader' }))
        ];
        const widths = ['auto', ...selectedFields.map(() => '*')];

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

        while (hasMore) {
            let query = `
                SELECT s.submitted_at, s.data_json
                FROM submissions s
                JOIN form_versions fv ON s.form_version_id = fv.id
                WHERE fv.form_id = $1 AND s.deleted_at IS NULL
            `;
            const params = [formId];

            if (searchTerm && searchTerm.trim() !== '') {
                // Optimized GIN search using JSON Path
                query += ` AND s.data_json @? '$.* ? (@.type() == "string" && @ like_regex $2 flag "i")'`; 
                params.push(searchTerm.trim());
            }

            // Apply Sorting & Grouping
            let orderBy = '';
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

            query += ` ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
            const subsResult = await pool.query(query, params);

            if (subsResult.rows.length === 0) {
                hasMore = false;
                break;
            }

            subsResult.rows.forEach((sub) => {
                const groupVal = groupFieldLabel ? (sub.data_json[groupFieldLabel] || 'Not Specified') : null;

                if (groupFieldLabel && groupVal !== currentGroup) {
                    finalizeTable(currentGroup);
                    currentGroup = groupVal;
                    sno = 1;
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

            offset += limit;
            if (subsResult.rows.length < limit) hasMore = false;
        }

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

// Helper for parsing date strings to month groupings (dd-mm-yyyy and fallback formats)
function parseDateStringToMonthGroup(dateVal) {
    if (!dateVal) return 'Unknown Month';
    dateVal = String(dateVal).trim();
    if (dateVal === '') return 'Unknown Month';

    const monthsNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    // 1. Check for 4-digit Year (e.g. 2026)
    if (/^\d{4}$/.test(dateVal)) {
        const yearNum = parseInt(dateVal, 10);
        if (yearNum >= 1900 && yearNum <= 2100) {
            return `Year ${yearNum}`;
        }
    }

    // 2. Check for dd-mm-yyyy or dd/mm/yyyy (resilient to day count and month count)
    const dmyMatch = dateVal.match(/^(\d{1,10})[-/](\d{1,10})[-/](\d{4})$/);
    if (dmyMatch) {
        const p1 = parseInt(dmyMatch[1], 10);
        const p2 = parseInt(dmyMatch[2], 10);
        const year = parseInt(dmyMatch[3], 10);

        let month = p2; // default: second is month (dd-mm-yyyy)
        // If second number is > 12 and first is <= 12, it is mm-dd-yyyy
        if (p2 > 12 && p1 <= 12) {
            month = p1;
        }

        if (year >= 1900 && year <= 2100) {
            // Apply modulo 12 to resolve month counts beyond 12 (Gregorian mapping)
            const monthIdx = ((month - 1) % 12 + 12) % 12;
            return `${monthsNames[monthIdx]} ${year}`;
        }
    }

    // 3. Check for yyyy-mm-dd or yyyy/mm/dd
    const ymdMatch = dateVal.match(/^(\d{4})[-/](\d{1,10})[-/](\d{1,10})$/);
    if (ymdMatch) {
        const year = parseInt(ymdMatch[1], 10);
        const month = parseInt(ymdMatch[2], 10);
        if (year >= 1900 && year <= 2100) {
            const monthIdx = ((month - 1) % 12 + 12) % 12;
            return `${monthsNames[monthIdx]} ${year}`;
        }
    }

    // 4. Try Unix timestamp
    const isTimestamp = /^\d{10,13}$/.test(dateVal);
    if (isTimestamp) {
        const timestampNum = parseInt(dateVal, 10);
        const dateObj = new Date(timestampNum < 10000000000 ? timestampNum * 1000 : timestampNum);
        if (!isNaN(dateObj.getTime())) {
            return `${monthsNames[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
        }
    }

    // Fallback: standard Date parsing
    const dateObj = new Date(dateVal);
    if (dateObj && !isNaN(dateObj.getTime())) {
        return `${monthsNames[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
    }

    return 'Unknown Month';
}

// Helper for dynamic frequency tabulation (Mitigations 1, 2, 3, 4)
async function computeFrequencyData(formId, tabulateField, dateField, monthsFilter = null) {
    // 1. Fetch form version fields to get predefined options for tabulateField (Mitigation 4)
    const fieldsResult = await pool.query(
        `SELECT label, type, options_json FROM form_fields 
         WHERE form_version_id = (
            SELECT id FROM form_versions WHERE form_id = $1 ORDER BY version_number DESC LIMIT 1
         ) AND label = $2`,
        [formId, tabulateField]
    );

    let predefinedOptions = [];
    if (fieldsResult.rows.length > 0) {
        const field = fieldsResult.rows[0];
        if (field.options_json && Array.isArray(field.options_json)) {
            predefinedOptions = field.options_json.map(opt => typeof opt === 'object' ? opt.value || opt.label || '' : String(opt));
        }
    }

    // 2. Fetch only key-specific columns from PG to avoid OOM (Mitigation 1)
    const submissionsResult = await pool.query(
        `SELECT s.data_json->>$2 AS val, s.data_json->>$3 AS dt
         FROM submissions s
         JOIN form_versions fv ON s.form_version_id = fv.id
         WHERE fv.form_id = $1 AND s.deleted_at IS NULL`,
        [formId, tabulateField, dateField]
    );

    // 3. Process each submission
    const rawData = [];
    const uniqueOptionsSet = new Set(predefinedOptions.filter(o => o !== ''));
    
    const optionTotalCounts = {};
    predefinedOptions.forEach(opt => {
        optionTotalCounts[opt] = 0;
    });

    submissionsResult.rows.forEach(row => {
        let optionVal = (row.val !== undefined && row.val !== null) ? String(row.val).trim() : '';
        if (optionVal === '') optionVal = '(Blank)'; // Mitigation 4: handle blank entries

        let dateVal = (row.dt !== undefined && row.dt !== null) ? String(row.dt).trim() : '';
        const monthGroup = parseDateStringToMonthGroup(dateVal);

        rawData.push({ optionVal, monthGroup });
        uniqueOptionsSet.add(optionVal);
        optionTotalCounts[optionVal] = (optionTotalCounts[optionVal] || 0) + 1;
    });

    // 4. Mitigation 3: Column Explosion Capping
    let uniqueOptions = Array.from(uniqueOptionsSet);
    let isCapped = false;
    let keepOptions = new Set();

    if (uniqueOptions.length > 15) {
        isCapped = true;
        const sortedOptions = uniqueOptions
            .map(opt => ({ opt, count: optionTotalCounts[opt] || 0 }))
            .sort((a, b) => b.count - a.count);
        
        for (let i = 0; i < 14; i++) {
            if (sortedOptions[i]) keepOptions.add(sortedOptions[i].opt);
        }
    }

    // Build the grid
    const monthGroups = {};
    const finalOptionsSet = new Set();

    rawData.forEach(item => {
        let opt = item.optionVal;
        if (isCapped && !keepOptions.has(opt)) {
            opt = 'Others';
        }
        finalOptionsSet.add(opt);

        if (!monthGroups[item.monthGroup]) {
            monthGroups[item.monthGroup] = {};
        }
        monthGroups[item.monthGroup][opt] = (monthGroups[item.monthGroup][opt] || 0) + 1;
    });

    const orderedOptions = [];
    predefinedOptions.forEach(opt => {
        const finalOpt = (isCapped && !keepOptions.has(opt)) ? 'Others' : opt;
        if (finalOptionsSet.has(finalOpt) && !orderedOptions.includes(finalOpt)) {
            orderedOptions.push(finalOpt);
        }
    });

    finalOptionsSet.forEach(opt => {
        if (!orderedOptions.includes(opt) && opt !== 'Others') {
            orderedOptions.push(opt);
        }
    });

    if (finalOptionsSet.has('Others')) {
        orderedOptions.push('Others');
    }

    const columns = ['Month', ...orderedOptions];

    let allMonths = Object.keys(monthGroups);

    // If no submissions exist, create a default current month row with 0 values (User request)
    if (allMonths.length === 0) {
        const monthsNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        const now = new Date();
        const defaultMonthGroup = `${monthsNames[now.getMonth()]} ${now.getFullYear()}`;
        allMonths = [defaultMonthGroup];
        monthGroups[defaultMonthGroup] = {};
    }

    // Sort months chronologically by Gregorian calendar
    const monthOrderVal = (mStr) => {
        if (mStr.startsWith('Year ')) {
            return parseInt(mStr.split(' ')[1], 10) * 12;
        }
        if (mStr === 'Unknown Month') return 0;
        const [monthName, yearStr] = mStr.split(' ');
        const year = parseInt(yearStr, 10) || 0;
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const monthIdx = months.indexOf(monthName);
        return year * 12 + (monthIdx !== -1 ? monthIdx : 0);
    };

    allMonths.sort((a, b) => monthOrderVal(a) - monthOrderVal(b));

    const rows = [];
    allMonths.forEach(mGroup => {
        if (monthsFilter && Array.isArray(monthsFilter) && monthsFilter.length > 0) {
            if (!monthsFilter.includes(mGroup)) return;
        }

        const row = { Month: mGroup };
        orderedOptions.forEach(opt => {
            row[opt] = monthGroups[mGroup][opt] || 0;
        });
        rows.push(row);
    });

    return {
        columns,
        rows,
        availableMonths: allMonths,
        isCapped
    };
}

/**
 * @route GET /api/export/frequency-report/preview
 * @desc Get aggregated preview of dynamic frequency tabulation
 * @access Authenticated
 */
router.get('/frequency-report/preview', authenticate, async (req, res) => {
    try {
        const { formId, tabulateField, dateField, months } = req.query;
        if (!formId || !tabulateField || !dateField) {
            return res.status(400).json({ error: 'formId, tabulateField, and dateField are required' });
        }

        const parsedFormId = parseInt(formId, 10);
        const access = await checkFormAccess(parsedFormId, req.user.id, req.user.role);
        if (!access.exists) return res.status(404).json({ error: 'Form not found' });
        if (!access.hasAccess) return res.status(403).json({ error: 'Access denied' });

        const selectedMonths = months ? months.split(',') : null;
        const result = await computeFrequencyData(parsedFormId, tabulateField, dateField, selectedMonths);

        res.json(result);
    } catch (err) {
        console.error('Preview frequency report error:', err);
        res.status(500).json({ error: 'Failed to generate preview' });
    }
});

/**
 * @route POST /api/export/frequency-report/export
 * @desc Export dynamic frequency tabulation to Excel, PDF, CSV, or HTML
 * @access Authenticated
 */
router.post('/frequency-report/export', authenticate, async (req, res) => {
    try {
        const { formId, tabulateField, dateField, months, format } = req.body;
        if (!formId || !tabulateField || !dateField || !format) {
            return res.status(400).json({ error: 'formId, tabulateField, dateField, and format are required' });
        }

        const parsedFormId = parseInt(formId, 10);
        const access = await checkFormAccess(parsedFormId, req.user.id, req.user.role);
        if (!access.exists) return res.status(404).json({ error: 'Form not found' });
        if (!access.hasAccess) return res.status(403).json({ error: 'Access denied' });

        // Get Form Name
        const formResult = await pool.query('SELECT name FROM forms WHERE id = $1', [parsedFormId]);
        const formName = formResult.rows.length > 0 ? formResult.rows[0].name : `Form_${parsedFormId}`;

        const result = await computeFrequencyData(parsedFormId, tabulateField, dateField, months);
        const { columns, rows, isCapped } = result;

        // Log the export action
        await pool.query(
            'INSERT INTO system_logs (action_type, user_id, details) VALUES ($1, $2, $3)',
            ['export', req.user.id, JSON.stringify({
                format: format,
                type: 'frequency_report',
                form_id: parsedFormId,
                tabulate_field: tabulateField,
                date_field: dateField
            })]
        );

        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Frequency Analysis');

            // Add Table Headers directly to Row 1 (Raw data only)
            const headerRow = worksheet.addRow(columns);
            headerRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.eachCell(cell => {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FF161B22' } // Dark theme header
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
            worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };

            rows.forEach(row => {
                const rowData = columns.map(col => row[col]);
                const excelRow = worksheet.addRow(rowData);
                excelRow.font = { name: 'Arial', size: 10 };
                
                excelRow.eachCell((cell, colNumber) => {
                    cell.alignment = {
                        vertical: 'middle',
                        horizontal: colNumber === 1 ? 'left' : 'center'
                    };
                    cell.border = {
                        bottom: { style: 'thin', color: { argb: 'FFE1E4E8' } }
                    };
                });
            });

            worksheet.columns.forEach((col, idx) => {
                col.width = idx === 0 ? 22 : 14;
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="frequency_report_${parsedFormId}.xlsx"`);
            await workbook.xlsx.write(res);

        } else if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="frequency_report_${parsedFormId}.csv"`);
            
            const escapeCSV = (val) => {
                if (val === null || val === undefined) return '';
                let str = String(val);
                if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                    str = '"' + str.replace(/"/g, '""') + '"';
                }
                return str;
            };

            let csvContent = columns.map(escapeCSV).join(',') + '\n';
            rows.forEach(row => {
                const rowData = columns.map(col => row[col]);
                csvContent += rowData.map(escapeCSV).join(',') + '\n';
            });

            res.write(csvContent);
            res.end();

        } else if (format === 'html') {
            res.setHeader('Content-Type', 'text/html');
            const rowsHtml = rows.map(row => {
                const cells = columns.map((col, idx) => `
                    <td style="padding: 10px; border-bottom: 1px solid #e1e4e8; text-align: ${idx === 0 ? 'left' : 'center'}; ${idx === 0 ? 'font-weight: bold;' : ''}">
                        ${row[col]}
                    </td>
                `).join('');
                return `<tr>${cells}</tr>`;
            }).join('');

            const headersHtml = columns.map(col => `
                <th style="padding: 12px 10px; background-color: #161b22; color: #ffffff; text-align: center; border: 1px solid #30363d;">
                    ${col}
                </th>
            `).join('');

            const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>${formName} - Frequency Analysis</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        color: #24292e;
                        margin: 40px;
                        background-color: #ffffff;
                    }
                    .header {
                        margin-bottom: 30px;
                        border-bottom: 2px solid #e1e4e8;
                        padding-bottom: 20px;
                    }
                    h1 {
                        font-size: 24px;
                        margin: 0 0 10px 0;
                        color: #d4af37;
                    }
                    .subtitle {
                        font-size: 14px;
                        color: #586069;
                        margin: 0;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }
                    @media print {
                        body {
                            margin: 20px;
                        }
                        button {
                            display: none;
                        }
                    }
                    .btn {
                        padding: 10px 20px;
                        background-color: #d4af37;
                        color: #010409;
                        border: none;
                        font-weight: bold;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-bottom: 20px;
                    }
                    .btn:hover {
                        background-color: #c5a030;
                    }
                </style>
            </head>
            <body>
                <div style="display: flex; justify-content: space-between; align-items: center;" class="header">
                    <div>
                        <h1>${formName} - Frequency Analysis</h1>
                        <p class="subtitle">Grouped by: <strong>${dateField}</strong> | Pivot field: <strong>${tabulateField}</strong></p>
                    </div>
                    <button class="btn" onclick="window.print()">🖨️ Print Report</button>
                </div>
                <table>
                    <thead>
                        <tr>${headersHtml}</tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
                ${isCapped ? `
                    <div style="margin-top: 20px; padding: 10px; border: 1px solid #d4af37; background-color: #fffdef; color: #7a6000; font-size: 12px; border-radius: 4px;">
                        ⚠️ Warning: The number of unique options exceeded the maximum limit of 15. The top 14 options by frequency are displayed as individual columns, and the rest are grouped under "Others".
                    </div>
                ` : ''}
            </body>
            </html>
            `;
            res.send(htmlContent);

        } else if (format === 'pdf') {
            const columnCount = columns.length;
            let fontSize = 9;
            let headerFontSize = 10;
            let cellPadding = [4, 6, 4, 6];
            let margins = [30, 30, 30, 30];

            if (columnCount >= 12) {
                fontSize = 6.5;
                headerFontSize = 7.5;
                cellPadding = [2, 3, 2, 3];
                margins = [15, 20, 15, 20];
            } else if (columnCount >= 8) {
                fontSize = 8;
                headerFontSize = 9;
                cellPadding = [3, 4, 3, 4];
                margins = [20, 25, 20, 25];
            }

            const docDefinition = {
                pageOrientation: 'landscape',
                pageSize: 'A4',
                pageMargins: margins,
                defaultStyle: { 
                    font: 'Helvetica', 
                    fontSize: fontSize, 
                    lineHeight: 1.1
                },
                header: (currentPage, pageCount) => {
                    return {
                        text: `${formName} - Frequency Analysis | Page ${currentPage} of ${pageCount}`,
                        alignment: 'right',
                        margin: [0, 10, 10, 0],
                        fontSize: 7,
                        color: '#999'
                    };
                },
                content: [
                    { text: `${formName} - Frequency Analysis`, style: 'title' },
                    { text: `Report generated on ${new Date().toLocaleDateString()} for field "${tabulateField}" grouped by "${dateField}".`, style: 'subtitle' },
                    { text: ' ', fontSize: 10 }
                ],
                styles: {
                    title: { fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
                    subtitle: { fontSize: 9, italics: true, color: '#555', margin: [0, 0, 0, 10] },
                    tableHeader: { 
                        bold: true, 
                        fontSize: headerFontSize, 
                        color: 'white', 
                        fillColor: '#161b22', 
                        alignment: 'center' 
                    },
                    tableCell: { 
                        margin: cellPadding
                    }
                }
            };

            const tableBody = [];
            const pdfHeaders = columns.map(col => ({ text: col, style: 'tableHeader' }));
            tableBody.push(pdfHeaders);

            rows.forEach(row => {
                const pdfRow = columns.map((col, idx) => {
                    const isMonth = idx === 0;
                    return { 
                        text: String(row[col]), 
                        style: 'tableCell', 
                        alignment: isMonth ? 'left' : 'center',
                        ...(isMonth ? { bold: true } : {})
                    };
                });
                tableBody.push(pdfRow);
            });

            const widths = columns.map((col, idx) => idx === 0 ? 'auto' : '*');

            docDefinition.content.push({
                table: {
                    headerRows: 1,
                    widths: widths,
                    body: tableBody
                },
                layout: {
                    hLineWidth: function (i, node) {
                        return (i === 0 || i === node.table.body.length) ? 1.5 : 0.5;
                    },
                    vLineWidth: function (i, node) {
                        return 0;
                    },
                    hLineColor: function (i, node) {
                        return (i === 0 || i === node.table.body.length) ? '#30363d' : '#e1e4e8';
                    },
                    paddingLeft: function (i, node) { return 6; },
                    paddingRight: function (i, node) { return 6; },
                    paddingTop: function (i, node) { return 4; },
                    paddingBottom: function (i, node) { return 4; }
                }
            });

            if (isCapped) {
                docDefinition.content.push({
                    text: '⚠️ Warning: The number of unique options exceeded the maximum limit of 15. The top 14 options by frequency are displayed as individual columns, and the rest are grouped under "Others".',
                    color: '#d4af37',
                    fontSize: 8,
                    margin: [0, 10, 0, 0]
                });
            }

            const pdfStream = await pdfmake.createPdf(docDefinition).getStream();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="frequency_report_${parsedFormId}.pdf"`);
            pdfStream.pipe(res);
            pdfStream.end();
        } else {
            res.status(400).json({ error: 'Unsupported format requested' });
        }
    } catch (err) {
        console.error('Export frequency report error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to export frequency report' });
        }
    }
});

module.exports = router;

