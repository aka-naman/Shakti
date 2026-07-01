import { useState, useEffect, useCallback, memo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';

const FIELD_TYPES = [
    { value: 'text', label: 'Short Answer', icon: '📝' },
    { value: 'textarea', label: 'Paragraph', icon: '📄' },
    { value: 'email', label: 'Email', icon: '📧' },
    { value: 'phone', label: 'Phone (10 digits)', icon: '📱' },
    { value: 'multiple_choice', label: 'Multiple Choice (MCQ)', icon: '☑️' },
    { value: 'checkboxes', label: 'Single Choice (Checkbox)', icon: '🔘' },
    { value: 'dropdown', label: 'Dropdown', icon: '📋' },
    { value: 'linear_scale', label: 'Linear Scale', icon: '📊' },
    { value: 'rating', label: 'Rating (Stars)', icon: '⭐' },
    { value: 'date', label: 'Date', icon: '📅' },
    { value: 'time', label: 'Time', icon: '🕐' },
    { value: 'integer', label: 'Number', icon: '🔢' },
    { value: 'branch', label: 'Branch / Stream', icon: '🎯' },
    { value: 'duration', label: 'Duration', icon: '⏱️' },
    { value: 'university_autocomplete', label: 'University Autocomplete', icon: '🎓' },
    { value: 'residential_address', label: 'Residential Address', icon: '🏠' },
    { value: 'bank_details', label: 'Bank Details', icon: '🏦' },
    { value: 'zone_group', label: 'Group (Zone-based)', icon: '🏢' },
    { value: 'cgpa_converter', label: 'CGPA to Percentage', icon: '🧮' },
    { value: 'running_balance', label: 'Running Balance', icon: '⚖️' },
    { value: 'data_link_trigger', label: 'Data Link Trigger (Autofill)', icon: '🔗' },
    { value: 'file_upload', label: 'Upload Document', icon: '📂' },
];

const DEFAULT_OPTIONS = {
    branch: [
        'Chemical Engineering (CE)',
        'Aerospace/Aeronautical Engineering (AER)',
        'Computer Science Engineering (CSE)',
        'Electronics & Communication Engineering (ECE)',
        'Instrumentation Engineering (INE)',
        'Mechanical Engineering (MEE)',
        'Civil Engineering (CIE)',
        'Electrical Engineering (ELE)',
    ],
    duration: [
        'January to June',
        'July to December',
        '3 months',
        '6 months',
    ],
};

const emptyField = () => ({
    _id: Date.now() + Math.random(),
    label: '',
    type: 'text',
    options_json: [],
    validation_rules: {},
});

// Memoized Field Card Component to prevent laggy typing
const FieldCard = memo(({ 
    field, 
    index, 
    allForms,
    allFields,
    onMove, 
    onDuplicate, 
    onRemove, 
    onUpdate, 
    onUpdateValidation,
    onAddOption,
    onUpdateOption,
    onRemoveOption
}) => {
    const [targetFields, setTargetFields] = useState([]);

    useEffect(() => {
        const fetchTargetFields = async () => {
            if (field.validation_rules?.data_link?.target_form_id) {
                try {
                    const res = await api.get(`/forms/${field.validation_rules.data_link.target_form_id}/versions/latest/fields`);
                    setTargetFields(res.data.fields);
                } catch (err) {
                    console.error('Failed to fetch target fields', err);
                }
            }
        };
        fetchTargetFields();
    }, [field.validation_rules?.data_link?.target_form_id]);

    const handleDataLinkChange = (key, value) => {
        const currentLink = field.validation_rules?.data_link || {};
        onUpdateValidation(index, 'data_link', { ...currentLink, [key]: value });
    };

    const addMappingRow = () => {
        const currentLink = field.validation_rules?.data_link || {};
        const mappings = [...(currentLink.mappings || []), { source: '', target: '' }];
        onUpdateValidation(index, 'data_link', { ...currentLink, mappings });
    };

    const updateMappingRow = (mIdx, key, value) => {
        const currentLink = field.validation_rules?.data_link || {};
        const mappings = [...(currentLink.mappings || [])];
        mappings[mIdx] = { ...mappings[mIdx], [key]: value };
        onUpdateValidation(index, 'data_link', { ...currentLink, mappings });
    };

    const removeMappingRow = (mIdx) => {
        const currentLink = field.validation_rules?.data_link || {};
        const mappings = currentLink.mappings.filter((_, i) => i !== mIdx);
        onUpdateValidation(index, 'data_link', { ...currentLink, mappings });
    };

    return (
        <div className="field-card glass-card">
            <div className="field-card-header">
                <span className="field-number">#{index + 1}</span>
                <div className="field-card-controls">
                    <button className="btn btn-icon" onClick={() => onMove(index, -1)} disabled={index === 0} title="Move up">
                        ▲
                    </button>
                    <button className="btn btn-icon" onClick={() => onMove(index, 1)} disabled={false} title="Move down">
                        ▼
                    </button>
                    <button className="btn btn-icon" onClick={() => onDuplicate(index)} title="Duplicate field">
                        📋
                    </button>
                    <button className="btn btn-icon btn-danger-icon" onClick={() => onRemove(index)} title="Remove field">
                        ✕
                    </button>
                </div>
            </div>

            <div className="field-card-body">
                <div className="field-row">
                    <div className="form-group flex-2">
                        <label>Label</label>
                        <input
                            type="text"
                            className="form-input"
                            value={field.label}
                            onChange={(e) => onUpdate(index, 'label', e.target.value)}
                            placeholder="Field label"
                        />
                    </div>

                    <div className="form-group flex-1">
                        <label>Type</label>
                        <select
                            className="form-input"
                            value={field.type}
                            onChange={(e) => onUpdate(index, 'type', e.target.value)}
                        >
                            {FIELD_TYPES.map(t => (
                                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="field-toggles">
                    {/* Required toggle */}
                    <label className="field-toggle">
                        <input
                            type="checkbox"
                            checked={field.validation_rules?.required || false}
                            onChange={(e) => onUpdateValidation(index, 'required', e.target.checked)}
                        />
                        <span className="toggle-text">Required field</span>
                    </label>

                    {/* Unique toggle */}
                    <label className="field-toggle" title="Prevents duplicate entries for this field in this form">
                        <input
                            type="checkbox"
                            checked={field.is_unique || false}
                            onChange={(e) => onUpdate(index, 'is_unique', e.target.checked)}
                        />
                        <span className="toggle-text">Unique field (PIS, etc.)</span>
                    </label>
                </div>

                {/* Running Balance Configuration (Ledger) */}
                {field.type === 'running_balance' && (
                    <div className="form-group running-balance-config glass-card" style={{ padding: '1rem', marginTop: '1rem', background: 'rgba(0,0,0,0.05)' }}>
                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>⚖️ Persistent Ledger Config</label>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                            The first submission establishes the Principle. Subsequent entries subtract from the remaining balance.
                        </p>
                        <div className="field-row">
                            <div className="form-group flex-1">
                                <label>Principle Amount Field</label>
                                <select 
                                    className="form-input"
                                    value={field.validation_rules?.balance_principle_field || ''}
                                    onChange={(e) => onUpdateValidation(index, 'balance_principle_field', e.target.value)}
                                >
                                    <option value="">Select Principle Field...</option>
                                    {allFields.filter((_, i) => i !== index).map(af => <option key={af._id} value={af.label}>{af.label}</option>)}
                                </select>
                            </div>
                            <div className="form-group flex-1">
                                <label>Deduction Field</label>
                                <select 
                                    className="form-input"
                                    value={field.validation_rules?.balance_transaction_field || ''}
                                    onChange={(e) => onUpdateValidation(index, 'balance_transaction_field', e.target.value)}
                                >
                                    <option value="">Select Deduction Field...</option>
                                    {allFields.filter((_, i) => i !== index).map(af => <option key={af._id} value={af.label}>{af.label}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="field-row">
                            <div className="form-group flex-1">
                                <label>Group By (Chain ID)</label>
                                <select 
                                    className="form-input"
                                    value={field.validation_rules?.balance_group_field || ''}
                                    onChange={(e) => onUpdateValidation(index, 'balance_group_field', e.target.value)}
                                >
                                    <option value="">Global (One Ledger)</option>
                                    {allFields.filter((_, i) => i !== index).map(af => <option key={af._id} value={af.label}>{af.label}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>
                )}

                {/* Data Link Trigger Configuration (Centralized Mapping) */}
                {field.type === 'data_link_trigger' && (
                    <div className="form-group data-link-config glass-card" style={{ padding: '1rem', marginTop: '1rem', background: 'rgba(0,0,0,0.05)' }}>
                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>🔗 Centralized Data Link (Autofill)</label>
                        <div className="field-row">
                            <div className="form-group flex-1">
                                <label>Target Form</label>
                                <select 
                                    className="form-input"
                                    value={field.validation_rules?.data_link?.target_form_id || ''}
                                    onChange={(e) => handleDataLinkChange('target_form_id', e.target.value)}
                                >
                                    <option value="">Select Target Form...</option>
                                    {allForms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                            </div>
                            {field.validation_rules?.data_link?.target_form_id && (
                                <div className="form-group flex-1">
                                    <label>Lookup Field in Target</label>
                                    <select 
                                        className="form-input"
                                        value={field.validation_rules?.data_link?.lookup_field || ''}
                                        onChange={(e) => handleDataLinkChange('lookup_field', e.target.value)}
                                    >
                                        <option value="">Select Lookup Field...</option>
                                        {targetFields.map(tf => <option key={tf.id} value={tf.label}>{tf.label}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>

                        {field.validation_rules?.data_link?.lookup_field && (
                            <div className="mapping-section" style={{ marginTop: '1rem' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Bulk Field Mappings</label>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                                    When this field is filled, the system will fetch data from the target form and populate the fields below.
                                </p>
                                {(field.validation_rules?.data_link?.mappings || []).map((m, mIdx) => (
                                    <div key={mIdx} className="field-row" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
                                        <select 
                                            className="form-input flex-1"
                                            value={m.source}
                                            onChange={(e) => updateMappingRow(mIdx, 'source', e.target.value)}
                                        >
                                            <option value="">Source (Target Form Field)</option>
                                            {targetFields.map(tf => <option key={tf.id} value={tf.label}>{tf.label}</option>)}
                                        </select>
                                        <span style={{ margin: '0 0.5rem' }}>➔</span>
                                        <select 
                                            className="form-input flex-1"
                                            value={m.target}
                                            onChange={(e) => updateMappingRow(mIdx, 'target', e.target.value)}
                                        >
                                            <option value="">Target (Current Form Field)</option>
                                            {allFields.filter((_, i) => i !== index).map(af => <option key={af._id} value={af.label}>{af.label}</option>)}
                                        </select>
                                        <button className="btn btn-icon btn-danger-icon" onClick={() => removeMappingRow(mIdx)}>✕</button>
                                    </div>
                                ))}
                                <button className="btn btn-sm btn-secondary" onClick={addMappingRow}>+ Add Mapping Row</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Options editor */}
                {['dropdown', 'multiple_choice', 'checkboxes', 'branch', 'duration'].includes(field.type) && (
                    <div className="form-group">
                        <label>Options</label>
                        <div className="dropdown-options-list">
                            {(field.options_json || []).map((opt, optIdx) => (
                                <div key={optIdx} className="dropdown-option-row">
                                    <span className="option-number">{optIdx + 1}.</span>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={opt}
                                        onChange={(e) => onUpdateOption(index, optIdx, e.target.value)}
                                        placeholder={`Option ${optIdx + 1}`}
                                    />
                                    <button
                                        className="btn btn-icon btn-danger-icon"
                                        onClick={() => onRemoveOption(index, optIdx)}
                                        title="Remove option"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                            <button className="btn btn-sm btn-secondary" onClick={() => onAddOption(index)}>
                                + Add Option
                            </button>
                        </div>
                    </div>
                )}

                {/* Linear Scale config */}
                {field.type === 'linear_scale' && (
                    <div className="field-row">
                        <div className="form-group flex-1">
                            <label>Min (0 or 1)</label>
                            <select className="form-input" value={field.validation_rules?.scale_min ?? 1} onChange={(e) => onUpdateValidation(index, 'scale_min', Number(e.target.value))}>
                                <option value={0}>0</option>
                                <option value={1}>1</option>
                            </select>
                        </div>
                        <div className="form-group flex-1">
                            <label>Max (2–10)</label>
                            <select className="form-input" value={field.validation_rules?.scale_max ?? 5} onChange={(e) => onUpdateValidation(index, 'scale_max', Number(e.target.value))}>
                                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>
                        <div className="form-group flex-1">
                            <label>Min Label</label>
                            <input type="text" className="form-input" value={field.validation_rules?.scale_min_label ?? ''} onChange={(e) => onUpdateValidation(index, 'scale_min_label', e.target.value)} placeholder="e.g. Poor" />
                        </div>
                        <div className="form-group flex-1">
                            <label>Max Label</label>
                            <input type="text" className="form-input" value={field.validation_rules?.scale_max_label ?? ''} onChange={(e) => onUpdateValidation(index, 'scale_max_label', e.target.value)} placeholder="e.g. Excellent" />
                        </div>
                    </div>
                )}

                {/* Rating config */}
                {field.type === 'rating' && (
                    <div className="form-group flex-1">
                        <label>Number of Stars</label>
                        <select className="form-input" value={field.validation_rules?.max_stars ?? 5} onChange={(e) => onUpdateValidation(index, 'max_stars', Number(e.target.value))}>
                            {[3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} stars</option>)}
                        </select>
                    </div>
                )}

                {/* Integer config */}
                {field.type === 'integer' && (
                    <div className="field-row">
                        <div className="form-group flex-1">
                            <label>Min Value</label>
                            <input
                                type="number"
                                className="form-input"
                                value={field.validation_rules?.min ?? ''}
                                onChange={(e) => onUpdateValidation(index, 'min', e.target.value ? Number(e.target.value) : undefined)}
                                placeholder="No min"
                            />
                        </div>
                        <div className="form-group flex-1">
                            <label>Max Value</label>
                            <input
                                type="number"
                                className="form-input"
                                value={field.validation_rules?.max ?? ''}
                                onChange={(e) => onUpdateValidation(index, 'max', e.target.value ? Number(e.target.value) : undefined)}
                                placeholder="No max"
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

export default function FormBuilderPage() {
    const { formId, versionId } = useParams();
    const navigate = useNavigate();
    const [fields, setFields] = useState([]);
    const [allForms, setAllForms] = useState([]);
    const [formName, setFormName] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [dynamicOptions, setDynamicOptions] = useState(DEFAULT_OPTIONS);

    useEffect(() => {
        const load = async () => {
            try {
                const branchesRes = await api.get('/autocomplete/branches');
                if (branchesRes.data.results && branchesRes.data.results.length > 0) {
                    setDynamicOptions(prev => ({ ...prev, branch: branchesRes.data.results }));
                }

                const [formRes, fieldsRes] = await Promise.all([
                    api.get('/forms'),
                    api.get(`/forms/${formId}/versions/${versionId}/fields`),
                ]);
                
                setAllForms(formRes.data.forms);
                const form = formRes.data.forms.find(f => f.id === parseInt(formId));
                if (form) setFormName(form.name);
                setFields(fieldsRes.data.fields.map(f => ({ ...f, _id: f.id })));
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [formId, versionId]);

    // HANDLERS (Memoized with useCallback)
    const addField = useCallback(() => {
        setFields(prev => [...prev, emptyField()]);
        setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
    }, []);

    const removeField = useCallback((index) => {
        setFields(prev => prev.filter((_, i) => i !== index));
    }, []);

    const moveField = useCallback((index, direction) => {
        setFields(prev => {
            const newFields = [...prev];
            const target = index + direction;
            if (target < 0 || target >= newFields.length) return prev;
            [newFields[index], newFields[target]] = [newFields[target], newFields[index]];
            return newFields;
        });
    }, []);

    const duplicateField = useCallback((index) => {
        setFields(prev => {
            const fieldToCopy = prev[index];
            const newField = {
                ...fieldToCopy,
                _id: Date.now() + Math.random(),
                label: `${fieldToCopy.label} (Copy)`
            };
            const newFields = [...prev];
            newFields.splice(index + 1, 0, newField);
            return newFields;
        });
    }, []);

    const updateField = useCallback((index, key, value) => {
        setFields(prev => {
            const newFields = [...prev];
            newFields[index] = { ...newFields[index], [key]: value };
            if (key === 'type' && dynamicOptions[value]) {
                const existing = newFields[index].options_json || [];
                if (existing.length === 0) {
                    newFields[index].options_json = [...dynamicOptions[value]];
                }
            }
            return newFields;
        });
    }, [dynamicOptions]);

    const updateValidation = useCallback((index, key, value) => {
        setFields(prev => {
            const newFields = [...prev];
            newFields[index] = {
                ...newFields[index],
                validation_rules: { ...newFields[index].validation_rules, [key]: value },
            };
            return newFields;
        });
    }, []);

    const addOption = useCallback((fieldIndex) => {
        setFields(prev => {
            const newFields = [...prev];
            const opts = [...(newFields[fieldIndex].options_json || []), ''];
            newFields[fieldIndex] = { ...newFields[fieldIndex], options_json: opts };
            return newFields;
        });
    }, []);

    const updateOption = useCallback((fieldIndex, optIndex, value) => {
        setFields(prev => {
            const newFields = [...prev];
            const opts = [...(newFields[fieldIndex].options_json || [])];
            opts[optIndex] = value;
            newFields[fieldIndex] = { ...newFields[fieldIndex], options_json: opts };
            return newFields;
        });
    }, []);

    const removeOption = useCallback((fieldIndex, optIndex) => {
        setFields(prev => {
            const newFields = [...prev];
            const opts = (newFields[fieldIndex].options_json || []).filter((_, i) => i !== optIndex);
            newFields[fieldIndex] = { ...newFields[fieldIndex], options_json: opts };
            return newFields;
        });
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setMessage('');
        try {
            const payload = fields.map((f, i) => ({
                id: f.id || f._id,
                label: f.label,
                type: f.type,
                options_json: (f.options_json || []).filter(o => o.trim() !== ''),
                field_order: i,
                validation_rules: f.validation_rules || {},
                is_unique: !!f.is_unique
            }));

            const res = await api.put(`/forms/${formId}/versions/${versionId}/fields`, { fields: payload });
            setFields(res.data.fields.map(f => ({ ...f, _id: f.id })));
            setMessage('✅ Saved successfully!');
            setTimeout(() => setMessage(''), 3000);
        } catch (err) {
            setMessage('❌ ' + (err.response?.data?.error || 'Save failed'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="loading-screen">
                <div className="spinner"></div>
                <p>Initialising अग्र-Sandhani...</p>
            </div>
        );
    }

    return (
        <div className="builder-page">
            <header className="builder-header sticky-header">
                <div className="header-left">
                    <button className="btn btn-ghost" onClick={() => navigate('/')}>
                        ← Back
                    </button>
                    <h1>✏️ {formName || 'अग्र-Sandhani Builder'}</h1>
                </div>
                <div className="header-right">
                    {message && <span className="save-message">{message}</span>}
                    <button className="btn btn-accent" onClick={addField}>
                        + Add Field
                    </button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? <span className="spinner-sm"></span> : '💾 Save Fields'}
                    </button>
                </div>
            </header>

            <div className="builder-content">
                <div className="builder-info">
                    <span className="field-count">{fields.length} field{fields.length !== 1 ? 's' : ''}</span>
                </div>

                {fields.length === 0 ? (
                    <div className="empty-state glass-card">
                        <div className="empty-icon">🧩</div>
                        <h2>No Fields Yet</h2>
                        <p>Click "Add Field" to start building your form.</p>
                    </div>
                ) : (
                    <div className="fields-list">
                        {fields.map((field, index) => (
                            <FieldCard 
                                key={field._id}
                                field={field}
                                index={index}
                                allForms={allForms}
                                allFields={fields}
                                onMove={moveField}
                                onDuplicate={duplicateField}
                                onRemove={removeField}
                                onUpdate={updateField}
                                onUpdateValidation={updateValidation}
                                onAddOption={addOption}
                                onUpdateOption={updateOption}
                                onRemoveOption={removeOption}
                                isLast={index === fields.length - 1}
                            />
                        ))}
                    </div>
                )}
            </div>

            <div className="builder-bottom-bar">
                <button className="btn btn-accent" onClick={addField}>
                    + Add Field
                </button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? <span className="spinner-sm"></span> : '💾 Save'}
                </button>
            </div>
        </div>
    );
}
