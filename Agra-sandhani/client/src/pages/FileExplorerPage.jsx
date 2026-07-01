import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';

export default function FileExplorerPage() {
    const [searchParams] = useSearchParams();
    const folderPath = searchParams.get('path');
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!folderPath) {
            setError('No folder path provided.');
            setLoading(false);
            return;
        }

        const fetchFiles = async () => {
            try {
                const res = await api.get('/forms/upload-files', { params: { folderPath } });
                setFiles(res.data.files);
            } catch (err) {
                setError('Failed to load files. The folder might not exist or access is restricted.');
            } finally {
                setLoading(false);
            }
        };

        fetchFiles();
    }, [folderPath]);

    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

    return (
        <div className="submit-page" style={{ padding: '2rem' }}>
            <div className="submit-container glass-card" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
                <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
                    <h1 style={{ fontSize: '1.8rem', color: 'var(--accent-color)' }}>👁️ Shared Records</h1>
                    <p className="text-muted" style={{ fontSize: '0.9rem' }}>Viewing contents of: {folderPath}</p>
                </header>

                {error ? (
                    <div className="error-container" style={{ textAlign: 'center', padding: '2rem' }}>
                        <p style={{ color: '#ff4d4d', fontSize: '1.1rem' }}>❌ {error}</p>
                    </div>
                ) : (
                    <div className="file-list-grid" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {files.length === 0 ? (
                            <p style={{ textAlign: 'center', padding: '2rem' }}>No files found in this folder.</p>
                        ) : (
                            files.map((file, i) => (
                                <div key={i} className="file-item-card glass-card" style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center', 
                                    padding: '1rem 1.5rem',
                                    borderRadius: '12px',
                                    background: 'rgba(255, 255, 255, 0.05)'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', overflow: 'hidden' }}>
                                        <span style={{ fontSize: '1.5rem' }}>📄</span>
                                        <span style={{ 
                                            fontWeight: '500', 
                                            overflow: 'hidden', 
                                            textOverflow: 'ellipsis', 
                                            whiteSpace: 'nowrap' 
                                        }}>
                                            {file}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.8rem' }}>
                                        <a 
                                            href={`${api.defaults.baseURL.replace('/api', '')}${folderPath}/${file}`} 
                                            target="_blank" 
                                            rel="noreferrer" 
                                            className="btn btn-sm btn-ghost"
                                            style={{ minWidth: '80px' }}
                                        >
                                            👁️ View
                                        </a>
                                        <a 
                                            href={`${api.defaults.baseURL.replace('/api', '')}${folderPath}/${file}`} 
                                            download 
                                            className="btn btn-sm btn-accent"
                                            style={{ minWidth: '100px' }}
                                        >
                                            📥 Download
                                        </a>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
                
                <footer style={{ marginTop: '3rem', textAlign: 'center', borderTop: '1px solid rgba(212, 175, 55, 0.2)', paddingTop: '1.5rem' }}>
                    <p className="small text-muted">अग्र-Sandhani — The Omniscient Eye of Digital Records</p>
                </footer>
            </div>
        </div>
    );
}
