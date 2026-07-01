import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * AdminRoute - Restricts access to admin users only
 * - Non-logged-in users redirected to /login
 * - Non-admin users see "Access Denied" message
 * - Admins can access the protected component
 */
export default function AdminRoute({ children }) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="loading-screen">
                <div className="spinner"></div>
                <p>Loading...</p>
            </div>
        );
    }

    // No user - redirect to login
    if (!user) {
        return <Navigate to="/login" replace />;
    }

    // Not admin - show access denied
    if (user.role !== 'admin') {
        return (
            <div className="page-container">
                <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
                    <h2>🔒 Access Denied</h2>
                    <p>You need admin privileges to access this page.</p>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        Contact your administrator if you believe this is an error.
                    </p>
                </div>
            </div>
        );
    }

    // Admin - render children
    return children;
}
