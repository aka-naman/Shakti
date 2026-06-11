import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthProvider';
import { ThemeProvider } from './contexts/ThemeProvider';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import FormBuilderPage from './pages/FormBuilderPage';
import FormSubmitPage from './pages/FormSubmitPage';
import SubmissionsPage from './pages/SubmissionsPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import FileExplorerPage from './pages/FileExplorerPage';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/shared/files" element={<FileExplorerPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/dashboard"
              element={
                <AdminRoute>
                  <AdminDashboardPage />
                </AdminRoute>
              }
            />
            <Route
              path="/forms/:formId/builder/:versionId"
              element={
                <ProtectedRoute>
                  <FormBuilderPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/forms/:formId/submit"
              element={
                <ProtectedRoute>
                  <FormSubmitPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/forms/:formId/submissions"
              element={
                <ProtectedRoute>
                  <SubmissionsPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
