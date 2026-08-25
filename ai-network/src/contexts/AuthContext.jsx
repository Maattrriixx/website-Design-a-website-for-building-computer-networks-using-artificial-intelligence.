import { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as API from '../services/api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const u = await API.AuthAPI.me();
        setUser(u);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  const login = async (email, password) => {
    const u = await API.AuthAPI.login(email, password);
    setUser(u);
    return u;
  };

  const register = async (name, email, password) => {
    const u = await API.AuthAPI.register(name, email, password);
    setUser(u);
    return u;
  };

  const logout = async (navigate = null) => {
    await API.AuthAPI.logout();
    setUser(null);
    if (navigate) {
      navigate('/login');
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);