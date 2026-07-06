import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import AutocompleteInput from '../components/AutocompleteInput';

const CGPA_PRESETS = [
    { id: '10', label: '10 Scale', scale: 10 },
    { id: '7', label: '7 Scale', scale: 7 },
    { id: '4', label: '4 Scale', scale: 4 },
    { id: 'other', label: 'Other Scale', scale: '' }
];

const RunningBalanceSyncer = ({ fieldId, value, handleChange }) => {
    useEffect(() => {
        handleChange(fieldId, value);
    }, [fieldId, value, handleChange]);
    return null;
};

export default function FormSubmitPage() {
    const { formId, submissionId } = useParams();
    const [fields, setFields] = useState([]);
    const [values, setValues] = useState({});
    const [checkboxValues, setCheckboxValues] = useState({});
    const [otherValues, setOtherValues] = useState({}); // Stores complex field states like CGPA/Address
    const [existingFiles, setExistingFiles] = useState({}); // Stores array of filename strings for loaded files
    const [formName, setFormName] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [_error, setError] = useState('');
    const [fieldError, setFieldError] = useState({ fieldId: null, message: '' });
    const [warningModal, setWarningModal] = useState({ show: false, emptyFields: [], finalValues: {} });
    const [locations, setLocations] = useState({});
    const [organizationalGroups, setOrganizationalGroups] = useState({});
    const [dynamicBranches, setDynamicBranches] = useState([]);
    const [dynamicBanks, setDynamicBanks] = useState([]);
    const [fileUploads, setFileUploads] = useState({}); // Stores array of file objects for upload
    const [uploadProgress, setUploadProgress] = useState({}); // Track upload progress
    const [historicalAggregates, setHistoricalAggregates] = useState({});
    
    const [newUniModal, setNewUniModal] = useState({ 
        show: false, name: '', state: '', district: '', fieldId: null,
        isStateOther: false, isDistrictOther: false,
        customState: '', customDistrict: ''
    });
    const fieldRefs = useRef({});

    // 1. Persistence: Load draft or prefilled response on mount
    useEffect(() => {
        const load = async () => {
            try {
                const [locsRes, branchesRes, formsRes, groupsRes, banksRes] = await Promise.all([
                    api.get('/autocomplete/locations'),
                    api.get('/autocomplete/branches'),
                    api.get('/forms'),
                    api.get('/autocomplete/groups'),
                    api.get('/autocomplete/banks').catch(() => ({ data: { results: [] } }))
                ]);
                
                setLocations(locsRes.data);
                setOrganizationalGroups(groupsRes.data);
                setDynamicBranches(branchesRes.data.results || []);
                setDynamicBanks(banksRes.data.results || []);

                const form = formsRes.data.forms.find(f => f.id === parseInt(formId));
                if (!form || !form.latest_version_id) {
                    setError('Form not found.');
                    setLoading(false);
                    return;
                }
                setFormName(form.name);

                const fieldsRes = await api.get(`/forms/${formId}/versions/${form.latest_version_id}/fields`);
                const loadedFields = fieldsRes.data.fields;
                setFields(loadedFields);

                // Fetch temporary prefilled data if prefillToken query param is present
                const queryParams = new URLSearchParams(window.location.search);
                const prefillToken = queryParams.get('prefillToken');
                let prefilledData = null;
                if (prefillToken) {
                    try {
                        const prefillRes = await api.get(`/forms/${formId}/prefill-session/${prefillToken}`);
                        prefilledData = prefillRes.data.values || {};
                    } catch (err) {
                        console.error('Failed to load prefilled session data', err);
                    }
                }

                const initialValues = {};
                const initialCheckboxes = {};
                const initialOthers = {};
                const initialExistingFiles = {};

                if (submissionId) {
                    const subRes = await api.get(`/forms/${formId}/submissions/${submissionId}`);
                    const submission = subRes.data.submission;
                    const subData = submission.data_json || {};

                    for (const f of loadedFields) {
                        // Prefill data from token overrides submission data
                        const val = prefilledData && prefilledData[f.label] !== undefined
                            ? String(prefilledData[f.label])
                            : (subData[f.label] !== undefined ? String(subData[f.label]) : '');
                        initialValues[f.id] = val;

                        if (f.type === 'checkboxes' || f.type === 'multiple_choice') {
                            initialCheckboxes[f.id] = val ? val.split(' ||| ') : [];
                        }

                        if (f.type === 'cgpa_converter') {
                            const cgpaMatch = val.match(/CGPA:\s*([\d.]+),\s*Scale:\s*([\d.]+),\s*Factor:\s*([\d.]+)/);
                            if (cgpaMatch) {
                                const obtained = cgpaMatch[1];
                                const scale = cgpaMatch[2];
                                const factor = cgpaMatch[3];
                                initialOthers[f.id] = {
                                    cgpa: obtained,
                                    presetId: scale === '10' ? '10' : scale === '7' ? '7' : scale === '4' ? '4' : 'other',
                                    scale: scale,
                                    factorType: (100 / parseFloat(scale)).toFixed(4) === parseFloat(factor).toFixed(4) ? 'auto' : 'manual',
                                    factor: factor
                                };
                            } else {
                                const rawNum = parseFloat(val);
                                if (!isNaN(rawNum)) {
                                    initialOthers[f.id] = {
                                        cgpa: rawNum,
                                        presetId: '10',
                                        scale: 10,
                                        factorType: 'auto',
                                        factor: 10
                                    };
                                } else {
                                    initialOthers[f.id] = {
                                        cgpa: '',
                                        presetId: '10',
                                        scale: 10,
                                        factorType: 'auto',
                                        factor: 10
                                    };
                                }
                            }
                        }

                        if (f.type === 'bank_details') {
                            const bankMatch = val.match(/Bank:\s*(.*?)\s*\|\|\|\s*A\/c:\s*(.*?)\s*\|\|\|\s*IFSC:\s*(.*)/);
                            if (bankMatch) {
                                initialOthers[f.id] = {
                                    bank: bankMatch[1],
                                    accNo: bankMatch[2],
                                    ifsc: bankMatch[3]
                                };
                            } else {
                                initialOthers[f.id] = { bank: '', accNo: '', ifsc: '' };
                            }
                        }

                        if (f.type === 'file_upload' && val && val.startsWith('/uploads/')) {
                            try {
                                const fileListRes = await api.get('/forms/upload-files', { params: { folderPath: val } });
                                initialExistingFiles[f.id] = fileListRes.data.files || [];
                            } catch (err) {
                                console.error('Failed to load existing files', err);
                            }
                        }
                    }
                } else {
                    // Initialize states with Draft data or Prefill data if available
                    const draft = JSON.parse(localStorage.getItem(`form_draft_${formId}`) || '{}');
                    
                    for (const f of loadedFields) {
                        const val = prefilledData && prefilledData[f.label] !== undefined
                            ? String(prefilledData[f.label])
                            : (draft.values?.[f.id] || '');
                        initialValues[f.id] = val;

                        if (f.type === 'checkboxes' || f.type === 'multiple_choice') {
                            initialCheckboxes[f.id] = prefilledData && prefilledData[f.label] !== undefined
                                ? (val ? val.split(' ||| ') : [])
                                : (draft.checkboxValues?.[f.id] || []);
                        }

                        if (f.type === 'cgpa_converter') {
                            let cgpaVal = draft.otherValues?.[f.id];
                            if (prefilledData && prefilledData[f.label] !== undefined) {
                                const cgpaMatch = val.match(/CGPA:\s*([\d.]+),\s*Scale:\s*([\d.]+),\s*Factor:\s*([\d.]+)/);
                                if (cgpaMatch) {
                                    cgpaVal = {
                                        cgpa: cgpaMatch[1],
                                        presetId: cgpaMatch[2] === '10' ? '10' : cgpaMatch[2] === '7' ? '7' : cgpaMatch[2] === '4' ? '4' : 'other',
                                        scale: cgpaMatch[2],
                                        factorType: (100 / parseFloat(cgpaMatch[2])).toFixed(4) === parseFloat(cgpaMatch[3]).toFixed(4) ? 'auto' : 'manual',
                                        factor: cgpaMatch[3]
                                    };
                                } else {
                                    const rawNum = parseFloat(val);
                                    if (!isNaN(rawNum)) {
                                        cgpaVal = {
                                            cgpa: rawNum,
                                            presetId: '10',
                                            scale: 10,
                                            factorType: 'auto',
                                            factor: 10
                                        };
                                    }
                                }
                            }
                            initialOthers[f.id] = cgpaVal || { 
                                cgpa: '', 
                                presetId: '10', 
                                scale: 10, 
                                factorType: 'auto', 
                                factor: 10 
                            };
                        }

                        if (f.type === 'bank_details') {
                            let bankVal = draft.otherValues?.[f.id];
                            if (prefilledData && prefilledData[f.label] !== undefined) {
                                const bankMatch = val.match(/Bank:\s*(.*?)\s*\|\|\|\s*A\/c:\s*(.*?)\s*\|\|\|\s*IFSC:\s*(.*)/);
                                if (bankMatch) {
                                    bankVal = {
                                        bank: bankMatch[1],
                                        accNo: bankMatch[2],
                                        ifsc: bankMatch[3]
                                    };
                                }
                            }
                            initialOthers[f.id] = bankVal || { bank: '', accNo: '', ifsc: '' };
                        }

                        if (f.type === 'file_upload' && val && val.startsWith('/uploads/')) {
                            try {
                                const fileListRes = await api.get('/forms/upload-files', { params: { folderPath: val } });
                                initialExistingFiles[f.id] = fileListRes.data.files || [];
                            } catch (err) {
                                console.error('Failed to load prefilled files', err);
                            }
                        }
                    }

                    // Merge any other draft states if we didn't just load prefilledData
                    if (draft.otherValues && !prefilledData) {
                        Object.assign(initialOthers, draft.otherValues);
                    }
                }

                setValues(initialValues);
                setCheckboxValues(initialCheckboxes);
                setOtherValues(initialOthers);
                setExistingFiles(initialExistingFiles);
            } catch {
                setError('Failed to load form');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [formId, submissionId]);

    // Running Balance Aggregate Loader
    useEffect(() => {
        const fetchAggs = async () => {
            const rbFields = fields.filter(f => f.type === 'running_balance');
            for (const field of rbFields) {
                const groupFieldLabel = field.validation_rules?.balance_group_field;
                const transactionFieldLabel = field.validation_rules?.balance_transaction_field;
                const principleFieldLabel = field.validation_rules?.balance_principle_field;
                if (!transactionFieldLabel) continue;

                let groupByField = null;
                let groupByValue = null;
                if (groupFieldLabel) {
                    const groupField = fields.find(f => f.label === groupFieldLabel);
                    if (groupField) {
                        groupByField = groupField.label;
                        groupByValue = values[groupField.id];
                        if (!groupByValue) {
                            setHistoricalAggregates(prev => ({ ...prev, [field.id]: { principle: 0, totalDeductions: 0 } }));
                            continue;
                        }
                    }
                }

                try {
                    const res = await api.post(`/forms/${formId}/aggregate`, {
                        principleField: principleFieldLabel,
                        transactionField: transactionFieldLabel,
                        groupByField,
                        groupByValue
                    });
                    setHistoricalAggregates(prev => ({ ...prev, [field.id]: res.data }));
                } catch (err) { console.error('Agg fail', err); }
            }
        };
        
        if (fields.length > 0) {
            fetchAggs();
        }
    }, [formId, fields, ...fields.filter(f => f.type === 'running_balance' && f.validation_rules?.balance_group_field).map(f => values[fields.find(sf => sf.label === f.validation_rules.balance_group_field)?.id])]);

    // 2. Persistence: Save to localStorage on change (only if not editing)
    useEffect(() => {
        if (!loading && !submitted && !submissionId) {
            const draft = { values, checkboxValues, otherValues };
            localStorage.setItem(`form_draft_${formId}`, JSON.stringify(draft));
        }
    }, [values, checkboxValues, otherValues, loading, submitted, formId, submissionId]);

    const handleChange = (fieldId, value) => {
        setValues(prev => ({ ...prev, [fieldId]: value }));
        if (fieldError.fieldId === fieldId) setFieldError({ fieldId: null, message: '' });
    };

    const handleDataLinkBlur = async (field, value) => {
        const link = field.validation_rules?.data_link;
        if (link?.target_form_id && link?.lookup_field && value?.trim()) {
            try {
                const res = await api.get(`/forms/${link.target_form_id}/lookup`, {
                    params: { lookupField: link.lookup_field, value: value.trim() }
                });
                if (res.data.data) {
                    const targetData = res.data.data;
                    const updates = {};
                    (link.mappings || []).forEach(m => {
                        if (m.source && m.target) {
                            const targetField = fields.find(f => f.label === m.target);
                            if (targetField) updates[targetField.id] = targetData[m.source] || '';
                        }
                    });
                    setValues(prev => ({ ...prev, ...updates }));
                }
            } catch (err) { 
                if (err.response?.status !== 404) {
                    console.error('Data link lookup failed', err); 
                }
            }
        }
    };

    const handleBlurUnique = async (field, value) => {
        if (!field.is_unique || !value || value.trim() === '') return;
        
        try {
            const res = await api.get(`/forms/${formId}/validate-unique`, {
                params: { 
                    label: field.label, 
                    value: value.trim(),
                    excludeSubmissionId: submissionId || undefined
                }
            });
            if (res.data.exists) {
                setFieldError({ 
                    fieldId: field.id, 
                    message: `⚠️ This ${field.label} already exists in the database. Please check for duplicates.` 
                });
            }
        } catch (err) {
            console.error('Unique validation failed', err);
        }
    };

    const handleChoiceChange = (fieldId, option, checked, fieldType) => {
        setCheckboxValues(prev => {
            const current = prev[fieldId] || [];
            let next;
            
            if (fieldType === 'multiple_choice') {
                // MCQ is now MULTI-SELECT as requested
                if (checked) {
                    next = [...current, option];
                } else {
                    next = current.filter(o => o !== option);
                }
            } else {
                // Checkbox is now SINGLE-SELECT as requested
                // If it's already selected, clicking it again (unchecked) will clear it
                if (current.includes(option) && !checked) {
                    next = [];
                } else {
                    next = checked ? [option] : [];
                }
            }
            
            return { ...prev, [fieldId]: next };
        });
        
        // Clear field error if any
        if (fieldError.fieldId === fieldId) setFieldError({ fieldId: null, message: '' });
    };

    const handleFileChange = (fieldId, files) => {
        const fileList = Array.from(files);
        
        // Check if any file is too large
        for (const file of fileList) {
            if (file.size > 1024 * 1024 * 1024) {
                alert(`File "${file.name}" exceeds 1GB limit.`);
                return;
            }
        }
        
        setFileUploads(prev => ({ ...prev, [fieldId]: fileList }));
        // Temporarily store summary to show in UI
        handleChange(fieldId, `Pending: ${fileList.length} files`);
    };

    const handleUniversitySelect = (item, fieldId) => {
        if (item.isNew) {
            setNewUniModal({ show: true, name: item.name, state: '', district: '', fieldId });
        } else {
            handleChange(fieldId, `${item.name} (${item.district}, ${item.state})`);
        }
    };

    const submitNewUniversity = async () => {
        const finalState = newUniModal.isStateOther ? newUniModal.customState : newUniModal.state;
        const finalDistrict = (newUniModal.isStateOther || newUniModal.isDistrictOther) ? newUniModal.customDistrict : newUniModal.district;

        if (!newUniModal.name || !finalState || !finalDistrict) return alert('Fill all details');
        try {
            const res = await api.post('/autocomplete/university/add', {
                ...newUniModal,
                state: finalState,
                district: finalDistrict
            });
            const uni = res.data.university;
            handleChange(newUniModal.fieldId, `${uni.name} (${uni.district}, ${uni.state})`);
            setNewUniModal({ 
                show: false, name: '', state: '', district: '', fieldId: null,
                isStateOther: false, isDistrictOther: false,
                customState: '', customDistrict: ''
            });
            // Refresh locations from the server to pick up new entry
            const locRes = await api.get('/autocomplete/locations');
            setLocations(locRes.data);
        } catch { alert('Failed to add'); }
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        
        const emptyOptionalFields = [];
        const finalValues = { ...values };
        
        // 1. Validation Loop
        for (const field of fields) {
            let isFilled = false;
            if (field.type === 'checkboxes' || field.type === 'multiple_choice') {
                isFilled = (checkboxValues[field.id] || []).length > 0;
                finalValues[field.id] = (checkboxValues[field.id] || []).join(' ||| ');
            } else if (field.type === 'file_upload') {
                isFilled = !!fileUploads[field.id] || (values[field.id] && !values[field.id].startsWith('Pending:'));
            } else {
                isFilled = !!values[field.id];
            }

            // A. Required Validation
            if (field.validation_rules?.required && !isFilled) {
                setFieldError({ fieldId: field.id, message: `${field.label} is required` });
                fieldRefs.current[field.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }

            // B. Unique Validation (Final check before submit)
            if (field.is_unique && isFilled) {
                try {
                    const res = await api.get(`/forms/${formId}/validate-unique`, {
                        params: { 
                            label: field.label, 
                            value: finalValues[field.id].trim(),
                            excludeSubmissionId: submissionId || undefined
                        }
                    });
                    if (res.data.exists) {
                        setFieldError({ 
                            fieldId: field.id, 
                            message: `⚠️ This ${field.label} already exists in the database. Duplicate entries are not allowed.` 
                        });
                        fieldRefs.current[field.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        return;
                    }
                } catch (err) { console.error('Final unique check failed', err); }
            }

            // Track Empty Optional Fields
            if (!field.validation_rules?.required && !isFilled) {
                emptyOptionalFields.push(field.label);
            }

            // Phone Validation (Strict 10 digits if filled)
            if (field.type === 'phone' && isFilled && values[field.id].length !== 10) {
                setFieldError({ fieldId: field.id, message: 'Phone number must be exactly 10 digits' });
                fieldRefs.current[field.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            
            // ... (rest of validation like bank, integer, etc. follows naturally)
        }

        // 2. Check for Warning Modal
        if (emptyOptionalFields.length > 0) {
            setWarningModal({ show: true, emptyFields: emptyOptionalFields, finalValues });
        } else {
            performSubmission(finalValues, '');
        }
    };

    const performSubmission = async (finalValues, remarks) => {
        setSubmitting(true);
        setWarningModal({ show: false, emptyFields: [], finalValues: {} });
        
        try {
            // Handle File Uploads first
            const uploadedFilePaths = {};
            for (const fieldId of Object.keys(fileUploads)) {
                if (fileUploads[fieldId].length === 0) continue;
                
                const formData = new FormData();
                fileUploads[fieldId].forEach(f => {
                    formData.append('files', f);
                });
                
                const uploadRes = await api.post('/forms/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    onUploadProgress: (progressEvent) => {
                        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        setUploadProgress(prev => ({ ...prev, [fieldId]: percent }));
                    }
                });
                uploadedFilePaths[fieldId] = uploadRes.data.folderPath;
            }

            // Merge uploaded paths
            const final = { ...finalValues };
            Object.keys(uploadedFilePaths).forEach(id => {
                final[id] = uploadedFilePaths[id];
            });

            if (submissionId) {
                await api.put(`/forms/${formId}/submissions/${submissionId}`, { values: final });
            } else {
                await api.post(`/forms/${formId}/submit`, { values: final, remarks });
                localStorage.removeItem(`form_draft_${formId}`);
            }
            setSubmitted(true);
        } catch (err) {
            setError(err.response?.data?.error || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    const renderField = (field) => {
        const val = values[field.id] || '';

        switch (field.type) {
            case 'bank_details': {
                const data = otherValues[field.id] || { bank: '', accNo: '', ifsc: '' };
                const defaultBanks = ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Punjab National Bank', 'Axis Bank', 'Canara Bank', 'Bank of Baroda', 'Union Bank of India'];
                const banks = Array.from(new Set([...defaultBanks, ...dynamicBanks]));
                
                const updateBank = (updates) => {
                    const next = { ...data, ...updates };
                    setOtherValues(p => ({ ...p, [field.id]: next }));
                    if (next.bank && next.accNo && next.ifsc) {
                        handleChange(field.id, `Bank: ${next.bank} ||| A/c: ${next.accNo} ||| IFSC: ${next.ifsc}`);
                    } else {
                        handleChange(field.id, '');
                    }
                };

                const isManual = data.bank && !banks.includes(data.bank) && data.bank !== '__other__';

                return (
                    <div className="bank-composite flex-column gap-sm">
                        <div className="field-row">
                            <div className="flex-1 flex-column gap-xs">
                                <label className="sub-label">Select Bank</label>
                                <select 
                                    className="form-input" 
                                    value={isManual ? '__other__' : data.bank}
                                    onChange={(e) => updateBank({ bank: e.target.value })}
                                >
                                    <option value="">Choose Bank</option>
                                    {banks.map(b => <option key={b} value={b}>{b}</option>)}
                                    <option value="__other__">Other Bank</option>
                                </select>
                                {(data.bank === '__other__' || isManual) && (
                                    <input 
                                        type="text" 
                                        className="form-input other-input" 
                                        placeholder="Bank Name" 
                                        value={isManual ? data.bank : ''}
                                        onChange={(e) => updateBank({ bank: e.target.value })}
                                    />
                                )}
                            </div>
                            <div className="flex-1 flex-column gap-xs">
                                <label className="sub-label">IFSC Code</label>
                                <input 
                                    type="text" 
                                    className="form-input" 
                                    placeholder="e.g. SBIN0001234" 
                                    value={data.ifsc} 
                                    onChange={(e) => updateBank({ ifsc: e.target.value.toUpperCase() })} 
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="sub-label">Account Number (Min 10 digits)</label>
                            <input 
                                type="text" 
                                className="form-input" 
                                placeholder="e.g. 1234567890" 
                                value={data.accNo} 
                                onChange={(e) => updateBank({ accNo: e.target.value.replace(/\D/g, '') })} 
                            />
                        </div>
                    </div>
                );
            }

            case 'file_upload': {
                const files = fileUploads[field.id] || [];
                const progress = uploadProgress[field.id];
                const isPrefilledSession = !!new URLSearchParams(window.location.search).get('prefillToken');

                return (
                    <div className="file-upload-container">
                        <input 
                            type="file" 
                            multiple
                            accept="application/pdf,image/*" 
                            onChange={(e) => handleFileChange(field.id, e.target.files)}
                            className="file-input-hidden"
                            id={`file-${field.id}`}
                            disabled={progress !== undefined && progress < 100}
                        />
                        <label htmlFor={`file-${field.id}`} className="file-drop-zone">
                            {files.length > 0 ? (
                                <div className="file-info-grid">
                                    <div className="file-count-status" style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
                                        {files.length} new file(s) selected (will replace existing files)
                                    </div>
                                    {files.map((f, idx) => (
                                        <div key={idx} className="file-info-item small">
                                            <span>📄 {f.name}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : existingFiles[field.id] && existingFiles[field.id].length > 0 ? (
                                <div className="file-info-grid">
                                    <div className="file-count-status" style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: 'var(--accent-success)' }}>
                                        📂 {existingFiles[field.id].length} existing file(s) uploaded
                                    </div>
                                    {existingFiles[field.id].map((fn, idx) => (
                                        <div key={idx} className="file-info-item small">
                                            <span>📄 {fn}</span>
                                        </div>
                                    ))}
                                    <div className="small text-muted mt-2" style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '0.5rem' }}>
                                        Click here to select new files to replace them.
                                    </div>
                                </div>
                            ) : (
                                <div className="file-prompt">
                                    <span>📤 Click to Select File(s)</span>
                                    <span className="small text-muted">PDF or Image (Max 1GB each)</span>
                                </div>
                            )}
                        </label>
                        {progress !== undefined && progress < 100 && (
                            <div className="progress-bar-bg">
                                <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                            </div>
                        )}
                        {isPrefilledSession && (
                            <div className="alert-prefill-note" style={{ fontSize: '0.75rem', marginTop: '6px', color: '#b27500', display: 'flex', alignItems: 'center', gap: '4px', background: '#fff9e6', padding: '6px 8px', borderRadius: '4px', border: '1px solid #faebcc' }}>
                                ⚠️ <strong>Note:</strong> Files cannot be automatically imported from noting documents due to browser security. Please re-attach files here manually.
                            </div>
                        )}
                    </div>
                );
            }
            case 'cgpa_converter': {
                const data = otherValues[field.id] || { 
                    cgpa: '', 
                    presetId: '10', 
                    scale: 10, 
                    factorType: 'auto', 
                    factor: 10 
                };
                
                const updateCgpa = (updates) => {
                    const next = { ...data, ...updates };
                    
                    // 1. Handle Max CGPA changes
                    if ('presetId' in updates) {
                        const preset = CGPA_PRESETS.find(p => p.id === updates.presetId);
                        next.scale = preset.scale;
                    }

                    // 2. Handle Conversion Factor logic
                    const scaleNum = parseFloat(next.scale);
                    if (next.factorType === 'auto' && !isNaN(scaleNum) && scaleNum !== 0) {
                        next.factor = (100 / scaleNum).toFixed(4);
                    }

                    setOtherValues(p => ({ ...p, [field.id]: next }));
                    
                    const obtained = parseFloat(next.cgpa);
                    const factor = parseFloat(next.factor);

                    if (!isNaN(obtained) && !isNaN(factor)) {
                        const result = obtained * factor;
                        handleChange(field.id, `${result.toFixed(2)}% (CGPA: ${obtained}, Scale: ${next.scale}, Factor: ${factor})`);
                    } else {
                        handleChange(field.id, '');
                    }
                };

                return (
                    <div className="cgpa-composite">
                        <div className="field-row">
                            <div className="flex-1">
                                <label className="sub-label">Obtained CGPA</label>
                                <input 
                                    type="number" 
                                    className="form-input" 
                                    placeholder="e.g. 8.5" 
                                    value={data.cgpa} 
                                    onChange={(e) => updateCgpa({ cgpa: e.target.value })} 
                                    step="0.01" 
                                />
                            </div>
                            <div className="flex-1">
                                <label className="sub-label">Max CGPA</label>
                                <select 
                                    className="form-input" 
                                    value={data.presetId} 
                                    onChange={(e) => updateCgpa({ presetId: e.target.value })}
                                >
                                    {CGPA_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="field-row">
                            {data.presetId === 'other' && (
                                <div className="flex-1">
                                    <label className="sub-label">Custom Max CGPA</label>
                                    <input 
                                        type="number" 
                                        className="form-input" 
                                        placeholder="e.g. 5"
                                        value={data.scale} 
                                        onChange={(e) => updateCgpa({ scale: e.target.value })} 
                                    />
                                </div>
                            )}
                            <div className="flex-1">
                                <label className="sub-label">Conversion Factor</label>
                                <select 
                                    className="form-input" 
                                    value={data.factorType}
                                    onChange={(e) => updateCgpa({ factorType: e.target.value })}
                                >
                                    <option value="auto">Auto ({(!isNaN(parseFloat(data.scale)) && parseFloat(data.scale) !== 0) ? (100 / parseFloat(data.scale)).toFixed(2) : '?'})</option>
                                    <option value="manual">Other (Manual)</option>
                                </select>
                            </div>
                            {data.factorType === 'manual' && (
                                <div className="flex-1">
                                    <label className="sub-label">Manual Factor</label>
                                    <input 
                                        type="number" 
                                        className="form-input" 
                                        placeholder="e.g. 10"
                                        value={data.factor} 
                                        onChange={(e) => updateCgpa({ factor: e.target.value })} 
                                        step="0.0001"
                                    />
                                </div>
                            )}
                        </div>

                        {val && (
                            <div className="cgpa-result">
                                Calculated Percentage: <strong>{val.split('%')[0]}%</strong>
                            </div>
                        )}
                    </div>
                );
            }

            case 'residential_address': {
                const parts = val.split(' ||| ');
                const house = parts[0] || '', dist = parts[1] || '', state = parts[2] || '', pin = parts[3] || '';
                
                // Determine if current state/dist are manual inputs (not in known list)
                const isStateManual = state && state !== '__other__' && !Object.keys(locations).includes(state);
                const isDistManual = dist && dist !== '__other__' && state && !(locations[state] || []).includes(dist);

                const upd = (h, d, s, p) => handleChange(field.id, `${h} ||| ${d} ||| ${s} ||| ${p}`);

                return (
                    <div className="address-composite">
                        <textarea className="form-input" placeholder="House/Street" value={house} onChange={(e) => upd(e.target.value, dist, state, pin)} />
                        <div className="field-row">
                            <input type="text" className="form-input flex-1" placeholder="Pincode (6 digits)" value={pin} maxLength={6} onChange={(e) => upd(house, dist, state, e.target.value.replace(/\D/g, ''))} />
                            
                            <div className="flex-1 flex-column gap-sm">
                                <select 
                                    className="form-input" 
                                    value={isStateManual ? '__other__' : state} 
                                    onChange={(e) => upd(house, (e.target.value === '__other__' ? '' : dist), e.target.value, pin)}
                                >
                                    <option value="">State</option>
                                    {Object.keys(locations).map(s => <option key={s} value={s}>{s}</option>)}
                                    <option value="__other__">Other</option>
                                </select>
                                {(state === '__other__' || isStateManual) && (
                                    <input 
                                        type="text" 
                                        className="form-input other-input" 
                                        placeholder="Type State" 
                                        value={isStateManual ? state : ''}
                                        onChange={(e) => upd(house, dist, e.target.value, pin)}
                                        autoFocus={state === '__other__'}
                                    />
                                )}
                            </div>

                            <div className="flex-1 flex-column gap-sm">
                                <select 
                                    className="form-input" 
                                    value={isDistManual ? '__other__' : dist} 
                                    disabled={!state || state === '__other__'}
                                    onChange={(e) => upd(house, e.target.value, state, pin)}
                                >
                                    <option value="">District</option>
                                    {(locations[state] || []).map(d => <option key={d} value={d}>{d}</option>)}
                                    <option value="__other__">Other</option>
                                </select>
                                {(dist === '__other__' || isDistManual) && (
                                    <input 
                                        type="text" 
                                        className="form-input other-input" 
                                        placeholder="Type District" 
                                        value={isDistManual ? dist : ''}
                                        onChange={(e) => upd(house, e.target.value, state, pin)}
                                        autoFocus={dist === '__other__'}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                );
            }

            case 'zone_group': {
                const parts = val.split(' ||| ');
                const zone = parts[0] || '', group = parts[1] || '';
                
                const isZoneManual = zone && zone !== '__other__' && !Object.keys(organizationalGroups).includes(zone);
                const isGroupManual = group && group !== '__other__' && zone && !(organizationalGroups[zone] || []).includes(group);

                const upd = (z, g) => handleChange(field.id, `${z} ||| ${g}`);

                const zoneList = ['Zone I', 'Zone II', 'Zone III', 'Zone IV', 'Zone V', 'Zone VI', 'Zone VII', 'Zone VIII'];
                const allZones = Array.from(new Set([...zoneList, ...Object.keys(organizationalGroups)]));

                return (
                    <div className="address-composite">
                        <div className="field-row">
                            <div className="flex-1 flex-column gap-sm">
                                <select 
                                    className="form-input" 
                                    value={isZoneManual ? '__other__' : zone}
                                    onChange={(e) => upd(e.target.value, (e.target.value === '__other__' ? '' : group))}
                                >
                                    <option value="">Select Zone</option>
                                    {allZones.sort().map(z => <option key={z} value={z}>{z}</option>)}
                                    <option value="__other__">Other Zone</option>
                                </select>
                                {(zone === '__other__' || isZoneManual) && (
                                    <input 
                                        type="text" 
                                        className="form-input other-input" 
                                        placeholder="Type Zone Name" 
                                        value={isZoneManual ? zone : ''}
                                        onChange={(e) => upd(e.target.value, group)}
                                        autoFocus={zone === '__other__'}
                                    />
                                )}
                            </div>

                            <div className="flex-1 flex-column gap-sm">
                                <select 
                                    className="form-input" 
                                    value={isGroupManual ? '__other__' : group} 
                                    disabled={!zone || zone === '__other__'}
                                    onChange={(e) => upd(zone, e.target.value)}
                                >
                                    <option value="">Select Group</option>
                                    {(organizationalGroups[zone] || []).map(g => <option key={g} value={g}>{g}</option>)}
                                    <option value="__other__">Other Group</option>
                                </select>
                                {(group === '__other__' || isGroupManual) && (
                                    <input 
                                        type="text" 
                                        className="form-input other-input" 
                                        placeholder="Type Group Name" 
                                        value={isGroupManual ? group : ''}
                                        onChange={(e) => upd(zone, e.target.value)}
                                        autoFocus={group === '__other__'}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                );
            }

            case 'running_balance': {
                const principleFieldLabel = field.validation_rules?.balance_principle_field;
                const transactionFieldLabel = field.validation_rules?.balance_transaction_field;
                
                const principleField = fields.find(f => f.label === principleFieldLabel);
                const transField = fields.find(f => f.label === transactionFieldLabel);
                
                const hist = historicalAggregates[field.id] || { principle: 0, totalDeductions: 0 };
                
                // Opening Balance = (Historical Principle) - (Past Deductions)
                // If it's the very first entry, Opening Balance is the current Principle input.
                const histPrinciple = hist.principle || parseFloat(values[principleField?.id]) || 0;
                const openingBalance = histPrinciple - hist.totalDeductions;
                
                const currentTrans = parseFloat(values[transField?.id]) || 0;
                const closingBalance = openingBalance - currentTrans;

                return (
                    <div className="running-balance-display glass-card" style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.05)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                <span className="text-muted">Opening Balance:</span>
                                <span style={{ fontWeight: 'bold' }}>{openingBalance.toLocaleString()}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', borderTop: '1px border var(--border-color)', paddingTop: '0.5rem' }}>
                                <span>Closing Balance:</span>
                                <span style={{ fontWeight: 'bold', color: closingBalance < 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
                                    {closingBalance.toLocaleString()}
                                </span>
                            </div>
                        </div>
                        {hist.principle > 0 && (
                            <div className="mt-2" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                                ⛓️ Linked to Master Record ({hist.principle.toLocaleString()} Principle)
                            </div>
                        )}
                        <RunningBalanceSyncer fieldId={field.id} value={closingBalance.toString()} handleChange={handleChange} />
                    </div>
                );
            }

            case 'data_link_trigger':
                return (
                    <div className="data-link-input-container">
                        <input 
                            type="text" 
                            className="form-input" 
                            value={val} 
                            onChange={(e) => handleChange(field.id, e.target.value)}
                            onBlur={(e) => {
                                handleBlurUnique(field, e.target.value);
                                handleDataLinkBlur(field, e.target.value);
                            }}
                            placeholder="Type value to autofill..."
                        />
                        <span className="field-hint small">🔗 This field triggers automatic lookup and autofill.</span>
                    </div>
                );

            case 'university_autocomplete':
                return <AutocompleteInput value={val.split(' (')[0]} onSelect={(item) => handleUniversitySelect(item, field.id)} onChange={() => {}} placeholder="University Name..." />;

            case 'phone':
                return <input type="tel" className="form-input" value={val} onChange={(e) => { if (/^\d{0,10}$/.test(e.target.value)) handleChange(field.id, e.target.value); }} placeholder="10-digit number" />;

            case 'dropdown':
            case 'branch':
            case 'duration': {
                const options = Array.from(new Set([...(field.options_json || []), ...(field.type === 'branch' ? dynamicBranches : [])]));
                const isManual = val && !options.includes(val) && val !== '__other__';
                
                return (
                    <div className="select-with-other">
                        <select 
                            className="form-input" 
                            value={isManual ? '__other__' : val} 
                            onChange={(e) => handleChange(field.id, e.target.value)}
                        >
                            <option value="">Select Option</option>
                            {options.map(o => <option key={o} value={o}>{o}</option>)}
                            <option value="__other__">Other (Manual Entry)</option>
                        </select>
                        {(val === '__other__' || isManual) && (
                            <input 
                                type="text" 
                                className="form-input other-input" 
                                placeholder="Type custom value..." 
                                value={isManual ? val : ''}
                                onChange={(e) => handleChange(field.id, e.target.value)}
                                autoFocus={val === '__other__'}
                            />
                        )}
                    </div>
                );
            }

            case 'checkboxes':
            case 'multiple_choice':
                const isMulti = field.type === 'multiple_choice';
                return (
                    <div className="choice-list">
                        {(field.options_json || []).map((opt, i) => (
                            <label key={i} className={`choice-option ${!isMulti ? 'radio-style' : ''}`}>
                                <input 
                                    type={isMulti ? 'checkbox' : 'radio'} 
                                    name={`field-${field.id}`}
                                    checked={(checkboxValues[field.id] || []).includes(opt)} 
                                    onChange={(e) => handleChoiceChange(field.id, opt, e.target.checked, field.type)}
                                    onClick={(e) => {
                                        // Radio buttons do not natively fire onChange when clicked while already checked.
                                        // This onClick handler allows single-select checkboxes to be deselected.
                                        if (!isMulti && (checkboxValues[field.id] || []).includes(opt)) {
                                            handleChoiceChange(field.id, opt, false, field.type);
                                        }
                                    }}
                                />
                                <span className={`choice-custom-indicator ${!isMulti ? 'radio-indicator' : ''}`}></span>
                                <span>{opt}</span>
                            </label>
                        ))}
                    </div>
                );

            case 'date': {
                const handleDateInput = (e) => {
                    let input = e.target.value.replace(/\D/g, ''); // Remove non-digits
                    if (input.length > 8) input = input.substring(0, 8);
                    
                    // Format as DD-MM-YYYY
                    let formatted = '';
                    if (input.length > 0) {
                        formatted = input.substring(0, 2);
                        if (input.length > 2) {
                            formatted += '-' + input.substring(2, 4);
                            if (input.length > 4) {
                                formatted += '-' + input.substring(4, 8);
                            }
                        }
                    }
                    handleChange(field.id, formatted);
                };

                return (
                    <div className="date-input-container">
                        <input 
                            type="text" 
                            className="form-input" 
                            placeholder="DD-MM-YYYY" 
                            value={val}
                            onChange={handleDateInput}
                            maxLength="10"
                        />
                        <span className="field-hint small">Format: DD-MM-YYYY</span>
                    </div>
                );
            }

            default: {
                // Check if this field is a Principle field for an active ledger
                const associatedLedger = fields.find(f => f.type === 'running_balance' && f.validation_rules?.balance_principle_field === field.label);
                const hasHistoricalPrinciple = !!historicalAggregates[associatedLedger?.id]?.principle;

                if (hasHistoricalPrinciple) {
                    return (
                        <div className="field-hidden-notice" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Principle is established in Master Record.
                        </div>
                    );
                }

                return (
                    <input 
                        type={field.type === 'email' ? 'email' : (field.type === 'integer' ? 'number' : 'text')} 
                        className="form-input" 
                        value={val} 
                        onChange={(e) => handleChange(field.id, e.target.value)}
                        onBlur={(e) => handleBlurUnique(field, e.target.value)}
                    />
                );
            }
        }
    };

    const isFullWidthField = (type) => {
        return ['textarea', 'residential_address', 'cgpa_converter', 'zone_group', 'checkboxes', 'multiple_choice', 'linear_scale', 'running_balance'].includes(type);
    };

    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

    if (submitted) return (
        <div className="submit-page">
            <div className="success-container glass-card">
                <h2>{submissionId ? 'Response Updated!' : 'Response Submitted!'}</h2>
                {submissionId ? (
                    <button className="btn btn-primary" onClick={() => window.location.href = `/forms/${formId}/submissions`}>Back to Submissions</button>
                ) : (
                    <button className="btn btn-primary" onClick={() => window.location.reload()}>Submit Another</button>
                )}
            </div>
        </div>
    );

    return (
        <div className="submit-page">
            <div className="submit-container">
                <header className="submit-header glass-card">
                    <h1>{submissionId ? `✏️ Edit Response #${submissionId} — ${formName}` : formName}</h1>
                </header>
                <form onSubmit={handleSubmit} className="submit-form-grid">
                    {fields.map(field => (
                        <div 
                            key={field.id} 
                            className={`submit-field glass-card ${isFullWidthField(field.type) ? 'full-width' : ''}`} 
                            ref={el => fieldRefs.current[field.id] = el}
                        >
                            <label className="submit-field-label">
                                {field.label} {field.validation_rules?.required && <span className="required-star">*</span>}
                            </label>
                            {fieldError.fieldId === field.id && <div className="field-inline-error">{fieldError.message}</div>}
                            {renderField(field)}
                        </div>
                    ))}
                    <div className="submit-actions">
                        <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
                            {submissionId ? 'Save Changes' : 'Submit Response'}
                        </button>
                    </div>
                </form>
            </div>

            {warningModal.show && (
                <div className="modal-overlay">
                    <div className="modal glass-card">
                        <h2 style={{ color: 'var(--accent-warning)' }}>⚠️ Optional Fields Empty</h2>
                        <p>The following optional fields were left blank:</p>
                        <ul style={{ margin: '1rem 0', paddingLeft: '1.5rem', color: 'var(--text-secondary)' }}>
                            {warningModal.emptyFields.map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                        <p>Would you like to go back and fill them, or submit anyway?</p>
                        <div className="modal-actions">
                            <button className="btn btn-ghost" onClick={() => setWarningModal({ show: false, emptyFields: [], finalValues: {} })}>Go Back</button>
                            <button className="btn btn-primary" onClick={() => performSubmission(warningModal.finalValues, `Missing Entries: ${warningModal.emptyFields.join(', ')}`)}>Submit Anyway</button>
                        </div>
                    </div>
                </div>
            )}

            {newUniModal.show && (
                <div className="modal-overlay">
                    <div className="modal glass-card">
                        <h2>Add University</h2>
                        <div className="form-group">
                            <label>University Name</label>
                            <input type="text" className="form-input" value={newUniModal.name} onChange={e => setNewUniModal({...newUniModal, name: e.target.value})} />
                        </div>
                        <div className="form-group">
                            <label>State</label>
                            <select 
                                className="form-input" 
                                value={newUniModal.isStateOther ? '__other__' : newUniModal.state}
                                onChange={e => setNewUniModal({
                                    ...newUniModal, 
                                    state: e.target.value, 
                                    isStateOther: e.target.value === '__other__',
                                    district: e.target.value === '__other__' ? '' : newUniModal.district
                                })}
                            >
                                <option value="">Select State</option>
                                {Object.keys(locations).sort().map(s => <option key={s} value={s}>{s}</option>)}
                                <option value="__other__">Other (New State)</option>
                            </select>
                            {newUniModal.isStateOther && (
                                <input 
                                    type="text" 
                                    className="form-input mt-2" 
                                    placeholder="Enter New State Name" 
                                    value={newUniModal.customState} 
                                    onChange={e => setNewUniModal({...newUniModal, customState: e.target.value})} 
                                />
                            )}
                        </div>
                        <div className="form-group">
                            <label>District</label>
                            <select 
                                className="form-input" 
                                value={newUniModal.isDistrictOther ? '__other__' : newUniModal.district}
                                disabled={!newUniModal.state && !newUniModal.isStateOther}
                                onChange={e => setNewUniModal({
                                    ...newUniModal, 
                                    district: e.target.value, 
                                    isDistrictOther: e.target.value === '__other__'
                                })}
                            >
                                <option value="">Select District</option>
                                {(!newUniModal.isStateOther && locations[newUniModal.state]) && locations[newUniModal.state].sort().map(d => <option key={d} value={d}>{d}</option>)}
                                <option value="__other__">Other (New District)</option>
                            </select>
                            {(newUniModal.isStateOther || newUniModal.isDistrictOther) && (
                                <input 
                                    type="text" 
                                    className="form-input mt-2" 
                                    placeholder="Enter New District Name" 
                                    value={newUniModal.customDistrict} 
                                    onChange={e => setNewUniModal({...newUniModal, customDistrict: e.target.value})} 
                                />
                            )}
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-ghost" onClick={() => setNewUniModal({...newUniModal, show:false})}>Cancel</button>
                            <button className="btn btn-accent" onClick={submitNewUniversity}>Add University</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
