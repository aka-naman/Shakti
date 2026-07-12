import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function SubmissionsPage() {
    const { formId } = useParams();
    const navigate = useNavigate();
    const tableContainerRef = useRef(null);
    const [fields, setFields] = useState([]);
    const [submissions, setSubmissions] = useState([]);
    const [formName, setFormName] = useState('');
    const [loading, setLoading] = useState(true);
    
    // Pagination & Search State
    const [searchTerm, setSearchTerm] = useState('');
    const [sortMode, setSortMode] = useState('date_desc');
    const [pagination, setPagination] = useState({ total: 0, pages: 1 });
    const [currentPage, setCurrentPage] = useState(1);
    
    // Audit State
    const [auditLog, setAuditLog] = useState(null); // { submissionId, entries: [] }

    // PDF Export Modal State
    const [showPdfModal, setShowPdfModal] = useState(false);
    const [selectedPdfFields, setSelectedPdfFields] = useState([]);
    const [pdfGroupBy, setPdfGroupBy] = useState('');
    const [pdfGenerating, setPdfGenerating] = useState(false);

    // Excel Export Modal State
    const [showExcelModal, setShowExcelModal] = useState(false);
    const [showPickFieldsModal, setShowPickFieldsModal] = useState(false);
    const [excelOptions, setExcelOptions] = useState({
        at: true,
        by: true,
        remarks: false,
        selectedFields: []
    });

    // Frequency Report Modal State (Mitigations 2, 3, 4)
    const [showFrequencyModal, setShowFrequencyModal] = useState(false);
    const [freqTabulateField, setFreqTabulateField] = useState('');
    const [freqDateField, setFreqDateField] = useState('');
    const [freqAvailableMonths, setFreqAvailableMonths] = useState([]);
    const [freqSelectedMonths, setFreqSelectedMonths] = useState([]);
    const [freqPreviewData, setFreqPreviewData] = useState(null);
    const [freqLoading, setFreqLoading] = useState(false);
    const [freqCapped, setFreqCapped] = useState(false);

    // Initialize excel selected fields when fields load
    useEffect(() => {
        if (fields.length > 0 && excelOptions.selectedFields.length === 0) {
            setExcelOptions(prev => ({ ...prev, selectedFields: fields.map(f => f.label) }));
        }
    }, [fields]);

    const hasCgpa = fields.some(f => f.type === 'cgpa_converter');
    const hasBranch = fields.some(f => f.type === 'branch');

    const load = useCallback(async (search = '', sort = 'date_desc', page = 1) => {
        setLoading(true);
        try {
            const res = await api.get(`/forms/${formId}/submissions`, {
                params: { search, sortMode: sort, page, limit: 50 }
            });
            setFields(res.data.fields);
            setSubmissions(res.data.submissions);
            setPagination(res.data.pagination);
            
            // Get form name if not already set
            if (!formName) {
                const formsRes = await api.get('/forms');
                const form = formsRes.data.forms.find(f => f.id === parseInt(formId));
                if (form) setFormName(form.name);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [formId, formName]);

    useEffect(() => {
        const delayDebounce = setTimeout(() => {
            load(searchTerm, sortMode, currentPage);
        }, 500);
        return () => clearTimeout(delayDebounce);
    }, [searchTerm, sortMode, currentPage, load]);

    const handleEditClick = (sub) => {
        navigate(`/forms/${formId}/submissions/${sub.id}/edit`);
    };

    const handleDelete = async (subId) => {
        if (!window.confirm('Delete this entry? It will be removed from this view but kept in the audit trail.')) return;
        try {
            await api.delete(`/forms/${formId}/submissions/${subId}`);
            load(searchTerm, sortMode);
        } catch {
            alert('Delete failed');
        }
    };

    const fetchAudit = async (subId) => {
        try {
            const res = await api.get(`/forms/${formId}/submissions/${subId}/audit`);
            setAuditLog({ submissionId: subId, entries: res.data.audit });
        } catch {
            alert('Failed to fetch audit history');
        }
    };

    const getFieldValue = (submission, fieldId, fieldLabel) => {
        // Fallback to data_json (label-based) if field_id lookup fails
        // This is crucial for version-agnostic display (e.g., duplicated forms)
        if (submission.data_json && submission.data_json[fieldLabel]) {
            return submission.data_json[fieldLabel];
        }
        if (!submission.values) return '';
        const val = submission.values.find(v => v.field_id === fieldId);
        return val ? val.value : '';
    };

    const handleExport = async (includeRemarks = false, includeAt = false, includeBy = false, selectedFields = []) => {
        try {
            // Using params object to ensure proper encoding of search term
            const res = await api.get(`/export/${formId}`, { 
                params: { 
                    search: searchTerm, 
                    sortMode, 
                    includeRemarks,
                    includeAt,
                    includeBy,
                    selectedFields: selectedFields.join(',')
                },
                responseType: 'blob' 
            });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.download = `${formName.replace(/[^a-zA-Z0-9]/g, '_')}_submissions${includeRemarks ? '_with_remarks' : ''}.xlsx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            setShowExcelModal(false); // Close modal if it was open
        } catch {
            alert('Export failed');
        }
    };

    const handlePdfExport = async () => {
        if (selectedPdfFields.length === 0) {
            alert('Please select at least one field to export');
            return;
        }
        setPdfGenerating(true);
        
        // Handle specialized grouping
        let finalGroupBy = pdfGroupBy;
        let finalSortMode = sortMode;
        if (pdfGroupBy === '__branch_cgpa__') {
            const branchField = fields.find(f => f.type === 'branch');
            finalGroupBy = branchField ? branchField.label : null;
            finalSortMode = 'branch_cgpa';
        }

        try {
            const res = await api.post(`/export/pdf/${formId}`, {
                selectedFields: selectedPdfFields,
                groupBy: finalGroupBy || null,
                sortMode: finalSortMode,
                searchTerm
            }, { responseType: 'blob' });

            const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `${formName.replace(/[^a-zA-Z0-9]/g, '_')}_export.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            setShowPdfModal(false);
        } catch (err) {
            console.error(err);
            alert('PDF generation failed');
        } finally {
            setPdfGenerating(false);
        }
    };

    // Auto-select initial fields for Frequency Report (Mitigation 2, 4)
    useEffect(() => {
        if (showFrequencyModal && fields.length > 0) {
            const tabField = fields.find(f => f.type === 'select' || f.type === 'radio' || f.type === 'checkbox') || fields[0];
            if (tabField && !freqTabulateField) {
                setFreqTabulateField(tabField.label);
            }
            const dateFld = fields.find(f => f.type === 'date' || f.type === 'number') || fields.find(f => f.label.toLowerCase().includes('date')) || fields[0];
            if (dateFld && !freqDateField) {
                setFreqDateField(dateFld.label);
            }
        }
    }, [showFrequencyModal, fields, freqTabulateField, freqDateField]);

    const fetchReportMetadata = useCallback(async () => {
        if (!freqTabulateField || !freqDateField) return;
        setFreqLoading(true);
        try {
            const res = await api.get('/export/frequency-report/preview', {
                params: {
                    formId,
                    tabulateField: freqTabulateField,
                    dateField: freqDateField
                }
            });
            setFreqCapped(res.data.isCapped);
            if (res.data.availableMonths) {
                setFreqAvailableMonths(res.data.availableMonths);
                setFreqSelectedMonths(res.data.availableMonths);
            }
        } catch (err) {
            console.error('Failed to load report metadata', err);
        } finally {
            setFreqLoading(false);
        }
    }, [formId, freqTabulateField, freqDateField]);

    useEffect(() => {
        if (showFrequencyModal && freqTabulateField && freqDateField) {
            fetchReportMetadata();
        }
    }, [showFrequencyModal, freqTabulateField, freqDateField]);

    const handleMonthToggle = (month) => {
        if (freqSelectedMonths.includes(month)) {
            setFreqSelectedMonths(freqSelectedMonths.filter(m => m !== month));
        } else {
            setFreqSelectedMonths([...freqSelectedMonths, month]);
        }
    };

    const handleFieldChange = (type, val) => {
        if (type === 'tabulate') {
            setFreqTabulateField(val);
            setFreqAvailableMonths([]);
            setFreqSelectedMonths([]);
        } else if (type === 'date') {
            setFreqDateField(val);
            setFreqAvailableMonths([]);
            setFreqSelectedMonths([]);
        }
    };

    const handleFrequencyExport = async (format) => {
        try {
            const response = await api.post('/export/frequency-report/export', {
                formId: parseInt(formId, 10),
                tabulateField: freqTabulateField,
                dateField: freqDateField,
                months: freqSelectedMonths,
                format
            }, {
                responseType: 'blob'
            });

            const blob = new Blob([response.data], { 
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
            });
            const link = document.createElement('a');
            link.href = window.URL.createObjectURL(blob);
            link.download = `frequency_report_${formName.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error('Export failed', err);
            alert('Export failed');
        }
    };

    return (
        <div className="submissions-page">
            <header className="submissions-header">
                <div className="header-left">
                    <button className="btn btn-ghost" onClick={() => navigate('/')}>← Back</button>
                    <h1>📊 {formName}</h1>
                </div>
                
                <div className="header-center flex-1">
                    <div className="search-container">
                        <input 
                            type="text" 
                            className="search-input" 
                            placeholder="🔍 Server-side search (any value)..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="header-right">
                    <div className="filter-group">
                        <select 
                            className="form-input sort-select" 
                            value={sortMode} 
                            onChange={(e) => setSortMode(e.target.value)}
                            title="Advanced Filter/Sort"
                        >
                            <option value="date_desc">Default (Newest First)</option>
                            {hasCgpa && <option value="cgpa_desc">📊 CGPA View (High to Low)</option>}
                            {hasBranch && <option value="branch_alpha">🎯 Branch Grouping (A-Z)</option>}
                            {hasBranch && hasCgpa && <option value="branch_cgpa">🔄 Branch + CGPA View</option>}
                        </select>
                    </div>
                    <span className="badge badge-count">{pagination.total} entries</span>
                    <select 
                        className="form-input export-select" 
                        onChange={(e) => {
                            if (e.target.value === 'pdf') {
                                setSelectedPdfFields(fields.map(f => f.label));
                                setShowPdfModal(true);
                            } else if (e.target.value === 'excel_custom') {
                                setShowExcelModal(true);
                            } else if (e.target.value === 'pick_fields') {
                                setShowPickFieldsModal(true);
                            } else if (e.target.value === 'standard') {
                                handleExport(false);
                            } else if (e.target.value === 'frequency_report') {
                                setShowFrequencyModal(true);
                            }
                            e.target.value = ''; // Reset select
                        }}
                        defaultValue=""
                    >
                        <option value="" disabled>📥 Export Options</option>
                        <option value="standard">Excel: Standard</option>
                        <option value="excel_custom">⚙️ Excel: Custom...</option>
                        <option value="pick_fields">🎯 Pick Fields to Export</option>
                        <option value="pdf">📄 PDF: Custom Landscape</option>
                        <option value="frequency_report">📊 Frequency Analysis & Export</option>
                    </select>
                </div>
            </header>

            {loading && submissions.length === 0 ? (
                <div className="loading-screen"><div className="spinner"></div></div>
            ) : submissions.length === 0 ? (
                <div className="empty-state glass-card"><h2>No entries found</h2></div>
            ) : (
                <>
                    <div className="table-container glass-card" ref={tableContainerRef}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th className="sticky-col first-col">Actions</th>
                                    <th>ID</th>
                                    <th>Submitted At</th>
                                    <th>Submitted By</th>
                                    {fields.map(f => <th key={f.id}>{f.label}</th>)}
                                    <th>Missing Entries:</th>
                                    <th>Edit Logs</th>
                                </tr>
                            </thead>
                            <tbody>
                                {submissions.map((sub) => (
                                    <tr key={sub.id}>
                                        <td className="sticky-col first-col">
                                            <div className="action-group">
                                                <button className="btn btn-icon btn-sm" onClick={() => handleEditClick(sub)} title="Edit">✏️</button>
                                                <button className="btn btn-icon btn-sm btn-danger-icon" onClick={() => handleDelete(sub.id)} title="Delete">🗑️</button>
                                            </div>
                                        </td>
                                        <td>{sub.id}</td>
                                        <td>{new Date(sub.submitted_at).toLocaleString()}</td>
                                        <td className="font-bold text-accent">{sub.submitted_by_username || 'Anonymous'}</td>
                                        {fields.map(f => {
                                            const val = getFieldValue(sub, f.id, f.label);
                                            const isFolder = val && val.startsWith('/uploads/batch_');
                                            return (
                                                <td key={f.id}>
                                                    {isFolder ? (
                                                        <a 
                                                            href={`/shared/files?path=${encodeURIComponent(val)}`} 
                                                            target="_blank" 
                                                            rel="noreferrer"
                                                            className="btn btn-ghost btn-sm"
                                                        >
                                                            📂 View Files
                                                        </a>
                                                    ) : val}
                                                </td>
                                            );
                                        })}
                                        <td style={{ color: 'var(--accent-warning)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                                            {sub.data_json?.Remarks || '-'}
                                        </td>
                                        <td>
                                            {sub.updated_at ? (
                                                <button className="btn btn-ghost btn-sm" onClick={() => fetchAudit(sub.id)}>
                                                    🕒 History ({sub.updated_by_username})
                                                </button>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Controls */}
                    <div className="pagination-bar glass-card">
                        <div className="pagination-info">
                            Showing <strong>{submissions.length}</strong> of <strong>{pagination.total}</strong> entries
                        </div>
                        <div className="pagination-controls">
                            <button 
                                className="btn btn-ghost btn-sm" 
                                disabled={currentPage === 1 || loading}
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            >
                                ⬅️ Previous
                            </button>
                            <div className="page-numbers">
                                Page <strong>{currentPage}</strong> of <strong>{pagination.pages}</strong>
                            </div>
                            <button 
                                className="btn btn-ghost btn-sm" 
                                disabled={currentPage === pagination.pages || loading}
                                onClick={() => setCurrentPage(prev => Math.min(pagination.pages, prev + 1))}
                            >
                                Next ➡️
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Audit Modal */}
            {auditLog && (
                <div className="modal-overlay" onClick={() => setAuditLog(null)}>
                    <div className="modal glass-card modal-fixed-height audit-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>🕒 History for Response #{auditLog.submissionId}</h2>
                            <p className="modal-subtitle">Showing all previous versions before edits</p>
                        </div>
                        <div className="modal-body scrollable-content">
                            {auditLog.entries.length === 0 ? (
                                <p>No audit entries found.</p>
                            ) : (
                                <div className="audit-timeline">
                                    {auditLog.entries.map((entry, idx) => (
                                        <div key={entry.id} className="audit-entry glass-card">
                                            <div className="audit-entry-header">
                                                <span className="audit-badge">Snapshot #{auditLog.entries.length - idx}</span>
                                                <span className="audit-meta">
                                                    Changed by <strong>{entry.changed_by_username}</strong> on {new Date(entry.changed_at).toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="audit-values">
                                                {fields.map(f => (
                                                    <div key={f.id} className="audit-value-item">
                                                        <span className="audit-label">{f.label}:</span>
                                                        <span className="audit-value">{entry.old_values_json[f.id] || '(empty)'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="modal-actions-sticky">
                            <button className="btn btn-primary" onClick={() => setAuditLog(null)}>Close History</button>
                        </div>
                    </div>
                </div>
            )}

            {/* PDF Export Modal */}
            {showPdfModal && (
                <div className="modal-overlay" onClick={() => setShowPdfModal(false)}>
                    <div className="modal glass-card modal-fixed-height" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>📄 Custom PDF Export (Landscape)</h2>
                            <p className="modal-subtitle">Select fields and grouping for your professional PDF report</p>
                        </div>
                        <div className="modal-body scrollable-content">
                            <div className="form-section">
                                <h3>1. Select Fields to Include</h3>
                                <div className="pdf-field-selector grid grid-cols-2 gap-2">
                                    <label className="flex items-center gap-2 pointer glass-card p-2 hover-bright">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedPdfFields.includes('Remarks')}
                                            onChange={(e) => {
                                                if (e.target.checked) setSelectedPdfFields([...selectedPdfFields, 'Remarks']);
                                                else setSelectedPdfFields(selectedPdfFields.filter(label => label !== 'Remarks'));
                                            }}
                                        />
                                        <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Remarks (Missing Entries)</span>
                                    </label>
                                    {fields.map(f => (
                                        <label key={f.id} className="flex items-center gap-2 pointer glass-card p-2 hover-bright">
                                            <input 
                                                type="checkbox" 
                                                checked={selectedPdfFields.includes(f.label)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedPdfFields([...selectedPdfFields, f.label]);
                                                    else setSelectedPdfFields(selectedPdfFields.filter(label => label !== f.label));
                                                }}
                                            />
                                            <span style={{ fontSize: '0.9rem' }}>{f.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="form-section mt-4">
                                <h3>2. Grouping Options</h3>
                                <div className="form-group">
                                    <label>Group By (Starts each group on a fresh page)</label>
                                    <select 
                                        className="form-input" 
                                        value={pdfGroupBy} 
                                        onChange={(e) => setPdfGroupBy(e.target.value)}
                                    >
                                        <option value="">None (Continuous Table)</option>
                                        {hasBranch && hasCgpa && (
                                            <option value="__branch_cgpa__">🎯 Branch (A-Z) + CGPA (High-Low)</option>
                                        )}
                                        {fields.filter(f => ['dropdown', 'branch', 'zone_group', 'university_autocomplete'].includes(f.type)).map(f => (
                                            <option key={f.id} value={f.label}>{f.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="form-section mt-4">
                                <h3>3. Current Sorting</h3>
                                <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                                    The PDF will follow your current view's sorting: <strong>{
                                        sortMode === 'cgpa_desc' ? 'CGPA High to Low' : 
                                        sortMode === 'branch_alpha' ? 'Branch Alphabetical' :
                                        sortMode === 'branch_cgpa' ? 'Branch + CGPA Desc' : 'Newest First'
                                    }</strong>.
                                </p>
                            </div>
                        </div>
                        <div className="modal-actions-sticky">
                            <button className="btn btn-ghost" onClick={() => setShowPdfModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handlePdfExport} disabled={pdfGenerating}>
                                {pdfGenerating ? <span className="spinner-sm"></span> : '🚀 Generate PDF'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Excel Export Modal (General Options) */}
            {showExcelModal && (
                <div className="modal-overlay" onClick={() => setShowExcelModal(false)}>
                    <div className="modal glass-card shadow-2xl" style={{ maxWidth: '650px', width: '95%' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header border-b border-white-10 pb-4">
                            <div className="flex justify-between items-center">
                                <div>
                                    <h2 className="text-xl font-bold">⚙️ Excel: Custom Options</h2>
                                    <p className="modal-subtitle">Select which system metadata to include in the report</p>
                                </div>
                                <span className="badge badge-primary">XLSX Format</span>
                            </div>
                        </div>
                        
                        <div className="modal-body py-6 flex flex-col gap-2">
                            <div className="form-section mb-4">
                                <h3 className="text-sm font-bold opacity-60 uppercase tracking-wider mb-3">System Columns</h3>
                                <div className="flex flex-col gap-2">
                                    <label className={`refined-option-card ${excelOptions.at ? 'active' : ''}`} style={{ padding: '0.75rem 1.25rem' }}>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 font-bold" style={{ fontSize: '0.9rem' }}>
                                                <span>📅</span>
                                                <span>Submitted At</span>
                                            </div>
                                        </div>
                                        <input 
                                            type="checkbox" 
                                            className="custom-checkbox-input"
                                            checked={excelOptions.at}
                                            onChange={(e) => setExcelOptions({...excelOptions, at: e.target.checked})}
                                        />
                                    </label>

                                    <label className={`refined-option-card ${excelOptions.by ? 'active' : ''}`} style={{ padding: '0.75rem 1.25rem' }}>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 font-bold" style={{ fontSize: '0.9rem' }}>
                                                <span>👤</span>
                                                <span>Submitted By</span>
                                            </div>
                                        </div>
                                        <input 
                                            type="checkbox" 
                                            className="custom-checkbox-input"
                                            checked={excelOptions.by}
                                            onChange={(e) => setExcelOptions({...excelOptions, by: e.target.checked})}
                                        />
                                    </label>

                                    <label className={`refined-option-card ${excelOptions.remarks ? 'active' : ''}`} style={{ padding: '0.75rem 1.25rem' }}>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 font-bold" style={{ fontSize: '0.9rem' }}>
                                                <span>⚠️</span>
                                                <span>Missing Entries</span>
                                            </div>
                                        </div>
                                        <input 
                                            type="checkbox" 
                                            className="custom-checkbox-input"
                                            checked={excelOptions.remarks}
                                            onChange={(e) => setExcelOptions({...excelOptions, remarks: e.target.checked})}
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="modal-footer pt-6 border-t border-white-10 flex justify-end gap-3">
                            <button className="btn btn-ghost px-6" onClick={() => setShowExcelModal(false)}>Cancel</button>
                            <button 
                                className="btn btn-primary px-10 py-3 text-base font-bold" 
                                onClick={() => handleExport(excelOptions.remarks, excelOptions.at, excelOptions.by, fields.map(f => f.label))}
                            >
                                📥 Export with Selected Options
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Pick Fields Export Modal */}
            {showPickFieldsModal && (
                <div className="modal-overlay" onClick={() => setShowPickFieldsModal(false)}>
                    <div className="modal glass-card modal-fixed-height shadow-2xl" style={{ maxWidth: '800px', width: '95%' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header border-b border-white-10 pb-4">
                            <div className="flex justify-between items-center">
                                <div>
                                    <h2 className="text-xl font-bold">🎯 Pick Fields to Export</h2>
                                    <p className="modal-subtitle">Select exactly which data columns should appear in the Excel sheet</p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => setExcelOptions({...excelOptions, remarks: true, selectedFields: fields.map(f => f.label)})}
                                    >Select All</button>
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => setExcelOptions({...excelOptions, remarks: false, selectedFields: []})}
                                    >Clear All</button>
                                </div>
                            </div>
                        </div>

                        <div className="modal-body py-6 scrollable-content" style={{ maxHeight: '60vh' }}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <label className={`refined-option-card ${excelOptions.remarks ? 'active' : ''}`} style={{ padding: '0.75rem 1.25rem' }}>
                                    <span className="flex-1 font-bold" style={{ fontSize: '0.95rem' }}>Remarks (Missing Entries)</span>
                                    <input 
                                        type="checkbox" 
                                        className="custom-checkbox-input"
                                        checked={excelOptions.remarks}
                                        onChange={(e) => setExcelOptions({...excelOptions, remarks: e.target.checked})}
                                    />
                                </label>
                                {fields.map(f => (
                                    <label key={f.id} className={`refined-option-card ${excelOptions.selectedFields.includes(f.label) ? 'active' : ''}`} style={{ padding: '0.75rem 1.25rem' }}>
                                        <span className="flex-1 font-bold" style={{ fontSize: '0.95rem' }}>{f.label}</span>
                                        <input 
                                            type="checkbox" 
                                            className="custom-checkbox-input"
                                            checked={excelOptions.selectedFields.includes(f.label)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setExcelOptions({...excelOptions, selectedFields: [...excelOptions.selectedFields, f.label]});
                                                } else {
                                                    setExcelOptions({...excelOptions, selectedFields: excelOptions.selectedFields.filter(label => label !== f.label)});
                                                }
                                            }}
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="modal-actions-sticky border-t border-white-10 flex justify-end gap-3">
                            <button className="btn btn-ghost px-6" onClick={() => setShowPickFieldsModal(false)}>Cancel</button>
                            <button 
                                className="btn btn-accent px-10 py-3 text-base font-bold" 
                                onClick={() => {
                                    handleExport(excelOptions.remarks, excelOptions.at, excelOptions.by, excelOptions.selectedFields);
                                    setShowPickFieldsModal(false);
                                }}
                            >
                                🚀 Export Selected Fields
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Frequency Analysis Modal (Stretched Vertically & Horizontally, Small Buttons) */}
            {showFrequencyModal && (
                <div className="modal-overlay" onClick={() => setShowFrequencyModal(false)}>
                    <div className="modal glass-card modal-fixed-height shadow-2xl" style={{ maxWidth: '1200px', width: '95%', height: '80vh', display: 'flex', flexDirection: 'column', padding: '24px 32px' }} onClick={e => e.stopPropagation()}>
                        
                        {/* Header */}
                        <div className="flex justify-between items-start pb-3 mb-3 border-b border-white-10" style={{ flexShrink: 0 }}>
                            <div>
                                <h2 className="font-bold" style={{ fontSize: '1.2rem', color: 'var(--gold)', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span>📊</span> Frequency Analysis & Reporting
                                </h2>
                                <p className="text-secondary mt-0.5" style={{ fontSize: '0.75rem', color: '#8b949e' }}>Aggregate option counts grouped chronologically by date intervals.</p>
                            </div>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: '#8b949e', fontSize: '0.85rem' }} onClick={() => setShowFrequencyModal(false)}>✕</button>
                        </div>

                        {/* Stretched Content Container */}
                        <div className="flex flex-col gap-5 flex-grow overflow-y-auto" style={{ minHeight: 0 }}>
                            {/* Section 1: Dropdown Selection Grid (Stretched horizontally) */}
                            <div className="flex flex-col gap-4 p-3.5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', flexShrink: 0 }}>
                                {/* Option (Columns) */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="font-bold text-secondary" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pivot Column (Options)</label>
                                    <select 
                                        className="form-input" 
                                        value={freqTabulateField}
                                        onChange={(e) => handleFieldChange('tabulate', e.target.value)}
                                        style={{ background: '#0d1117', border: '1px solid #30363d', color: '#f5f5f5', borderRadius: '6px', padding: '4px 10px', fontSize: '0.8rem', height: '32px' }}
                                    >
                                        <option value="" disabled>-- Select Option Field --</option>
                                        {fields.map(f => (
                                            <option key={f.id} value={f.label}>
                                                {f.label} {f.type === 'select' || f.type === 'radio' ? ' (Dropdown/Radio)' : ` (${f.type})`}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Date (Rows) */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="font-bold text-secondary" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Row Group (Date/Year)</label>
                                    <select 
                                        className="form-input" 
                                        value={freqDateField}
                                        onChange={(e) => handleFieldChange('date', e.target.value)}
                                        style={{ background: '#0d1117', border: '1px solid #30363d', color: '#f5f5f5', borderRadius: '6px', padding: '4px 10px', fontSize: '0.8rem', height: '32px' }}
                                    >
                                        <option value="" disabled>-- Select Date/Year Field --</option>
                                        {fields.map(f => (
                                            <option key={f.id} value={f.label}>
                                                {f.label} {f.type === 'date' || f.type === 'number' ? ' (Date/Number)' : ` (${f.type})`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Section 2: Month Filter Checkbox Grid (Stretched vertically with flexGrow) */}
                            {freqAvailableMonths.length > 0 && (
                                <div className="flex flex-col gap-2.5 flex-grow" style={{ minHeight: '150px' }}>
                                    <div className="flex justify-between items-center px-1" style={{ flexShrink: 0 }}>
                                        <label className="font-bold text-secondary" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filter Month Periods</label>
                                        <div className="flex gap-2.5" style={{ fontSize: '0.72rem' }}>
                                            <button className="hover:underline font-semibold" style={{ color: '#d4af37', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setFreqSelectedMonths(freqAvailableMonths)}>Select All</button>
                                            <span className="text-gray-600">|</span>
                                            <button className="hover:underline font-semibold" style={{ color: '#d4af37', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setFreqSelectedMonths([])}>Clear All</button>
                                        </div>
                                    </div>
                                    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '12px', overflowY: 'auto', flexGrow: 1 }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
                                            {freqAvailableMonths.map(month => (
                                                <label key={month} className="flex items-center gap-2 text-xs cursor-pointer select-none transition-colors hover:text-white" style={{ color: freqSelectedMonths.includes(month) ? '#f5f5f5' : '#8b949e' }}>
                                                    <input 
                                                        type="checkbox" 
                                                        checked={freqSelectedMonths.includes(month)}
                                                        onChange={() => handleMonthToggle(month)}
                                                        className="custom-checkbox-input"
                                                        style={{ width: '13px', height: '13px', margin: 0 }}
                                                    />
                                                    <span style={{ fontSize: '0.78rem' }}>{month}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Section 3: Warnings */}
                            {freqCapped && (
                                <div style={{ background: 'rgba(212,175,55,0.06)', color: '#d4af37', border: '1px solid rgba(212,175,55,0.2)', padding: '10px 14px', borderRadius: '6px', fontSize: '10.5px', lineHeight: '1.4', display: 'flex', gap: '8px', alignItems: 'flex-start', flexShrink: 0 }}>
                                    <span>⚠️</span>
                                    <span><strong>Column Capping Applied:</strong> There are more than 15 unique options. The report will output the top 14 by frequency, with all other options aggregated under an "Others" column.</span>
                                </div>
                            )}
                        </div>

                        {/* Section 4: Modal Footer Action Buttons (Small styled buttons) */}
                        <div className="flex gap-2.5 justify-end pt-3 mt-4 border-t border-white-10" style={{ flexShrink: 0 }}>
                            <button className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: '0.75rem', borderRadius: '4px' }} onClick={() => setShowFrequencyModal(false)}>Cancel</button>
                            <button 
                                className="btn btn-accent" 
                                style={{ padding: '6px 16px', fontSize: '0.75rem', fontWeight: 'bold', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}
                                onClick={() => {
                                    handleFrequencyExport('excel');
                                    setShowFrequencyModal(false);
                                }}
                                disabled={freqLoading || !freqTabulateField || !freqDateField}
                            >
                                <span>📥</span> Export to Excel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
