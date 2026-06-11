import { useState, useEffect } from 'react';
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

export default function FormBuilderPage() {
    const { formId, versionId } = useParams();
    const navigate = useNavigate();
    const [fields, setFields] = useState([]);
    const [formName, setFormName] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [dynamicOptions, setDynamicOptions] = useState(DEFAULT_OPTIONS);

    useEffect(() => {
        const load = async () => {
            try {
                // Fetch dynamic branches from backend
                const branchesRes = await api.get('/autocomplete/branches');
                if (branchesRes.data.results && branchesRes.data.results.length > 0) {
                    setDynamicOptions(prev => ({ ...prev, branch: branchesRes.data.results }));
                }

                const [formRes, fieldsRes] = await Promise.all([
                    api.get('/forms'),
                    api.get(`/forms/${formId}/versions/${versionId}/fields`),
                ]);
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

    const addField = () => {
        setFields([...fields, emptyField()]);
        // Scroll to bottom after adding
        setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
    };

    const removeField = (index) => {
        setFields(fields.filter((_, i) => i !== index));
    };

    const moveField = (index, direction) => {
        const newFields = [...fields];
        const target = index + direction;
        if (target < 0 || target >= newFields.length) return;
        [newFields[index], newFields[target]] = [newFields[target], newFields[index]];
        setFields(newFields);
    };

    const duplicateField = (index) => {
        const fieldToCopy = fields[index];
        const newField = {
            ...fieldToCopy,
            _id: Date.now() + Math.random(), // New unique temporary ID
            label: `${fieldToCopy.label} (Copy)`
        };
        const newFields = [...fields];
        newFields.splice(index + 1, 0, newField);
        setFields(newFields);
    };

    const updateField = (index, key, value) => {
        const newFields = [...fields];
        newFields[index] = { ...newFields[index], [key]: value };
        // Auto-fill default options when switching to branch or duration
        if (key === 'type' && dynamicOptions[value]) {
            const existing = newFields[index].options_json || [];
            if (existing.length === 0) {
                newFields[index].options_json = [...dynamicOptions[value]];
            }
        }
        setFields(newFields);
    };

    const updateValidation = (index, key, value) => {
        const newFields = [...fields];
        newFields[index] = {
            ...newFields[index],
            validation_rules: { ...newFields[index].validation_rules, [key]: value },
        };
        setFields(newFields);
    };

    // Dropdown option helpers
    const addOption = (fieldIndex) => {
        const newFields = [...fields];
        const opts = [...(newFields[fieldIndex].options_json || []), ''];
        newFields[fieldIndex] = { ...newFields[fieldIndex], options_json: opts };
        setFields(newFields);
    };

    const updateOption = (fieldIndex, optIndex, value) => {
        const newFields = [...fields];
        const opts = [...(newFields[fieldIndex].options_json || [])];
        opts[optIndex] = value;
        newFields[fieldIndex] = { ...newFields[fieldIndex], options_json: opts };
        setFields(newFields);
    };

    const removeOption = (fieldIndex, optIndex) => {
        const newFields = [...fields];
        const opts = (newFields[fieldIndex].options_json || []).filter((_, i) => i !== optIndex);
        newFields[fieldIndex] = { ...newFields[fieldIndex], options_json: opts };
        setFields(newFields);
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage('');
        try {
            const payload = fields.map((f, i) => ({
                id: f.id || f._id, // Include existing ID if present
                label: f.label,
                type: f.type,
                options_json: (f.options_json || []).filter(o => o.trim() !== ''),
                field_order: i,
                validation_rules: f.validation_rules || {},
                is_unique: !!f.is_unique
            }));

            const res = await api.put(`/forms/${formId}/versions/${versionId}/fields`, { fields: payload });
            setFields(res.data.fields.map(f => ({ ...f, _id: f.id }))); // Synchronize IDs
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
            {/* Sticky header */}
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
                            <div key={field._id} className="field-card glass-card">
                                <div className="field-card-header">
                                    <span className="field-number">#{index + 1}</span>
                                    <div className="field-card-controls">
                                        <button className="btn btn-icon" onClick={() => moveField(index, -1)} disabled={index === 0} title="Move up">
                                            ▲
                                        </button>
                                        <button className="btn btn-icon" onClick={() => moveField(index, 1)} disabled={index === fields.length - 1} title="Move down">
                                            ▼
                                        </button>
                                        <button className="btn btn-icon" onClick={() => duplicateField(index)} title="Duplicate field">
                                            📋
                                        </button>
                                        <button className="btn btn-icon btn-danger-icon" onClick={() => removeField(index)} title="Remove field">
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
                                                onChange={(e) => updateField(index, 'label', e.target.value)}
                                                placeholder="Field label"
                                            />
                                        </div>

                                        <div className="form-group flex-1">
                                            <label>Type</label>
                                            <select
                                                className="form-input"
                                                value={field.type}
                                                onChange={(e) => updateField(index, 'type', e.target.value)}
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
                                                onChange={(e) => updateValidation(index, 'required', e.target.checked)}
                                            />
                                            <span className="toggle-text">Required field</span>
                                        </label>

                                        {/* Unique toggle */}
                                        <label className="field-toggle" title="Prevents duplicate entries for this field in this form">
                                            <input
                                                type="checkbox"
                                                checked={field.is_unique || false}
                                                onChange={(e) => updateField(index, 'is_unique', e.target.checked)}
                                            />
                                            <span className="toggle-text">Unique field (PIS, etc.)</span>
                                        </label>
                                    </div>
                                    {/* Options editor — for dropdown, multiple_choice, checkboxes, branch, duration */}
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
                                                            onChange={(e) => updateOption(index, optIdx, e.target.value)}
                                                            placeholder={`Option ${optIdx + 1}`}
                                                        />
                                                        <button
                                                            className="btn btn-icon btn-danger-icon"
                                                            onClick={() => removeOption(index, optIdx)}
                                                            title="Remove option"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                                <button className="btn btn-sm btn-secondary" onClick={() => addOption(index)}>
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
                                                <select className="form-input" value={field.validation_rules?.scale_min ?? 1} onChange={(e) => updateValidation(index, 'scale_min', Number(e.target.value))}>
                                                    <option value={0}>0</option>
                                                    <option value={1}>1</option>
                                                </select>
                                            </div>
                                            <div className="form-group flex-1">
                                                <label>Max (2–10)</label>
                                                <select className="form-input" value={field.validation_rules?.scale_max ?? 5} onChange={(e) => updateValidation(index, 'scale_max', Number(e.target.value))}>
                                                    {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
                                                </select>
                                            </div>
                                            <div className="form-group flex-1">
                                                <label>Min Label</label>
                                                <input type="text" className="form-input" value={field.validation_rules?.scale_min_label ?? ''} onChange={(e) => updateValidation(index, 'scale_min_label', e.target.value)} placeholder="e.g. Poor" />
                                            </div>
                                            <div className="form-group flex-1">
                                                <label>Max Label</label>
                                                <input type="text" className="form-input" value={field.validation_rules?.scale_max_label ?? ''} onChange={(e) => updateValidation(index, 'scale_max_label', e.target.value)} placeholder="e.g. Excellent" />
                                            </div>
                                        </div>
                                    )}

                                    {/* Rating config */}
                                    {field.type === 'rating' && (
                                        <div className="form-group flex-1">
                                            <label>Number of Stars</label>
                                            <select className="form-input" value={field.validation_rules?.max_stars ?? 5} onChange={(e) => updateValidation(index, 'max_stars', Number(e.target.value))}>
                                                {[3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} stars</option>)}
                                            </select>
                                        </div>
                                    )}


                                    {/* Integer / Number validation rules */}
                                    {field.type === 'integer' && (
                                        <div className="field-row">
                                            <div className="form-group flex-1">
                                                <label>Min Value</label>
                                                <input
                                                    type="number"
                                                    className="form-input"
                                                    value={field.validation_rules?.min ?? ''}
                                                    onChange={(e) => updateValidation(index, 'min', e.target.value ? Number(e.target.value) : undefined)}
                                                    placeholder="No min"
                                                />
                                            </div>
                                            <div className="form-group flex-1">
                                                <label>Max Value</label>
                                                <input
                                                    type="number"
                                                    className="form-input"
                                                    value={field.validation_rules?.max ?? ''}
                                                    onChange={(e) => updateValidation(index, 'max', e.target.value ? Number(e.target.value) : undefined)}
                                                    placeholder="No max"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Sticky bottom bar for mobile */}
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
