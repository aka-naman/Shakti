import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import api from '../api/client';
import '../styles/admin-dashboard.css';

export default function AdminDashboardPage() {
    const [stats, setStats] = useState(null);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [logsLoading, setLogsLoading] = useState(false);
    
    const [activeTab, setActiveTab] = useState('users'); // 'users', 'approvals', 'system_logs', 'health', 'trash', or 'explorer', 'delegations'
    
    const [systemLogs, setSystemLogs] = useState([]);
    const [systemLogsPagination, setSystemLogsPagination] = useState({ total: 0, page: 1, pages: 1 });
    const [systemLogsLoading, setSystemLogsLoading] = useState(false);
    const [logTimeRange, setLogTimeRange] = useState(''); // '', '1h', '5h', '24h', '7d', '30d'
    
    const [dataHealth, setDataHealth] = useState([]);
    const [healthLoading, setHealthLoading] = useState(false);

    const [trashBin, setTrashBin] = useState([]);
    const [trashLoading, setTrashLoading] = useState(false);

    const [explorerPrompt, setExplorerPrompt] = useState('');
    const [explorerResults, setExplorerResults] = useState(null);
    const [explorerLoading, setExplorerLoading] = useState(false);
    const [explorerSchema, setExplorerSchema] = useState({ forms: [], fields: [] });
    const [selectedExplorerForms, setSelectedExplorerForms] = useState([]);
    
    const [error, setError] = useState('');
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [userForms, setUserForms] = useState([]);
    const [userFormsLoading, setUserFormsLoading] = useState(false);
    const [activeUsers, setActiveUsers] = useState([]);
    const [selectedExplorerFields, setSelectedExplorerFields] = useState([]);

    const fetchActiveUsers = async () => {
        try {
            const res = await api.get('/admin/users/active-users');
            setActiveUsers(res.data.activeUsers);
        } catch (err) {
            console.error('Failed to fetch active users:', err);
        }
    };

    useEffect(() => {
        if (activeTab === 'active_sessions') fetchActiveUsers();
    }, [activeTab]);

    // Update selected fields when explorer results change
    useEffect(() => {
        if (explorerResults && explorerResults.rows.length > 0) {
            const dataKeys = new Set();
            explorerResults.rows.forEach(row => {
                const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                    Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
                }
            });
            setSelectedExplorerFields(Array.from(dataKeys));
        }
    }, [explorerResults]);

    const [showExplorerFieldsModal, setShowExplorerFieldsModal] = useState(false);

    const handleExplorerExport = async () => {
        try {
            const res = await api.post('/explorer/export', {
                prompt: explorerPrompt,
                selectedForms: explorerSchema.forms.map(f => ({ id: f.id, name: f.name })), // Admin searches all by default
                selectedFields: selectedExplorerFields
            }, { responseType: 'blob' });

            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.download = `admin_ai_export_${new Date().getTime()}.xlsx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setShowExplorerFieldsModal(false);
        } catch {
            alert('AI Export failed');
        }
    };
    const [actionLoading, setActionLoading] = useState(false);
    const [profileModal, setProfileModal] = useState({ open: false, userId: null, username: '', originalUsername: '', newPassword: '' });
    const [showCreateUserModal, setShowCreateUserModal] = useState(false);
    const [newUser, setNewUser] = useState({ username: '', password: '' });
    
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const navigate = useNavigate();

    const [allUsers, setAllUsers] = useState([]);
    const [delegations, setDelegations] = useState({ outgoing: [], incoming: [], allActive: [] });
    const [showDelegationModal, setShowDelegationModal] = useState(false);
    const [newDelegation, setNewDelegation] = useState({ grantorId: '', granteeId: '', duration: '1', durationUnit: 'hours', expiresAt: '' });
    const [delegationLoading, setDelegationLoading] = useState(false);

    useEffect(() => {
        fetchStats();
        fetchLogs();
    }, []);

    useEffect(() => {
        if (activeTab === 'explorer') fetchExplorerSchema();
        if (activeTab === 'delegations') fetchDelegationData();
        if (activeTab === 'system_logs') fetchSystemLogs();
        if (activeTab === 'health') fetchHealthData();
        if (activeTab === 'trash') fetchTrashBin();
    }, [activeTab]);

    const fetchDelegationData = async () => {
        try {
            setDelegationLoading(true);
            const [usersRes, delRes] = await Promise.all([
                api.get('/permissions/users'),
                api.get('/permissions/delegations')
            ]);
            const users = [...(usersRes.data.users || []), { id: user.id, username: user.username }].sort((a,b) => a.username.localeCompare(b.username));
            setAllUsers(users);
            setDelegations(delRes.data);
        } catch (err) {
            console.error('Failed to fetch delegation data:', err);
        } finally {
            setDelegationLoading(false);
        }
    };

    const handleCreateDelegation = async (e) => {
        e.preventDefault();
        if (!newDelegation.grantorId || !newDelegation.granteeId) return;
        const payload = { grantorId: newDelegation.grantorId, granteeId: newDelegation.granteeId };
        if (newDelegation.durationUnit === 'date') payload.expiresAt = newDelegation.expiresAt;
        else { payload.duration = newDelegation.duration; payload.durationUnit = newDelegation.durationUnit; }
        try {
            setDelegationLoading(true);
            await api.post('/permissions/delegate', payload);
            setNewDelegation({ grantorId: '', granteeId: '', duration: '1', durationUnit: 'hours', expiresAt: '' });
            fetchDelegationData();
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
        } catch (err) {
            alert('Failed to revoke delegation');
        }
    };

    const fetchStats = async () => {
        try {
            setLoading(true);
            setError('');
            const res = await api.get('/forms/admin/stats');
            setStats(res.data.stats);
        } catch (err) {
            console.error('Failed to fetch stats:', err);
            setError(err.response?.data?.error || 'Failed to load statistics');
        } finally {
            setLoading(false);
        }
    };

    const fetchExplorerSchema = async () => {
        try {
            setExplorerLoading(true);
            const res = await api.get('/explorer/schema');
            setExplorerSchema(res.data);
            setSelectedExplorerForms(res.data.forms.map(f => f.id));
        } catch (err) {
            console.error('Failed to fetch schema:', err);
        } finally {
            setExplorerLoading(false);
        }
    };

    const fetchLogs = async () => {
        try {
            setLogsLoading(true);
            const res = await api.get('/permissions/logs');
            setLogs(res.data.logs);
        } catch (err) {
            console.error('Failed to fetch logs:', err);
        } finally {
            setLogsLoading(false);
        }
    };

    const fetchSystemLogs = async (page = 1, range = logTimeRange) => {
        try {
            setSystemLogsLoading(true);
            const res = await api.get(`/admin-analytics/logs?page=${page}&timeRange=${range}`);
            setSystemLogs(res.data.logs);
            setSystemLogsPagination(res.data.pagination);
        } catch (err) {
            console.error('Failed to fetch system logs:', err);
        } finally {
            setSystemLogsLoading(false);
        }
    };

    const PieChart = ({ missing, total }) => {
        const missingPercent = total > 0 ? (missing / total) * 100 : 0;
        const completePercent = 100 - missingPercent;
        
        // Using hardcoded hex for guaranteed visibility in conic-gradient
        const primaryColor = '#d4af37'; // var(--accent-primary)
        const errorColor = '#ef4444';   // var(--error-color)

        return (
            <div className="pie-chart-container" style={{ position: 'relative', width: '80px', height: '80px' }}>
                <div className="pie-chart" style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    background: `conic-gradient(
                        ${primaryColor} 0% ${completePercent}%,
                        ${errorColor} ${completePercent}% 100%
                    )`,
                    boxShadow: 'inset 0 0 10px rgba(0,0,0,0.2)'
                }}></div>
                <div className="pie-center" style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '50px',
                    height: '50px',
                    background: 'var(--bg-glass)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                    backdropFilter: 'blur(5px)'
                }}>
                    {Math.round(completePercent)}%
                </div>
            </div>
        );
    };

    const fetchHealthData = async () => {
        try {
            setHealthLoading(true);
            const res = await api.get('/admin-analytics/data-health');
            setDataHealth(res.data.health);
        } catch (err) {
            console.error('Failed to fetch health data:', err);
        } finally {
            setHealthLoading(false);
        }
    };

    const fetchTrashBin = async () => {
        try {
            setTrashLoading(true);
            const res = await api.get('/admin-analytics/trash-bin');
            setTrashBin(res.data.trash);
        } catch (err) {
            console.error('Failed to fetch trash bin:', err);
        } finally {
            setTrashLoading(false);
        }
    };

    const handleRestore = async (id, type) => {
        if (!confirm(`Are you sure you want to restore this ${type}?`)) return;
        try {
            setActionLoading(true);
            await api.post(`/admin-analytics/restore/${type}/${id}`);
            fetchTrashBin();
            alert(`${type.charAt(0).toUpperCase() + type.slice(1)} restored successfully.`);
        } catch (err) {
            alert(`Failed to restore ${type}.`);
        } finally {
            setActionLoading(false);
        }
    };

    const handlePurge = async (id, type) => {
        if (!confirm(`⚠️ PERMANENT DELETE: Are you sure? This ${type} will be gone FOREVER.`)) return;
        try {
            setActionLoading(true);
            await api.delete(`/admin-analytics/purge/${type}/${id}`);
            fetchTrashBin();
        } catch (err) {
            alert('Failed to purge item.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleEmptyTrash = async () => {
        if (!confirm('🚨 EMPTY TRASH: This will permanently delete EVERY item in the trash bin. Are you absolutely sure?')) return;
        try {
            setActionLoading(true);
            await api.delete('/admin-analytics/empty-trash');
            fetchTrashBin();
            alert('Trash bin emptied successfully.');
        } catch (err) {
            alert('Failed to empty trash.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteUser = async (userId, username) => {
        if (!confirm(`Are you sure you want to delete user "${username}"? This will delete ALL their forms and submissions. This action CANNOT be undone.`)) return;
        try {
            setActionLoading(true);
            await api.delete(`/admin/users/${userId}`);
            fetchStats();
            alert(`User ${username} deleted successfully.`);
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to delete user');
        } finally {
            setActionLoading(false);
        }
    };

    const handleProfileUpdate = async (e) => {
        e.preventDefault();
        const updates = {};
        if (profileModal.username !== profileModal.originalUsername) {
            if (!profileModal.username.trim() || profileModal.username.length < 3) { alert('Username must be at least 3 characters'); return; }
            updates.username = profileModal.username.trim();
        }
        if (profileModal.newPassword) {
            if (profileModal.newPassword.length < 6) { alert('Password must be at least 6 characters'); return; }
            updates.password = profileModal.newPassword;
        }
        if (Object.keys(updates).length === 0) { setProfileModal({ open: false, userId: null, username: '', originalUsername: '', newPassword: '' }); return; }
        try {
            setActionLoading(true);
            const res = await api.put(`/admin/users/${profileModal.userId}/profile`, updates);
            setProfileModal({ open: false, userId: null, username: '', originalUsername: '', newPassword: '' });
            alert(res.data.message);
            fetchStats();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to update profile');
        } finally {
            setActionLoading(false);
        }
    };

    const handleChangeRole = async (userId, currentRole, username) => {
        const newRole = currentRole === 'admin' ? 'user' : 'admin';
        if (!confirm(`Change role of "${username}" to ${newRole.toUpperCase()}?`)) return;
        try {
            setActionLoading(true);
            await api.put(`/admin/users/${userId}/role`, { role: newRole });
            fetchStats();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to update role');
        } finally {
            setActionLoading(false);
        }
    };

    const viewUserForms = async (userId) => {
        try {
            setUserFormsLoading(true);
            setError('');
            const res = await api.get(`/forms/admin/user/${userId}`);
            setUserForms(res.data.forms);
            setSelectedUserId(userId);
        } catch (err) {
            console.error('Failed to fetch user forms:', err);
            setError(err.response?.data?.error || 'Failed to load user forms');
            setSelectedUserId(null);
        } finally {
            setUserFormsLoading(false);
        }
    };

    const handleCreateUser = async (e) => {
        e.preventDefault();
        if (!newUser.username || newUser.password.length < 6) { alert('Username and password (min. 6 chars) are required'); return; }
        try {
            setActionLoading(true);
            await api.post('/auth/register', newUser);
            setShowCreateUserModal(false);
            setNewUser({ username: '', password: '' });
            fetchStats();
            alert(`User ${newUser.username} created successfully.`);
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to create user');
        } finally {
            setActionLoading(false);
        }
    };

    const handleExplorerQuery = async (e) => {
        e.preventDefault();
        if (!explorerPrompt.trim()) return;
        try {
            setExplorerLoading(true);
            setError('');
            const res = await api.post('/explorer/query', { 
                prompt: explorerPrompt,
                selectedForms: explorerSchema.forms.filter(f => selectedExplorerForms.includes(f.id))
            });
            setExplorerResults(res.data);
        } catch (err) {
            console.error('Explorer error:', err);
            setError(err.response?.data?.error || 'Failed to execute AI query');
        } finally {
            setExplorerLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="loading-screen">
                <div className="spinner"></div>
                <p>Loading admin dashboard...</p>
            </div>
        );
    }

    if (!stats) {
        return (
            <div className="page-container">
                <div className="glass-card error-card">
                    <h2>⚠️ Error</h2>
                    <p>{error || 'Failed to load admin dashboard'}</p>
                    <button className="btn btn-primary" onClick={fetchStats}>Retry</button>
                </div>
            </div>
        );
    }

    const selectedUser = stats.users?.find(u => u.id === selectedUserId);

    return (
        <div className="admin-dashboard-page">
            <header className="dashboard-header">
                <div className="header-left">
                    <h1>👁️ अग्र-Sandhani Admin</h1>
                    <span className="user-badge">Admin: {user?.username}</span>
                </div>
                <div className="header-right">
                    <button className="btn btn-primary" onClick={() => setShowCreateUserModal(true)}>+ Create User</button>
                    <button className="btn btn-secondary" onClick={() => navigate('/')} title="Back to Dashboard">← Dashboard</button>
                    <button className="theme-toggle-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}>{theme === 'dark' ? '☀️' : '🌙'}</button>
                    <button className="btn btn-ghost" onClick={logout}>Logout</button>
                </div>
            </header>

            {error && (
                <div className="alert alert-error">
                    <span>{error}</span>
                    <button className="alert-close" onClick={() => setError('')}>✕</button>
                </div>
            )}

            <nav className="dashboard-tabs">
                <button className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>👥 Users</button>
                <button className={`tab-btn ${activeTab === 'active_sessions' ? 'active' : ''}`} onClick={() => setActiveTab('active_sessions')}>🟢 Live Sessions</button>
                <button className={`tab-btn ${activeTab === 'approvals' ? 'active' : ''}`} onClick={() => setActiveTab('approvals')}>⚖️ Approvals</button>
                <button className={`tab-btn ${activeTab === 'system_logs' ? 'active' : ''}`} onClick={() => setActiveTab('system_logs')}>📜 Logs</button>
                <button className={`tab-btn ${activeTab === 'health' ? 'active' : ''}`} onClick={() => setActiveTab('health')}>🏥 Health</button>
                <button className={`tab-btn ${activeTab === 'trash' ? 'active' : ''}`} onClick={() => setActiveTab('trash')}>🗑️ Trash</button>
                <button className={`tab-btn ${activeTab === 'explorer' ? 'active' : ''}`} onClick={() => setActiveTab('explorer')}>🔍 AI Explorer</button>
                <button className={`tab-btn ${activeTab === 'delegations' ? 'active' : ''}`} onClick={() => setActiveTab('delegations')}>🔑 Access</button>
            </nav>

            <div className="tab-content animate-fade-in">
                {activeTab === 'active_sessions' && (
                    <section className="active-sessions-section">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h2>🟢 Live Active Sessions</h2>
                                <p className="text-muted">Users active within the last 5 minutes. Total: {activeUsers.length}</p>
                            </div>
                            <button className="btn btn-secondary btn-sm" onClick={fetchActiveUsers}>🔄 Refresh</button>
                        </div>
                        <div className="table-container glass-card scrollable-table-wrapper">
                            {activeUsers.length === 0 ? (
                                <div className="p-8 text-center opacity-50">No active sessions found in the last 5 minutes.</div>
                            ) : (
                                <table className="admin-table">
                                    <thead>
                                        <tr>
                                            <th>Username</th>
                                            <th>Role</th>
                                            <th>Activity Status</th>
                                            <th>Logged In At</th>
                                            <th>Last Logged Out</th>
                                            <th>Access Origin (IP)</th>
                                            <th>Joined On</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {activeUsers.map(u => {
                                            const lastActiveDate = new Date(u.last_activity);
                                            const diffMs = new Date() - lastActiveDate;
                                            // heartbeat is 30s, check window is 1m (60000ms)
                                            const isTrulyActive = diffMs < 60000 && u.current_session_id !== null;

                                            const formatTime = (iso) => {
                                                if (!iso || iso === '1970-01-01T00:00:00.000Z') return 'Never';
                                                const d = new Date(iso);
                                                return d.toLocaleString(); // Shows both Date and Time
                                            };

                                            return (
                                                <tr key={u.id}>
                                                    <td className="font-bold text-accent">{u.username}</td>
                                                    <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                                                    <td>
                                                        {isTrulyActive ? (
                                                            <span className="badge badge-success">🔥 Active</span>
                                                        ) : (
                                                            <span className="badge badge-secondary" style={{ opacity: 0.6 }}>💤 Idle / Offline</span>
                                                        )}
                                                    </td>
                                                    <td>{formatTime(u.last_login)}</td>
                                                    <td>{formatTime(u.last_logout || (isTrulyActive ? null : u.last_activity))}</td>
                                                    <td>
                                                        <div className="flex flex-col gap-xs">
                                                            <span className="text-xs" title="Last Login IP">🔌 {u.last_login_ip || 'No Record'}</span>
                                                            <span className="text-xs opacity-50" title="Registration IP">🆔 {u.registration_ip || 'No Record'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="text-xs opacity-70">{new Date(u.created_at).toLocaleDateString()}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </section>
                )}
                {activeTab === 'users' && (
                    <>
                        <section className="stats-section">
                            <h2>Global Statistics</h2>
                            <div className="stats-grid">
                                <div className="stat-card glass-card">
                                    <div className="stat-icon">👥</div>
                                    <div className="stat-content">
                                        <div className="stat-number">{stats.total_users}</div>
                                        <div className="stat-label">Total Users</div>
                                    </div>
                                </div>
                                <div className="stat-card glass-card">
                                    <div className="stat-icon">📋</div>
                                    <div className="stat-content">
                                        <div className="stat-number">{stats.total_forms}</div>
                                        <div className="stat-label">Total Forms</div>
                                    </div>
                                </div>
                                <div className="stat-card glass-card">
                                    <div className="stat-icon">📝</div>
                                    <div className="stat-content">
                                        <div className="stat-number">{stats.total_submissions}</div>
                                        <div className="stat-label">Total Submissions</div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="users-section">
                            <h2>User Activity Details</h2>
                            <div className="table-container glass-card scrollable-table-wrapper">
                                <table className="admin-table">
                                    <thead>
                                        <tr>
                                            <th>Username</th>
                                            <th>Role</th>
                                            <th>Joined</th>
                                            <th>Forms</th>
                                            <th>Submissions</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {stats.users.map(userItem => (
                                            <tr key={userItem.id} className={userItem.role === 'admin' ? 'admin-row' : ''}>
                                                <td className="user-name">{userItem.role === 'admin' ? '👑 ' : '👤 '}{userItem.username}</td>
                                                <td><span className={`badge badge-${userItem.role}`}>{userItem.role}</span></td>
                                                <td>{new Date(userItem.created_at).toLocaleDateString()}</td>
                                                <td className="text-center">{userItem.form_count}</td>
                                                <td className="text-center">{userItem.submission_count}</td>
                                                <td>
                                                    <div className="admin-actions">
                                                        <button className="btn btn-sm btn-secondary" onClick={() => viewUserForms(userItem.id)} disabled={actionLoading} title="View Forms">📂</button>
                                                        <button className="btn btn-sm btn-accent" onClick={() => setProfileModal({ open: true, userId: userItem.id, username: userItem.username, originalUsername: userItem.username, newPassword: '' })} disabled={actionLoading} title="Edit Profile">👤</button>
                                                        <button className="btn btn-sm btn-secondary" onClick={() => handleChangeRole(userItem.id, userItem.role, userItem.username)} disabled={actionLoading || userItem.id === user?.id} title="Toggle Role">{userItem.role === 'admin' ? '👤' : '👑'}</button>
                                                        <button className="btn btn-sm btn-danger" onClick={() => handleDeleteUser(userItem.id, userItem.username)} disabled={actionLoading || userItem.id === user?.id} title="Delete User">🗑️</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </>
                )}

                {activeTab === 'approvals' && (
                    <section className="logs-section">
                        <h2>Approval & Activity Tracking</h2>
                        <div className="table-container glass-card scrollable-table-wrapper">
                            {logsLoading ? <div className="spinner"></div> : logs.length === 0 ? <div className="empty-logs">No activity.</div> : (
                                <table className="admin-table">
                                    <thead><tr><th>Form Name</th><th>Requester</th><th>Action</th><th>Performed By</th><th>Timestamp</th></tr></thead>
                                    <tbody>
                                        {logs.map(log => (
                                            <tr key={log.id}>
                                                <td>{log.form_name}</td><td>{log.requester}</td>
                                                <td><span className={`badge badge-action-${log.action}`}>{log.action}</span></td>
                                                <td>{log.performer || 'System'}</td><td>{new Date(log.timestamp).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </section>
                )}

                {activeTab === 'system_logs' && (
                    <section className="logs-section">
                        <div className="flex justify-between items-center mb-4">
                            <h2>📜 System Activity Feed</h2>
                            <div className="flex items-center gap-2">
                                <label className="text-xs font-bold opacity-60">Filter Time:</label>
                                <select 
                                    className="form-input" 
                                    style={{ width: 'auto', padding: '0.4rem 1rem' }}
                                    value={logTimeRange}
                                    onChange={(e) => {
                                        setLogTimeRange(e.target.value);
                                        fetchSystemLogs(1, e.target.value);
                                    }}
                                >
                                    <option value="">All Time</option>
                                    <option value="1h">Last 1 Hour</option>
                                    <option value="5h">Last 5 Hours</option>
                                    <option value="24h">Last 24 Hours</option>
                                    <option value="7d">Last 7 Days</option>
                                    <option value="30d">Last 30 Days</option>
                                </select>
                            </div>
                        </div>
                        <div className="table-container glass-card scrollable-table-wrapper">
                            {systemLogsLoading ? <div className="spinner"></div> : systemLogs.length === 0 ? <div className="empty-logs">No logs.</div> : (
                                <table className="admin-table">
                                    <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Details</th></tr></thead>
                                    <tbody>
                                        {systemLogs.map(log => (
                                            <tr key={log.id}>
                                                <td className="text-xs">{new Date(log.timestamp).toLocaleString()}</td>
                                                <td className="font-bold">{log.username || 'System'}</td>
                                                <td><span className={`badge badge-action-${log.action_type}`}>{log.action_type.replace('_', ' ').toUpperCase()}</span></td>
                                                <td className="text-xs">
                                                    {Object.entries(log.details || {}).map(([key, val]) => (
                                                        <div key={key}><strong className="opacity-60">{key}:</strong> {typeof val === 'object' ? JSON.stringify(val) : val.toString()}</div>
                                                    ))}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        {systemLogsPagination.pages > 1 && (
                            <div className="pagination mt-4">
                                {Array.from({ length: systemLogsPagination.pages }, (_, i) => i + 1).map(p => (
                                    <button key={p} className={`btn btn-sm ${systemLogsPagination.page === p ? 'btn-primary' : 'btn-ghost'}`} onClick={() => fetchSystemLogs(p)}>{p}</button>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {activeTab === 'health' && (
                    <section className="health-section">
                        <h2>🏥 Data Integrity Monitor</h2>
                        <p className="text-muted">A visual breakdown of form completeness vs. missing entries.</p>
                        <div className="stats-grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                            {healthLoading ? <div className="spinner"></div> : dataHealth.map(item => {
                                const missing = parseInt(item.missing_count);
                                const total = parseInt(item.total_submissions);
                                const missingRate = total > 0 ? (missing / total * 100).toFixed(1) : 0;
                                
                                return (
                                    <div key={item.id} className="stat-card glass-card" style={{ padding: '1.5rem' }}>
                                        <div className="flex justify-between items-start mb-6">
                                            <div className="flex flex-col">
                                                <div className="font-bold text-lg" style={{ lineHeight: 1.2 }}>{item.form_name}</div>
                                                <div className="text-xs opacity-50 mt-1">Owner: {item.owner}</div>
                                            </div>
                                            <PieChart missing={missing} total={total} />
                                        </div>
                                        
                                        <div className="health-stats flex flex-col gap-2">
                                            <div className="flex justify-between text-sm">
                                                <span className="opacity-70">Total Submissions</span>
                                                <span className="font-bold">{total}</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="opacity-70">Missing Entries</span>
                                                <span className="font-bold text-error" style={{ color: 'var(--error-color)' }}>{missing}</span>
                                            </div>
                                            <div className="health-bar-bg mt-2" style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                                <div style={{ 
                                                    height: '100%', 
                                                    width: `${100 - missingRate}%`, 
                                                    background: missingRate > 30 ? 'var(--error-color)' : 'var(--accent-primary)',
                                                    boxShadow: '0 0 10px rgba(0,0,0,0.2)'
                                                }}></div>
                                            </div>
                                            <div className="text-center text-xs opacity-40 mt-1">
                                                {100 - missingRate}% Data Quality Score
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {activeTab === 'trash' && (
                    <section className="trash-section">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h2>🗑️ System Trash Bin</h2>
                                <p className="text-muted">Restore soft-deleted forms and submissions here. Items older than 30 days are automatically purged.</p>
                            </div>
                            <button className="btn btn-danger flex items-center gap-2" onClick={handleEmptyTrash} disabled={trashBin.length === 0 || actionLoading}>
                                🚨 Empty Trash
                            </button>
                        </div>

                        <div className="table-container glass-card scrollable-table-wrapper">
                            {trashLoading ? (
                                <div className="spinner-container"><div className="spinner"></div></div>
                            ) : trashBin.length === 0 ? (
                                <div className="empty-logs p-8 text-center opacity-50">The trash bin is currently empty.</div>
                            ) : (
                                <table className="admin-table">
                                    <thead>
                                        <tr>
                                            <th>Type</th>
                                            <th>Name / Data Preview</th>
                                            <th>Deleted On</th>
                                            <th>By</th>
                                            <th className="text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {trashBin.map(item => (
                                            <tr key={`${item.type}-${item.id}`}>
                                                <td>
                                                    <span className={`badge badge-${item.type === 'form' ? 'primary' : 'secondary'}`}>
                                                        {item.type.toUpperCase()}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className="font-bold">{item.form_name}</div>
                                                    {item.type === 'submission' && (
                                                        <div className="text-xs opacity-50 truncate max-w-md">
                                                            {Object.values(item.data_json || {}).join(', ').substring(0, 80)}...
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="text-xs">{new Date(item.deleted_at).toLocaleString()}</td>
                                                <td>{item.deleted_by || 'Unknown'}</td>
                                                <td>
                                                    <div className="flex justify-end gap-2">
                                                        <button 
                                                            className="btn btn-sm btn-accent" 
                                                            onClick={() => handleRestore(item.id, item.type)}
                                                            disabled={actionLoading}
                                                            title="Restore"
                                                        >
                                                            🔄 Restore
                                                        </button>
                                                        <button 
                                                            className="btn btn-sm btn-danger" 
                                                            onClick={() => handlePurge(item.id, item.type)}
                                                            disabled={actionLoading}
                                                            title="Permanent Delete"
                                                        >
                                                            🗑️ Purge
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </section>
                )}

                {activeTab === 'explorer' && (
                    <section className="explorer-section">
                        <h2>🧠 Universal AI Data Explorer</h2>
                        <div className="glass-card explorer-input-card mt-4">
                            <form onSubmit={handleExplorerQuery} className="explorer-form">
                                <input type="text" className="form-input explorer-input" placeholder="e.g., 'Find all students from Punjab with CGPA > 9'" value={explorerPrompt} onChange={(e) => setExplorerPrompt(e.target.value)} disabled={explorerLoading} />
                                <button type="submit" className="btn btn-primary explorer-submit" disabled={explorerLoading || !explorerPrompt.trim()}>{explorerLoading ? <div className="spinner-sm"></div> : 'Ask AI'}</button>
                            </form>
                        </div>
                        {explorerResults && (
                            <div className="explorer-results-area animate-fade-in mt-4">
                                <div className="sql-preview glass-card mb-4"><code>{explorerResults.sql}</code></div>
                                
                                <div className="explorer-results-header flex justify-between items-center mb-4">
                                    <div className="results-meta">Found {explorerResults.rowCount} entries</div>
                                    <div className="flex gap-2">
                                        <button className="btn btn-secondary btn-sm" onClick={() => setShowExplorerFieldsModal(true)}>🎯 Pick Fields</button>
                                        <button className="btn btn-accent btn-sm" onClick={handleExplorerExport}>📥 Export Selected to Excel</button>
                                    </div>
                                </div>

                                {showExplorerFieldsModal && (
                                    <div className="modal-overlay" onClick={() => setShowExplorerFieldsModal(false)}>
                                        <div className="modal glass-card" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
                                            <div className="modal-header">
                                                <h2>🎯 Pick Fields to Export</h2>
                                                <p className="modal-subtitle">Toggle columns to include in your Excel report</p>
                                            </div>
                                            <div className="modal-body py-6">
                                                <div className="flex flex-wrap gap-2">
                                                    {(() => {
                                                        const dataKeys = new Set();
                                                        explorerResults.rows.forEach(row => { 
                                                            const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                                                            if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                                                                Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
                                                            }
                                                        });
                                                        return Array.from(dataKeys).sort().map(h => (
                                                            <label key={h} className={`refined-option-card ${selectedExplorerFields.includes(h) ? 'active' : ''}`} style={{ padding: '0.6rem 1rem', width: '100%' }}>
                                                                <span className="flex-1 font-bold">{h}</span>
                                                                <input 
                                                                    type="checkbox" 
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
                                                <button className="btn btn-ghost" onClick={() => setShowExplorerFieldsModal(false)}>Close</button>
                                                <button className="btn btn-primary" onClick={handleExplorerExport}>🚀 Export Now</button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="results-table-container glass-card scrollable-table-wrapper">
                                    {explorerResults.rows.length > 0 ? (() => {
                                        const dataKeys = new Set();
                                        explorerResults.rows.forEach(row => { 
                                            const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                                            if (dataKey && row[dataKey] && typeof row[dataKey] === 'object') {
                                                Object.keys(row[dataKey]).forEach(k => dataKeys.add(k));
                                            }
                                        });
                                        const dynamicHeaders = Array.from(dataKeys).sort();
                                        const fixedHeaders = Object.keys(explorerResults.rows[0]).filter(k => !['data_json', 'data', 'Data'].includes(k));
                                        const allHeaders = [...fixedHeaders, ...dynamicHeaders];
                                        return (
                                            <table className="admin-table">
                                                <thead><tr>{allHeaders.map(h => <th key={h}>{h}</th>)}</tr></thead>
                                                <tbody>
                                                    {explorerResults.rows.map((row, i) => {
                                                        const dataKey = Object.keys(row).find(k => k.toLowerCase() === 'data_json' || k.toLowerCase() === 'data');
                                                        const rowData = dataKey ? row[dataKey] : (row.Data || {});
                                                        return (
                                                            <tr key={i}>
                                                                {fixedHeaders.map(h => <td key={h}>{row[h]?.toString() || '-'}</td>)}
                                                                {dynamicHeaders.map(h => {
                                                                    let val = rowData[h] || '-';
                                                                    if (typeof val === 'string') val = val.replace(/ \|\|\| /g, ', ');
                                                                    return <td key={h}>{val || '-'}</td>;
                                                                })}
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        );
                                    })() : <div className="empty-results">No matches.</div>}
                                </div>
                            </div>
                        )}
                    </section>
                )}

                {activeTab === 'delegations' && (
                    <section className="delegations-section">
                        <h2>🔑 Global Access Control</h2>
                        <div className="glass-card mt-4" style={{ padding: '1.5rem' }}>
                            <h3>Grant New Access</h3>
                            <form onSubmit={handleCreateDelegation} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '1rem', alignItems: 'end', marginTop: '1rem' }}>
                                <div className="form-group"><label>Owner</label><select className="form-input" value={newDelegation.grantorId} onChange={e => setNewDelegation({ ...newDelegation, grantorId: e.target.value })} required><option value="">Select...</option>{allUsers.map(u => (<option key={u.id} value={u.id}>{u.username}</option>))}</select></div>
                                <div className="form-group"><label>Recipient</label><select className="form-input" value={newDelegation.granteeId} onChange={e => setNewDelegation({ ...newDelegation, granteeId: e.target.value })} required><option value="">Select...</option>{allUsers.map(u => (<option key={u.id} value={u.id}>{u.username}</option>))}</select></div>
                                <div className="form-group"><label>Unit</label><select className="form-input" value={newDelegation.durationUnit} onChange={e => setNewDelegation({ ...newDelegation, durationUnit: e.target.value })} required><option value="hours">Hours</option><option value="days">Days</option><option value="date">Date</option></select></div>
                                <div className="form-group"><label>{newDelegation.durationUnit === 'date' ? 'Date' : 'Val'}</label>{newDelegation.durationUnit === 'date' ? <input type="datetime-local" className="form-input" value={newDelegation.expiresAt} onChange={e => setNewDelegation({ ...newDelegation, expiresAt: e.target.value })} required /> : <input type="number" className="form-input" min="1" value={newDelegation.duration} onChange={e => setNewDelegation({ ...newDelegation, duration: e.target.value })} required />}</div>
                                <button type="submit" className="btn btn-primary" disabled={delegationLoading}>Grant</button>
                            </form>
                        </div>
                        <div className="table-container glass-card scrollable-table-wrapper mt-4">
                            <h3>Active Delegations</h3>
                            {delegations.allActive.length === 0 ? <p className="text-muted p-4 text-center">None.</p> : (
                                <table className="admin-table">
                                    <thead><tr><th>Owner</th><th>Recipient</th><th>Granted</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead>
                                    <tbody>
                                        {delegations.allActive.map(d => {
                                            const isExpired = new Date(d.expires_at) < new Date();
                                            return (
                                                <tr key={d.id}>
                                                    <td>{d.grantor_username}</td><td>{d.recipient_username}</td><td>{new Date(d.created_at).toLocaleString()}</td><td>{new Date(d.expires_at).toLocaleString()}</td>
                                                    <td><span className={`badge ${isExpired ? 'badge-danger' : 'badge-success'}`}>{isExpired ? 'Expired' : 'Active'}</span></td>
                                                    <td><button className="btn btn-sm btn-danger" onClick={() => handleRevokeDelegation(d.id)}>Revoke</button></td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </section>
                )}
            </div>

            {selectedUserId && (
                <div className="modal-overlay" onClick={() => setSelectedUserId(null)}>
                    <div className="modal glass-card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h2>Forms by {selectedUser?.username}</h2><button className="btn-close" onClick={() => setSelectedUserId(null)}>✕</button></div>
                        <div className="modal-content">
                            {userFormsLoading ? <div className="spinner"></div> : (
                                <div className="forms-list">
                                    {userForms.map(form => (
                                        <div key={form.id} className="form-item glass-card">
                                            <div className="form-item-header"><h4>{form.name}</h4>{form.is_locked && <span className="badge badge-locked">🔒</span>}</div>
                                            <div className="form-item-meta"><span>v{form.version_number}</span><span>{form.submission_count} submissions</span></div>
                                            <button className="btn btn-sm btn-secondary" onClick={() => { navigate(`/forms/${form.id}/submissions`); setSelectedUserId(null); }}>View</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {profileModal.open && (
                <div className="modal-overlay" onClick={() => setProfileModal({ ...profileModal, open: false })}>
                    <div className="modal glass-card" onClick={e => e.stopPropagation()}>
                        <h2>Edit Profile: {profileModal.originalUsername}</h2>
                        <form onSubmit={handleProfileUpdate}>
                            <div className="form-group"><label>Username</label><input type="text" className="form-input" value={profileModal.username} onChange={(e) => setProfileModal({ ...profileModal, username: e.target.value })} required minLength={3} /></div>
                            <div className="form-group"><label>New Password (Optional)</label><input type="password" className="form-input" value={profileModal.newPassword} onChange={(e) => setProfileModal({ ...profileModal, newPassword: e.target.value })} placeholder="Leave blank to keep" /></div>
                            <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setProfileModal({ ...profileModal, open: false })}>Cancel</button><button type="submit" className="btn btn-primary" disabled={actionLoading}>Update</button></div>
                        </form>
                    </div>
                </div>
            )}

            {showCreateUserModal && (
                <div className="modal-overlay" onClick={() => setShowCreateUserModal(false)}>
                    <div className="modal glass-card" onClick={e => e.stopPropagation()}>
                        <h2>Create New User</h2>
                        <form onSubmit={handleCreateUser}>
                            <div className="form-group"><label>Username</label><input type="text" className="form-input" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} required /></div>
                            <div className="form-group"><label>Password</label><input type="password" className="form-input" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} required /></div>
                            <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setShowCreateUserModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={actionLoading}>Create</button></div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
