import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import NewPassword from './pages/NewPassword';
import Settings from './pages/Settings';
import Designer from './pages/Designer';
import VerificationPending from './pages/VerificationPending';
import Dashboard from './pages/Dashboard';

// Protected Route Component - requires authentication
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)'
      }}>
        Loading...
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return children;
}

// Public Route Component - redirects to designer if already logged in
function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)'
      }}>
        Loading...
      </div>
    );
  }
  
  if (user) {
    return <Navigate to="/designer" replace />;
  }
  
  return children;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/designer" replace />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes - redirect to designer if logged in */}
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
          <Route path="/NewPassword" element={<PublicRoute><NewPassword /></PublicRoute>} />
          
          {/* Verification route - simple message only */}
          <Route path="/verification-pending" element={<VerificationPending />} />
          
          {/* Protected routes - require authentication */}
          <Route path="/designer" element={<ProtectedRoute><Designer /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/dashboard" element={<AdminRoute><Dashboard /></AdminRoute>} />
          
          {/* Default route */}
          <Route path="/" element={<Navigate to="/login" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;