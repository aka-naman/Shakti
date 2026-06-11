import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children, adminOnly = false }) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="loading-screen">
                <div className="spinner"></div>
                <p>Loading...</p>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (adminOnly && user.role !== 'admin') {
        return (
            <div className="page-container">
                <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
                    <h2>🔒 Access Denied</h2>
                    <p>You need admin privileges to access this page.</p>
                </div>
            </div>
        );
    }

    return children;
}
