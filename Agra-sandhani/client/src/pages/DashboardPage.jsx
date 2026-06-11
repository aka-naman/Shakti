import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import api from '../api/client';
import NotificationCenter from '../components/NotificationCenter';

export default function DashboardPage() {
    const [forms, setForms] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [newFormName, setNewFormName] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importFile, setImportFile] = useState(null);
    const [importing, setImporting] = useState(false);
    const [renameId, setRenameId] = useState(null);

    // ... inside component ...

    const handleImportExcel = async (e) => {
        if (e) e.preventDefault();
        if (!importFile || !newFormName.trim()) return alert('Please provide a file and form name');

        setImporting(true);
        try {
            const formData = new FormData();
            formData.append('file', importFile);
            formData.append('name', newFormName.trim());

            const res = await api.post('/forms/import-excel', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            alert(res.data.message);
            setShowImportModal(false);
            setImportFile(null);
            setNewFormName('');
            fetchForms();
        } catch (err) {
            console.error('Import Error:', err);
            const msg = err.response?.data?.error || err.message || 'Import failed';
            alert(`❌ Import Failed: ${msg}`);
        } finally {
            setImporting(false);
        }
    };
    const [renameName, setRenameName] = useState('');
    const [expandedUsers, setExpandedUsers] = useState({});
    
    // AI Explorer State
    const [showExplorer, setShowExplorer] = useState(false);
    const [explorerPrompt, setExplorerPrompt] = useState('');
    const [explorerLoading, setExplorerLoading] = useState(false);
    const [explorerResults, setExplorerResults] = useState(null);
    const [explorerError, setExplorerError] = useState('');
    const [explorerSchema, setExplorerSchema] = useState({ forms: [], fields: [] });
    const [selectedExplorerForms, setSelectedExplorerForms] = useState([]);
    const [schemaLoading, setSchemaLoading] = useState(false);

    // Delegation State
    const [showDelegationModal, setShowDelegationModal] = useState(false);
    const [allUsers, setAllUsers] = useState([]);
    const [delegations, setDelegations] = useState({ incoming: [], outgoing: [] });
    const [newDelegation, setNewDelegation] = useState({ granteeId: '', duration: '1', durationUnit: 'hours', expiresAt: '' });
    const [delegationLoading, setDelegationLoading] = useState(false);

    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const navigate = useNavigate();

    const fetchForms = async () => {
        try {
            const res = await api.get('/forms');
            setForms(res.data.forms);
        } catch (err) {
            console.error('Failed to fetch forms:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { 
        fetchForms(); 
    }, []);

    const fetchDelegationData = async () => {
        try {
            setDelegationLoading(true);
            const [usersRes, delRes] = await Promise.all([
                api.get('/permissions/users'),
                api.get('/permissions/delegations')
            ]);
            console.log('Fetched Users for delegation:', usersRes.data.users);
            setAllUsers(usersRes.data.users || []);
            setDelegations(delRes.data);
        } catch (err) {
            console.error('Failed to fetch delegation data:', err);
        } finally {
            setDelegationLoading(false);
        }
    };

    useEffect(() => {
        if (showDelegationModal) fetchDelegationData();
    }, [showDelegationModal]);

    const [suggestions, setSuggestions] = useState([]);
    const [filteredSuggestions, setFilteredSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [suggestionIndex, setSuggestionIndex] = useState(0);

    const fetchExplorerSchema = async () => {
        try {
            setSchemaLoading(true);
            const res = await api.get('/explorer/schema');
            setExplorerSchema(res.data);
            const allIds = res.data.forms.map(f => f.id);
            setSelectedExplorerForms(allIds);
            if (allIds.length > 0) fetchSuggestions(allIds);
        } catch (err) {
            console.error('Failed to fetch schema:', err);
        } finally {
            setSchemaLoading(false);
        }
    };

    const fetchSuggestions = async (formIds) => {
        if (!formIds || formIds.length === 0) {
            setSuggestions([]);
            return;
        }
        try {
            const res = await api.post('/explorer/suggestions', { formIds });
            setSuggestions(res.data.suggestions || []);
        } catch (err) {
            console.error('Failed to fetch suggestions:', err);
        }
    };

    const toggleFormSelection = (id) => {
        setSelectedExplorerForms(prev => {
            const newSelection = prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id];
            fetchSuggestions(newSelection);
            return newSelection;
        });
    };

    const selectAllExplorerForms = () => {
        const allIds = explorerSchema.forms.map(f => f.id);
        setSelectedExplorerForms(allIds);
        fetchSuggestions(allIds);
    };

    const clearAllExplorerForms = () => {
        setSelectedExplorerForms([]);
        setSuggestions([]);
    };

    const handlePromptChange = (e) => {
        const value = e.target.value;
        setExplorerPrompt(value);

        if (!value.trim()) {
            setShowSuggestions(false);
            return;
        }

        // Filter suggestions based on the last word
        const words = value.split(/\s+/);
        const lastWord = words[words.length - 1].toLowerCase();

        if (lastWord.length < 1) {
            setShowSuggestions(false);
            return;
        }

        const filtered = suggestions.filter(s => 
            s.value.toLowerCase().includes(lastWord)
        ).slice(0, 8); // Limit to 8 suggestions

        setFilteredSuggestions(filtered);
        setShowSuggestions(filtered.length > 0);
        setSuggestionIndex(0);
    };

    const applySuggestion = (suggestion) => {
        setExplorerPrompt(prev => {
            const words = prev.split(/\s+/);
            words.pop(); // Remove the partial word
            const base = words.join(' ');
            
            let newValue = suggestion.value;
            if (suggestion.type === 'value') {
                newValue = `"${suggestion.value}"`;
            }
            
            return base ? `${base} ${newValue} ` : `${newValue} `;
        });
        setShowSuggestions(false);
    };

    const handlePromptKeyDown = (e) => {
        if (!showSuggestions) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSuggestionIndex(prev => (prev + 1) % filteredSuggestions.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSuggestionIndex(prev => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
        } else if (e.key === 'Enter' && showSuggestions) {
            e.preventDefault();
            applySuggestion(filteredSuggestions[suggestionIndex]);
        } else if (e.key === 'Escape') {
            setShowSuggestions(false);
        }
    };

    const [selectedExplorerFields, setSelectedExplorerFields] = useState([]);

    const [showExplorerFieldsModal, setShowExplorerFieldsModal] = useState(false);

    // AI Explorer PDF State
    const [showExplorerPdfModal, setShowExplorerPdfModal] = useState(false);
    const [selectedExplorerPdfFields, setSelectedExplorerPdfFields] = useState([]);
    const [explorerPdfGroupBy, setExplorerPdfGroupBy] = useState('');
    const [explorerPdfGenerating, setExplorerPdfGenerating] = useState(false);

    const handleExplorerPdfExport = async () => {
        if (!explorerPrompt.trim()) return;
        if (selectedExplorerPdfFields.length === 0) {
            alert('Please select at least one field to export');
            return;
        }

        try {
            setExplorerPdfGenerating(true);
            const selectedFormsData = explorerSchema.forms.filter(f => selectedExplorerForms.includes(f.id));
            
            // Handle specialized grouping mode
            let finalGroupBy = explorerPdfGroupBy;
            let specialMode = null;
            if (explorerPdfGroupBy === '__branch_cgpa__') {
                const branchField = explorerSchema.fields.find(f => f.type === 'branch');
                finalGroupBy = branchField ? branchField.label : 'Branch';
                specialMode = 'branch_cgpa';
            }

            const res = await api.post('/explorer/export/pdf', { 
                prompt: explorerPrompt,
                selectedForms: selectedFormsData,
                selectedFields: selectedExplorerPdfFields,
                groupBy: finalGroupBy || null,
                specialMode: specialMode
            }, { responseType: 'blob' });
            
            const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `ai_explorer_export.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            setShowExplorerPdfModal(false);
        } catch (err) {
            console.error('AI PDF Export Error:', err);
            alert('Failed to export AI results to PDF');
        } finally {
            setExplorerPdfGenerating(false);
        }
    };

    const handleExplorerExport = async () => {
        if (!explorerPrompt.trim()) return;
        try {
            const selectedFormsData = explorerSchema.forms.filter(f => selectedExplorerForms.includes(f.id));
            
            const res = await api.post('/explorer/export', { 
                prompt: explorerPrompt,
                selectedForms: selectedFormsData,
                selectedFields: selectedExplorerFields
            }, { responseType: 'blob' });
            
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.download = `ai_explorer_results.xlsx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            setShowExplorerFieldsModal(false);
        } catch (err) {
            alert('Failed to export AI results');
        }
    };

    const handleCreateDelegation = async (e) => {
        e.preventDefault();
        if (!newDelegation.granteeId) return;
        
        const payload = {
            granteeId: newDelegation.granteeId,
        };

        if (newDelegation.durationUnit === 'date') {
            payload.expiresAt = newDelegation.expiresAt;
        } else {
            payload.duration = newDelegation.duration;
            payload.durationUnit = newDelegation.durationUnit;
        }

        try {
            setDelegationLoading(true);
            await api.post('/permissions/delegate', payload);
            setNewDelegation({ granteeId: '', duration: '1', durationUnit: 'hours', expiresAt: '' });
            fetchDelegationData();
            fetchForms();
        } catch (err) {
            alert(err.response?.data?.error || 'Delegation failed');
        } finally {
            setDelegationLoading(false);
        }
    };

    const handleRevokeDelegation = async (id) => {
        try {
            await api.delete(`/permissions/delegate/${id}`);
            fetchDelegationData();
            fetchForms();
        } catch (err) {
            alert('Failed to revoke delegation');
        }
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            const dropdown = document.getElementById('form-dropdown-list');
            const container = document.querySelector('.dropdown-container');
            if (dropdown && container && !container.contains(event.target)) {
                dropdown.classList.add('hidden');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (showExplorer) fetchExplorerSchema();
    }, [showExplorer]);

    const handleRequestAccess = async (formId) => {
        try {
            await api.post(`/permissions/request/${formId}`);
            setForms(prevForms => prevForms.map(f => f.id === formId ? { ...f, access_status: 'pending' } : f));
        } catch { alert('Failed to request access'); }
    };

    const handleCreate = async (event) => {
        event.preventDefault();
        if (!newFormName.trim()) return;
        try {
            await api.post('/forms', { name: newFormName.trim() });
            setNewFormName('');
            setShowCreateModal(false);
            fetchForms();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to create form');
        }
    };

    const handleRename = async (id) => {
        if (!renameName.trim()) return;
        try {
            await api.put(`/forms/${id}`, { name: renameName.trim() });
            setRenameId(null);
            setRenameName('');
            fetchForms();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to rename');
        }
    };

    const [duplicateModal, setDuplicateModal] = useState({ show: false, id: null, name: '' });

    const handleDuplicate = async (id, withRecords = false) => {
        try {
            const endpoint = withRecords ? `/forms/${id}/duplicate-with-records` : `/forms/${id}/duplicate`;
            const res = await api.post(endpoint);
            const newForm = res.data.form;
            setDuplicateModal({ show: false, id: null, name: '' });
            if (newForm && newForm.latest_version_id && !withRecords) {
                navigate(`/forms/${newForm.id}/builder/${newForm.latest_version_id}`);
            } else {
                fetchForms();
            }
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to duplicate');
        }
    };

    const handleDelete = async (id, name) => {
        if (!confirm(`Delete "${name}"? This will remove all submissions.`)) return;
        try {
            await api.delete(`/forms/${id}`);
            fetchForms();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to delete');
        }
    };

    const handleExport = async (id, name) => {
        try {
            const res = await api.get(`/export/${id}`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.download = `${name.replace(/[^a-zA-Z0-9]/g, '_')}_submissions.xlsx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert('Export failed');
        }
    };

    const toggleUserExpand = (owner) => {
        setExpandedUsers(prev => ({ ...prev, [owner]: !prev[owner] }));
    };

    const handleExplorerQuery = async (e) => {
        e.preventDefault();
        if (!explorerPrompt.trim()) return;

        try {
            setExplorerLoading(true);
            setExplorerError('');
            
            const selectedFormsData = explorerSchema.forms.filter(f => selectedExplorerForms.includes(f.id));
            
            const res = await api.post('/explorer/query', { 
                prompt: explorerPrompt,
                selectedForms: selectedFormsData
            });
            setExplorerResults(res.data);
        } catch (err) {
            setExplorerError(err.response?.data?.error || 'AI Query failed');
        } finally {
            setExplorerLoading(false);
        }
    };

    // Grouping logic
    const filteredForms = forms.filter(form => {
        const search = searchTerm.toLowerCase();
        return (form.name?.toLowerCase().includes(search) || form.owner_username?.toLowerCase().includes(search));
    });

    const groupedForms = filteredForms.reduce((acc, form) => {
        const owner = form.owner_username || 'Unknown';
        if (!acc[owner]) acc[owner] = [];
        acc[owner].push(form);
        return acc;
    }, {});

    const sortedOwners = Object.keys(groupedForms).sort((a, b) => {
        if (a === user?.username) return -1;
        if (b === user?.username) return 1;
        return a.localeCompare(b);
    });

    if (loading) {
        return (
            <div className="loading-screen">
                <div className="spinner"></div>
                <p>Loading dashboard...</p>
            </div>
        );
    }

    return (
        <div className="dashboard-page">
            <header className="dashboard-header">
                <div className="header-left">
                    <h1>👁️ अग्र-Sandhani</h1>
                    <span className="user-badge">{user?.role === 'admin' ? '👑 Admin' : '👤 User'}: {user?.username}</span>
                    <div className="search-container">
                        <input
                            type="text"
                            className="search-input"
                            placeholder="Search forms or users..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button className="search-clear" onClick={() => setSearchTerm('')}>✕</button>
                        )}
                    </div>
                </div>
                <div className="header-right">
                    <NotificationCenter />
                    <button className="btn btn-secondary" onClick={() => setShowDelegationModal(true)} title="Manage Data Access">
                        🔑 Manage Access
                    </button>
                    <button className="btn btn-accent" onClick={() => setShowExplorer(true)} title="AI Data Explorer">
                        🧠 AI Explorer
                    </button>
                    <button className="btn btn-secondary" onClick={() => setShowImportModal(true)} title="Import Form and Data from Excel">
                        📥 Import Excel
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        + New Form
                    </button>
                    {user?.role === 'admin' && (
                        <button className="btn btn-secondary" onClick={() => navigate('/admin/dashboard')}>
                            📊 Admin Dashboard
                        </button>
                    )}
                    <button
                        className="theme-toggle-btn"
                        onClick={toggleTheme}
                        title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                        aria-label="Toggle theme"
                    >
                        {theme === 'dark' ? '☀️' : '🌙'}
                    </button>
                    <button className="btn btn-ghost" onClick={logout}>
                        Logout
                    </button>
                </div>
            </header>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal glass-card" onClick={e => e.stopPropagation()}>
                        <h2>Create New Form</h2>
                        <form onSubmit={handleCreate}>
                            <div className="form-group">
                                <label>Form Name</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={newFormName}
                                    onChange={(e) => setNewFormName(e.target.value)}
                                    placeholder="Enter form name"
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowCreateModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">Create</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Import Excel Modal */}
            {showImportModal && (
                <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
                    <div className="modal glass-card" onClick={e => e.stopPropagation()}>
                        <h2>📥 Import Form from Excel</h2>
                        <p className="text-muted">Upload an Excel file (.xlsx). The first row will become field labels.</p>
                        
                        <form onSubmit={handleImportExcel} style={{ marginTop: '1.5rem' }}>
                            <div className="form-group">
                                <label>New Form Name</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={newFormName}
                                    onChange={(e) => setNewFormName(e.target.value)}
                                    placeholder="e.g., Personnel Records"
                                    required
                                />
                            </div>
                            
                            <div className="form-group">
                                <label>Select Excel File</label>
                                <input
                                    type="file"
                                    className="form-input"
                                    accept=".xlsx"
                                    onChange={(e) => setImportFile(e.target.files[0])}
                                    required
                                />
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowImportModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={importing}>
                                    {importing ? <span className="spinner-sm"></span> : '🚀 Start Import'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Duplicate Choice Modal */}
            {duplicateModal.show && (
                <div className="modal-overlay" onClick={() => setDuplicateModal({ show: false, id: null, name: '' })}>
                    <div className="modal glass-card" onClick={e => e.stopPropagation()}>
                        <h2>Duplicate Form</h2>
                        <p className="text-muted">Choose how you want to duplicate <b>{duplicateModal.name}</b>:</p>
                        
                        <div className="duplicate-options" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                            <button className="btn btn-secondary" style={{ padding: '1.5rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.3rem' }} onClick={() => handleDuplicate(duplicateModal.id, false)}>
                                <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>📋 Duplicate Template Only</span>
                                <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Creates a fresh copy of the form without any existing submissions.</span>
                            </button>
                            
                            <button className="btn btn-accent" style={{ padding: '1.5rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.3rem' }} onClick={() => handleDuplicate(duplicateModal.id, true)}>
                                <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>🗄️ Duplicate with Records</span>
                                <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Creates a copy of the form AND copies all existing submission data.</span>
                            </button>
                        </div>

                        <div className="modal-actions" style={{ marginTop: '2rem' }}>
                            <button type="button" className="btn btn-ghost" onClick={() => setDuplicateModal({ show: false, id: null, name: '' })}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Forms Grouped by User */}
            <div className="forms-grouped" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', padding: '1rem' }}>
                {forms.length === 0 ? (
                    <div className="empty-state glass-card">
                        <div className="empty-icon">📝</div>
                        <h2>No Forms Found</h2>
                        <p>Create a form or wait for shared forms to appear.</p>
                        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                            Create First Form
                        </button>
                    </div>
                ) : filteredForms.length === 0 ? (
                    <div className="empty-state glass-card">
                        <div className="empty-icon">🔍</div>
                        <h2>No Matches Found</h2>
                        <p>We couldn't find any forms matching "{searchTerm}".</p>
                        <button className="btn btn-ghost" onClick={() => setSearchTerm('')}>
                            Clear Search
                        </button>
                    </div>
                ) : (
                    sortedOwners.map((owner) => {
                        const ownerForms = groupedForms[owner];
                        const isExpanded = expandedUsers[owner] !== false;
                        const isMe = owner === user?.username;

                        return (
                            <div key={owner} className="user-form-group">
                                <h2 className="user-group-title" onClick={() => toggleUserExpand(owner)} style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-color)' }}>
                                    <span style={{ fontSize: '0.8em', opacity: 0.7 }}>{isExpanded ? '▼' : '▶'}</span>
                                    {isMe ? '⭐ My Forms' : `👤 ${owner}'s Forms`} 
                                    <span className="badge badge-count" style={{ marginLeft: '0.5rem' }}>{ownerForms.length}</span>
                                </h2>
                                
                                {isExpanded && (
                                    <div className="forms-grid">
                                        {ownerForms.map((form) => {
                                            const status = form.access_status;
                                            const isOwner = status === 'owner';
                                            const isAdmin = status === 'admin';
                                            const isDelegate = status === 'delegate';
                                            const hasAccess = isOwner || isAdmin || isDelegate || status === 'approved';

                                            return (
                                                <div key={form.id} className="form-card glass-card">
                                                    <div className="form-card-header">
                                                        {renameId === form.id ? (
                                                            <div className="rename-inline">
                                                                <input
                                                                    type="text"
                                                                    className="form-input form-input-sm"
                                                                    value={renameName}
                                                                    onChange={(e) => setRenameName(e.target.value)}
                                                                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(form.id); if (e.key === 'Escape') setRenameId(null); }}
                                                                    autoFocus
                                                                />
                                                                <button className="btn btn-sm btn-primary" onClick={() => handleRename(form.id)}>Save</button>
                                                                <button className="btn btn-sm btn-ghost" onClick={() => setRenameId(null)}>✕</button>
                                                            </div>
                                                        ) : (
                                                            <h3 className="form-card-title">{form.name}</h3>
                                                        )}
                                                        <div className="form-card-badges">
                                                            {form.is_locked && <span className="badge badge-locked">🔒 Locked</span>}
                                                            <span className="badge badge-count">{form.submission_count} submissions</span>
                                                            {isAdmin && <span className="badge badge-admin">Global Access</span>}
                                                        </div>
                                                    </div>

                                                    <div className="form-card-meta">
                                                        <span>Created: {new Date(form.created_at).toLocaleDateString()}</span>
                                                        {form.latest_version_id && <span>Version {form.version_number}</span>}
                                                    </div>

                                                    <div className="form-card-actions">
                                                        {(isOwner || isAdmin) && !form.is_locked && (
                                                            <button className="btn btn-sm btn-accent" onClick={() => navigate(`/forms/${form.id}/builder/${form.latest_version_id}`)}>✏️ Build</button>
                                                        )}
                                                        
                                                        {hasAccess ? (
                                                            <>
                                                                <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/forms/${form.id}/submit`)}>📝 Fill</button>
                                                                <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/forms/${form.id}/submissions`)}>📊 View</button>
                                                                <button className="btn btn-sm btn-secondary" onClick={() => handleExport(form.id, form.name)}>📥 Export</button>
                                                                {(isOwner || isAdmin) && (
                                                                    <>
                                                                        <button className="btn btn-sm btn-ghost" onClick={() => { setRenameId(form.id); setRenameName(form.name); }}>✏️ Rename</button>
                                                                        <button className="btn btn-sm btn-ghost" onClick={() => setDuplicateModal({ show: true, id: form.id, name: form.name })}>📋 Duplicate</button>
                                                                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(form.id, form.name)}>🗑️ Delete</button>
                                                                    </>
                                                                )}
                                                            </>
                                                        ) : (
                                                            status === 'pending' ? <button className="btn btn-sm btn-ghost" disabled>⏳ Request Sent</button> :
                                                            status === 'rejected' ? <button className="btn btn-sm btn-danger" disabled>🚫 Rejected</button> :
                                                            <button className="btn btn-sm btn-primary" onClick={() => handleRequestAccess(form.id)}>🔓 Request Access</button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* AI Explorer Modal */}
            {showExplorer && (
                <div className="modal-overlay" onClick={() => setShowExplorer(false)}>
                    <div className="modal glass-card explorer-modal" style={{ maxWidth: '1000px', width: '95%' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>🧠 AI Data Explorer</h2>
                            <button className="btn-close" onClick={() => setShowExplorer(false)}>✕</button>
                        </div>
                        <div className="modal-content">
                            <div className="explorer-setup-compact" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '2rem' }}>
                                {/* Step 1: Form Selection (Compact) */}
                                <div className="explorer-form-selection">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                        <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
                                            Step 1: Select Scope ({selectedExplorerForms.length} selected)
                                        </h4>
                                        <div style={{ display: 'flex', gap: '1rem' }}>
                                            <button 
                                                type="button" 
                                                style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.7rem', color: 'var(--accent-secondary)', cursor: 'pointer', fontWeight: 'bold' }}
                                                onClick={selectAllExplorerForms}
                                            >
                                                Select All
                                            </button>
                                            <button 
                                                type="button" 
                                                style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.7rem', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 'bold' }}
                                                onClick={clearAllExplorerForms}
                                            >
                                                Clear All
                                            </button>
                                        </div>
                                    </div>

                                    <div className="dropdown-container" style={{ position: 'relative' }}>
                                        <div 
                                            className="form-input" 
                                            style={{ 
                                                minHeight: '40px', 
                                                display: 'flex', 
                                                flexWrap: 'wrap', 
                                                gap: '0.4rem', 
                                                padding: '0.4rem', 
                                                cursor: 'pointer',
                                                background: 'rgba(255,255,255,0.05)'
                                            }}
                                            onClick={() => document.getElementById('form-dropdown-list').classList.toggle('hidden')}
                                        >
                                            {selectedExplorerForms.length === 0 ? (
                                                <span className="text-muted">Select forms...</span>
                                            ) : (
                                                selectedExplorerForms.map(fid => {
                                                    const f = explorerSchema.forms.find(form => form.id === fid);
                                                    return (
                                                        <span key={fid} className="badge badge-accent" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}>
                                                            {f?.name}
                                                            <button onClick={(e) => { e.stopPropagation(); toggleFormSelection(fid); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '10px' }}>✕</button>
                                                        </span>
                                                    );
                                                })
                                            )}
                                        </div>

                                        <div 
                                            id="form-dropdown-list" 
                                            className="hidden glass-card" 
                                            style={{ 
                                                position: 'absolute', 
                                                top: '100%', 
                                                left: 0, 
                                                right: 0, 
                                                zIndex: 100, 
                                                maxHeight: '150px', 
                                                overflowY: 'auto', 
                                                marginTop: '5px',
                                                padding: '0.5rem'
                                            }}
                                        >
                                            {schemaLoading ? (
                                                <div className="spinner-sm" style={{ margin: '1rem auto' }}></div>
                                            ) : explorerSchema.forms.length === 0 ? (
                                                <p className="text-muted" style={{ padding: '0.5rem' }}>No forms found.</p>
                                            ) : (
                                                explorerSchema.forms.map(f => (
                                                    <div 
                                                        key={f.id} 
                                                        className={`dropdown-item ${selectedExplorerForms.includes(f.id) ? 'active' : ''}`}
                                                        style={{ 
                                                            padding: '0.5rem 0.8rem', 
                                                            cursor: 'pointer', 
                                                            borderRadius: '4px',
                                                            marginBottom: '2px',
                                                            fontSize: '0.9rem',
                                                            background: selectedExplorerForms.includes(f.id) ? 'var(--accent-primary)' : 'transparent'
                                                        }}
                                                        onClick={() => toggleFormSelection(f.id)}
                                                    >
                                                        {f.name}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Step 2: Integrated Autocomplete Prompt */}
                                <div className="explorer-prompt-section">
                                    <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Step 2: Ask AI (with Autocomplete)</h4>
                                    <div className="prompt-wrapper" style={{ position: 'relative' }}>
                                        <form onSubmit={handleExplorerQuery} className="explorer-form" style={{ display: 'flex', gap: '1rem' }}>
                                            <input 
                                                type="text" 
                                                className="form-input explorer-input"
                                                placeholder="Ask e.g., 'Find all entries where university is...'"
                                                value={explorerPrompt}
                                                onChange={handlePromptChange}
                                                onKeyDown={handlePromptKeyDown}
                                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                                autoFocus
                                                style={{ fontSize: '1.1rem', padding: '0.8rem 1rem' }}
                                            />
                                            <button type="submit" className="btn btn-primary explorer-submit" disabled={explorerLoading || !explorerPrompt.trim() || selectedExplorerForms.length === 0}>
                                                {explorerLoading ? <span className="spinner-sm"></span> : '🧠 Ask AI'}
                                            </button>
                                        </form>

                                        {showSuggestions && (
                                            <div className="suggestions-dropdown glass-card" style={{ 
                                                position: 'absolute', 
                                                top: '100%', 
                                                left: 0, 
                                                right: '120px', 
                                                zIndex: 200, 
                                                marginTop: '5px',
                                                padding: '0.5rem',
                                                border: '1px solid var(--accent-primary)'
                                            }}>
                                                {filteredSuggestions.map((s, i) => (
                                                    <div 
                                                        key={i} 
                                                        className={`suggestion-item ${i === suggestionIndex ? 'active' : ''}`}
                                                        style={{ 
                                                            padding: '0.6rem 1rem', 
                                                            cursor: 'pointer', 
                                                            borderRadius: '4px',
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center',
                                                            background: i === suggestionIndex ? 'rgba(255,255,255,0.1)' : 'transparent'
                                                        }}
                                                        onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
                                                    >
                                                        <span style={{ fontWeight: s.type === 'field' ? 'bold' : 'normal' }}>
                                                            {s.type === 'field' ? `📁 ${s.value}` : `✨ ${s.value}`}
                                                        </span>
                                                        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>{s.type === 'field' ? 'Field' : `Value for ${s.field}`}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.8rem' }}>
                                        💡 Tip: Type and use <b>Arrow Keys</b> + <b>Enter</b> to pick fields or sample values.
                                    </p>
                                </div>
                            </div>

                            {explorerError && <div className="alert alert-error" style={{ margin: '0 0 1rem 0' }}>{explorerError}</div>}

                            {explorerResults && (
                                <div className="explorer-results-container animate-fade-in">
                                    <div className="explorer-results-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                        <span className="badge badge-count">Found {explorerResults.rowCount} results</span>
                                        <div className="flex gap-2">
                                            <button className="btn btn-sm btn-secondary" onClick={() => setShowExplorerFieldsModal(true)}>🎯 Pick Fields</button>
                                            <button className="btn btn-sm btn-accent" onClick={handleExplorerExport}>📥 Export Selected to Excel</button>
                                            <button className="btn btn-sm btn-primary" onClick={() => {
                                                const dataKeys = new Set();
                                                explorerResults.rows.forEach(row => { 
                                                    const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                                                    if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                                                        Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
                                                    }
                                                });
                                                setSelectedExplorerPdfFields(Array.from(dataKeys));
                                                setShowExplorerPdfModal(true);
                                            }}>📄 PDF: Custom Landscape</button>
                                        </div>
                                    </div>

                                    {/* AI Explorer PDF Modal */}
                                    {showExplorerPdfModal && (
                                        <div className="modal-overlay" onClick={() => setShowExplorerPdfModal(false)}>
                                            <div className="modal glass-card modal-fixed-height" style={{ maxWidth: '800px', width: '95%' }} onClick={e => e.stopPropagation()}>
                                                <div className="modal-header">
                                                    <h2>📄 AI Explorer PDF Export (Landscape)</h2>
                                                    <p className="modal-subtitle">Select fields and grouping for your professional AI report</p>
                                                </div>
                                                <div className="modal-body scrollable-content">
                                                    <div className="form-section">
                                                        <div className="flex justify-between items-center mb-3">
                                                            <h3 className="m-0">1. Select Dynamic Fields</h3>
                                                            <div className="flex gap-2">
                                                                <button className="btn btn-ghost btn-xs" onClick={() => {
                                                                    const dataKeys = new Set();
                                                                    explorerResults.rows.forEach(row => { 
                                                                        const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                                                                        if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                                                                            Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
                                                                        }
                                                                    });
                                                                    setSelectedExplorerPdfFields(Array.from(dataKeys));
                                                                }}>Select All</button>
                                                                <button className="btn btn-ghost btn-xs" onClick={() => setSelectedExplorerPdfFields([])}>Clear All</button>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                            {(() => {
                                                                const dataKeys = new Set();
                                                                explorerResults.rows.forEach(row => { 
                                                                    const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                                                                    if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                                                                        Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
                                                                    }
                                                                });
                                                                return Array.from(dataKeys).sort().map(h => (
                                                                    <label key={h} className={`refined-option-card ${selectedExplorerPdfFields.includes(h) ? 'active' : ''}`} style={{ padding: '0.6rem 1rem' }}>
                                                                        <span className="flex-1 font-bold" style={{ fontSize: '0.85rem' }}>{h === 'Remarks' ? 'Remarks (Missing Entries)' : h}</span>
                                                                        <input 
                                                                            type="checkbox" 
                                                                            className="custom-checkbox-input"
                                                                            checked={selectedExplorerPdfFields.includes(h)}
                                                                            onChange={(e) => {
                                                                                if (e.target.checked) setSelectedExplorerPdfFields([...selectedExplorerPdfFields, h]);
                                                                                else setSelectedExplorerPdfFields(selectedExplorerPdfFields.filter(f => f !== h));
                                                                            }}
                                                                        />
                                                                    </label>
                                                                ));
                                                            })()}
                                                        </div>
                                                    </div>

                                                    <div className="form-section mt-6">
                                                        <h3>2. Grouping Options</h3>
                                                        <div className="form-group">
                                                            <label>Group By (Starts each group on a fresh page)</label>
                                                            <select 
                                                                className="form-input" 
                                                                value={explorerPdfGroupBy} 
                                                                onChange={(e) => setExplorerPdfGroupBy(e.target.value)}
                                                            >
                                                                <option value="">None (Continuous Table)</option>
                                                                
                                                                {/* Specialized Option */}
                                                                {(() => {
                                                                    const dataKeys = new Set();
                                                                    explorerResults.rows.forEach(row => { 
                                                                        const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                                                                        if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                                                                            Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
                                                                        }
                                                                    });
                                                                    const keys = Array.from(dataKeys).map(k => k.toLowerCase());
                                                                    const hasBranch = keys.some(k => k === 'branch' || k.includes('branch'));
                                                                    const hasCgpa = keys.some(k => k === 'cgpa' || k.includes('cgpa'));
                                                                    
                                                                    if (hasBranch && hasCgpa) {
                                                                        return <option value="__branch_cgpa__">🎯 Branch (A-Z) + CGPA (High-Low)</option>;
                                                                    }
                                                                    return null;
                                                                })()}

                                                                {/* Map fixed headers (always groupable) */}
                                                                {explorerResults && Object.keys(explorerResults.rows[0]).filter(k => !['Data', 'data', 'data_json'].includes(k)).map(h => (
                                                                    <option key={h} value={h}>{h} (Fixed)</option>
                                                                ))}

                                                                {/* Map filtered dynamic headers */}
                                                                {(() => {
                                                                    const dataKeys = new Set();
                                                                    explorerResults.rows.forEach(row => { 
                                                                        const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                                                                        if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                                                                            Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
                                                                        }
                                                                    });
                                                                    
                                                                    return Array.from(dataKeys).sort().map(h => {
                                                                        // Filter by type if possible, otherwise show all dynamic
                                                                        const fieldInfo = explorerSchema.fields.find(f => f.label === h);
                                                                        const isGroupable = !fieldInfo || ['dropdown', 'branch', 'zone_group', 'university_autocomplete'].includes(fieldInfo.type);
                                                                        
                                                                        if (isGroupable) {
                                                                            return <option key={h} value={h}>{h}</option>;
                                                                        }
                                                                        return null;
                                                                    });
                                                                })()}
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="modal-actions-sticky border-t border-white-10 pt-4 flex justify-end gap-3">
                                                    <button className="btn btn-ghost px-6" onClick={() => setShowExplorerPdfModal(false)}>Cancel</button>
                                                    <button className="btn btn-primary px-10" onClick={handleExplorerPdfExport} disabled={explorerPdfGenerating}>
                                                        {explorerPdfGenerating ? <span className="spinner-sm"></span> : '🚀 Generate AI PDF'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {showExplorerFieldsModal && (
                                        <div className="modal-overlay" onClick={() => setShowExplorerFieldsModal(false)}>
                                            <div className="modal glass-card" style={{ maxWidth: '800px', width: '95%' }} onClick={e => e.stopPropagation()}>
                                                <div className="modal-header border-b border-white-10 pb-4">
                                                    <div className="flex justify-between items-center">
                                                        <div>
                                                            <h2 className="text-xl font-bold">🎯 Pick Fields to Export</h2>
                                                            <p className="modal-subtitle">Select columns to include in your Excel report</p>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button 
                                                                className="btn btn-ghost btn-sm"
                                                                onClick={() => {
                                                                    const dataKeys = new Set();
                                                                    explorerResults.rows.forEach(row => { 
                                                                        const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                                                                        if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                                                                            Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
                                                                        }
                                                                    });
                                                                    setSelectedExplorerFields(Array.from(dataKeys));
                                                                }}
                                                            >Select All</button>
                                                            <button 
                                                                className="btn btn-ghost btn-sm"
                                                                onClick={() => setSelectedExplorerFields([])}
                                                            >Clear All</button>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="modal-body py-6 scrollable-content" style={{ maxHeight: '60vh' }}>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        {(() => {
                                                            const dataKeys = new Set();
                                                            explorerResults.rows.forEach(row => { 
                                                                const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                                                                if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                                                                    Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
                                                                }
                                                            });
                                                            const keys = Array.from(dataKeys).sort();
                                                            return keys.map(h => (
                                                                <label key={h} className={`refined-option-card ${selectedExplorerFields.includes(h) ? 'active' : ''}`} style={{ padding: '0.75rem 1.25rem' }}>
                                                                    <span className="flex-1 font-bold" style={{ fontSize: '0.95rem' }}>{h === 'Remarks' ? 'Remarks (Missing Entries)' : h}</span>
                                                                    <input 
                                                                        type="checkbox" 
                                                                        className="custom-checkbox-input"
                                                                        checked={selectedExplorerFields.includes(h)}
                                                                        onChange={(e) => {
                                                                            if (e.target.checked) setSelectedExplorerFields([...selectedExplorerFields, h]);
                                                                            else setSelectedExplorerFields(selectedExplorerFields.filter(f => f !== h));
                                                                        }}
                                                                    />
                                                                </label>
                                                            ));
                                                        })()}
                                                    </div>
                                                </div>
                                                <div className="modal-footer pt-6 border-t border-white-10 flex justify-end gap-3">
                                                    <button className="btn btn-ghost px-6" onClick={() => setShowExplorerFieldsModal(false)}>Cancel</button>
                                                    <button className="btn btn-accent px-10" onClick={handleExplorerExport}>🚀 Export Selected</button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="table-container scrollable-table-wrapper" style={{ maxHeight: '400px' }}>
                                        {explorerResults.rows.length > 0 ? (() => {
                                            // 1. Identify all dynamic keys from the 'Data' column
                                            const dataKeys = new Set();
                                            explorerResults.rows.forEach(row => {
                                                if (row.Data && typeof row.Data === 'object') {
                                                    Object.keys(row.Data).forEach(k => dataKeys.add(k));
                                                }
                                            });
                                            const dynamicHeaders = Array.from(dataKeys).sort();
                                            const fixedHeaders = Object.keys(explorerResults.rows[0]).filter(k => k !== 'Data');
                                            const allHeaders = [...fixedHeaders, ...dynamicHeaders];

                                            return (
                                                <table className="admin-table">
                                                    <thead>
                                                        <tr>{allHeaders.map(h => <th key={h}>{h}</th>)}</tr>
                                                    </thead>
                                                    <tbody>
                                                        {explorerResults.rows.map((row, i) => (
                                                            <tr key={i}>
                                                                {fixedHeaders.map(h => <td key={h}>{row[h]?.toString() || '-'}</td>)}
                                                                {dynamicHeaders.map(h => {
                                                                    let val = row.Data ? row.Data[h] : '-';
                                                                    if (typeof val === 'string') val = val.replace(/ \|\|\| /g, ', ');
                                                                    return <td key={h}>{val || '-'}</td>;
                                                                })}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            );
                                        })() : <div className="empty-state">No matching data found.</div>}
                                    </div>
                                    
                                    {user?.role === 'admin' && (
                                        <details style={{ marginTop: '1.5rem', opacity: 0.7 }}>
                                            <summary style={{ cursor: 'pointer', fontSize: '0.8rem' }}>View Generated SQL (Admin Only)</summary>
                                            <code style={{ display: 'block', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', marginTop: '0.5rem', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>{explorerResults.sql}</code>
                                        </details>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Delegation Modal */}
            {showDelegationModal && (
                <div className="modal-overlay" onClick={() => setShowDelegationModal(false)}>
                    <div className="modal glass-card" style={{ maxWidth: '800px', width: '90%' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>🔑 Manage Complete Data Access</h2>
                            <button className="btn-close" onClick={() => setShowDelegationModal(false)}>✕</button>
                        </div>
                        <div className="modal-content">
                            <p className="text-muted" style={{ marginBottom: '1.5rem' }}>
                                Grant another user temporary access to view and export ALL your forms and submissions.
                            </p>

                            <section className="delegation-form-section" style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                                <h4>Grant New Access</h4>
                                <form onSubmit={handleCreateDelegation} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '1rem', alignItems: 'end', marginTop: '1rem' }}>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label>Select User</label>
                                        <select 
                                            className="form-input" 
                                            value={newDelegation.granteeId} 
                                            onChange={e => setNewDelegation({ ...newDelegation, granteeId: e.target.value })}
                                            required
                                        >
                                            <option value="">Choose a user...</option>
                                            {allUsers.length === 0 ? <option disabled>No other users found</option> : allUsers.map(u => (
                                                <option key={u.id} value={u.id}>{u.username}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label>Duration Unit</label>
                                        <select 
                                            className="form-input" 
                                            value={newDelegation.durationUnit} 
                                            onChange={e => setNewDelegation({ ...newDelegation, durationUnit: e.target.value })}
                                            required
                                        >
                                            <option value="hours">Hours</option>
                                            <option value="days">Days</option>
                                            <option value="date">Until Specific Date</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label>{newDelegation.durationUnit === 'date' ? 'Select Date' : 'Value'}</label>
                                        {newDelegation.durationUnit === 'date' ? (
                                            <input 
                                                type="datetime-local" 
                                                className="form-input" 
                                                value={newDelegation.expiresAt}
                                                onChange={e => setNewDelegation({ ...newDelegation, expiresAt: e.target.value })}
                                                required
                                            />
                                        ) : (
                                            <input 
                                                type="number" 
                                                className="form-input" 
                                                min="1" 
                                                value={newDelegation.duration}
                                                onChange={e => setNewDelegation({ ...newDelegation, duration: e.target.value })}
                                                required
                                            />
                                        )}
                                    </div>
                                    <button type="submit" className="btn btn-primary" disabled={delegationLoading}>
                                        Grant Access
                                    </button>
                                </form>
                            </section>

                            <div className="delegations-lists" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                                <section className="outgoing-delegations">
                                    <h4>Outgoing (Access You Granted)</h4>
                                    {delegations.outgoing.length === 0 ? <p className="text-muted small">No active outgoing delegations.</p> : (
                                        <div className="delegation-list">
                                            {delegations.outgoing.map(d => (
                                                <div key={d.id} className="delegation-item glass-card" style={{ padding: '0.8rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <div style={{ fontWeight: 'bold' }}>To: {d.recipient_username}</div>
                                                        <div className="small text-muted">Expires: {new Date(d.expires_at).toLocaleString()}</div>
                                                    </div>
                                                    <button className="btn btn-sm btn-danger" onClick={() => handleRevokeDelegation(d.id)}>Revoke</button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>

                                <section className="incoming-delegations">
                                    <h4>Incoming (Access Granted to You)</h4>
                                    {delegations.incoming.length === 0 ? <p className="text-muted small">No active incoming delegations.</p> : (
                                        <div className="delegation-list">
                                            {delegations.incoming.map(d => (
                                                <div key={d.id} className="delegation-item glass-card" style={{ padding: '0.8rem', marginBottom: '0.5rem' }}>
                                                    <div style={{ fontWeight: 'bold' }}>From: {d.owner_username}</div>
                                                    <div className="small text-muted">Expires: {new Date(d.expires_at).toLocaleString()}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
