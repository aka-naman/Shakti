import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2', // A standard blue for primary actions
    },
    secondary: {
      main: '#dc004e', // A standard red for secondary actions or warnings
    },
    background: {
      default: '#ffffff', // Pure white background
      paper: '#ffffff', // White for paper-like elements
    },
  },
  typography: {
    fontFamily: 'Roboto, sans-serif',
    // You can define more specific typography settings here if needed
  },
  components: {
    // Global style overrides for MUI components can be placed here
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#ffffff', // Ensure body background is white
        },
      },
    },
  },
});

export default theme;
