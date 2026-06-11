import { useState, useEffect, useRef } from 'react';
import api from '../api/client';

export default function NotificationCenter() {
    const [notifications, setNotifications] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef(null);

    const fetchNotifications = async () => {
        try {
            const res = await api.get('/notifications');
            setNotifications(res.data.notifications);
        } catch (err) {
            console.error('Failed to fetch notifications:', err);
        }
    };

    useEffect(() => {
        fetchNotifications();
        const interval = setInterval(fetchNotifications, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const [durations, setDurations] = useState({}); // permissionId -> { value, unit, expiresAt }

    const handleAction = async (action, notification) => {
        setLoading(true);
        try {
            const d = durations[notification.permission_id] || { value: '', unit: 'permanent' };
            const payload = {};
            
            if (d.unit === 'date') {
                payload.expiresAt = d.expiresAt;
            } else if (d.unit !== 'permanent') {
                payload.duration = d.value;
                payload.durationUnit = d.unit;
            }

            // Action on the permission itself
            await api.post(`/permissions/${action}/${notification.permission_id}`, payload);
            await fetchNotifications();
        } catch {
            alert(`${action} failed`);
        } finally {
            setLoading(false);
        }
    };

    const markAsRead = async (id) => {
        try {
            await api.patch(`/notifications/${id}/read`);
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, status: 'read' } : n));
        } catch (e) { console.error(e); }
    };

    const clearNotification = async (id, e) => {
        e.stopPropagation();
        try {
            await api.patch(`/notifications/${id}/clear`);
            setNotifications(prev => prev.filter(n => n.id !== id));
        } catch { alert('Clear failed'); }
    };

    const clearAll = async () => {
        if (!window.confirm('Clear all notifications?')) return;
        try {
            await api.patch('/notifications/clear-all');
            setNotifications([]);
        } catch { alert('Clear all failed'); }
    };

    const unreadCount = notifications.filter(n => n.status === 'unread').length;

    const setDurationField = (permissionId, field, value) => {
        setDurations(prev => ({
            ...prev,
            [permissionId]: { ...(prev[permissionId] || { value: '1', unit: 'hours' }), [field]: value }
        }));
    };

    return (
        <div className="notification-center" ref={dropdownRef}>
            <button 
                className={`btn btn-icon notification-trigger ${unreadCount > 0 ? 'has-unread' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                title="Notifications"
            >
                🔔
                {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
            </button>

            {isOpen && (
                <div className="notification-dropdown glass-card">
                    <div className="notification-header">
                        <h3>Notifications</h3>
                        {notifications.length > 0 && (
                            <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear All</button>
                        )}
                    </div>

                    <div className="notification-list">
                        {notifications.length === 0 ? (
                            <div className="notification-empty">No new notifications</div>
                        ) : (
                            notifications.map(n => {
                                const d = durations[n.permission_id] || { value: '1', unit: 'hours' };
                                return (
                                    <div 
                                        key={n.id} 
                                        className={`notification-item ${n.status === 'unread' ? 'unread' : ''}`}
                                        onClick={() => n.status === 'unread' && markAsRead(n.id)}
                                    >
                                        <div className="notification-content">
                                            <p className="notification-message">{n.message}</p>
                                            <span className="notification-time">{new Date(n.created_at).toLocaleString()}</span>
                                            
                                            {n.type === 'access_request' && n.status !== 'read' && (
                                                <div className="notification-actions-container" style={{ marginTop: '0.5rem' }}>
                                                    <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        <label className="small text-muted">Expiry:</label>
                                                        <select 
                                                            className="form-input form-input-sm" 
                                                            style={{ padding: '2px 5px', height: '24px', fontSize: '11px', width: 'auto' }}
                                                            value={d.unit}
                                                            onChange={(e) => setDurationField(n.permission_id, 'unit', e.target.value)}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <option value="permanent">Permanent</option>
                                                            <option value="hours">Hours</option>
                                                            <option value="days">Days</option>
                                                            <option value="date">Specific Date</option>
                                                        </select>
                                                        {d.unit === 'date' ? (
                                                            <input 
                                                                type="datetime-local"
                                                                className="form-input form-input-sm"
                                                                style={{ padding: '2px 5px', height: '24px', fontSize: '10px', width: 'auto' }}
                                                                value={d.expiresAt || ''}
                                                                onChange={(e) => setDurationField(n.permission_id, 'expiresAt', e.target.value)}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        ) : d.unit !== 'permanent' ? (
                                                            <input 
                                                                type="number"
                                                                className="form-input form-input-sm"
                                                                style={{ padding: '2px 5px', height: '24px', fontSize: '11px', width: '40px' }}
                                                                min="1"
                                                                value={d.value}
                                                                onChange={(e) => setDurationField(n.permission_id, 'value', e.target.value)}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        ) : null}
                                                    </div>
                                                    <div className="notification-actions">
                                                        <button 
                                                            className="btn btn-sm btn-primary" 
                                                            onClick={(e) => { e.stopPropagation(); handleAction('approve', n); }}
                                                            disabled={loading}
                                                        >
                                                            Approve
                                                        </button>
                                                        <button 
                                                            className="btn btn-sm btn-secondary" 
                                                            onClick={(e) => { e.stopPropagation(); handleAction('reject', n); }}
                                                            disabled={loading}
                                                        >
                                                            Reject
                                                        </button>
                                                        <button 
                                                            className="btn btn-sm btn-ghost" 
                                                            onClick={(e) => { e.stopPropagation(); handleAction('ignore', n); }}
                                                            disabled={loading}
                                                        >
                                                            Ignore
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <button className="notification-clear-btn" onClick={(e) => clearNotification(n.id, e)} title="Clear">✕</button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
