import { useEffect, useState, useMemo } from 'react';
import { ThemeContext } from './ThemeContext';
import { ThemeProvider as MuiThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

export function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(() => {
        return localStorage.getItem('theme') || 'dark';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
    };

    const muiTheme = useMemo(() => {
        return createTheme({
            palette: {
                mode: theme,
                primary: {
                    main: '#d4af37', // Custom Golden accent
                },
                background: {
                    default: theme === 'dark' ? '#0a0f1d' : '#ffffff',
                    paper: theme === 'dark' ? '#131b2e' : '#ffffff',
                },
                text: {
                    primary: theme === 'dark' ? '#ffffff' : '#1a1a1a',
                    secondary: theme === 'dark' ? '#e2e8f0' : '#4a4a4a',
                },
            },
            typography: {
                fontFamily: 'Segoe UI, Roboto, Helvetica, Arial, sans-serif',
            },
        });
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            <MuiThemeProvider theme={muiTheme}>
                <CssBaseline />
                {children}
            </MuiThemeProvider>
        </ThemeContext.Provider>
    );
}
