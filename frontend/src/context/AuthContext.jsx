import { createContext, useContext, useEffect, useState } from "react";
import api from "../services/api";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(
    JSON.parse(localStorage.getItem("user")) || null
  );

  const [token, setToken] = useState(
    localStorage.getItem("token") || null
  );
  const [authLoading, setAuthLoading] = useState(!!localStorage.getItem('token'));

  useEffect(() => {
    if (!token) { setAuthLoading(false); return; }
    setAuthLoading(true);
    api.get('/auth/me').then(({ data }) => {
      localStorage.setItem('user', JSON.stringify(data));
      setUser(data);
    }).catch(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
    }).finally(() => setAuthLoading(false));
  }, [token]);

  async function login(email, password, role) {
    const loginPath = role === "admin" ? "/auth/login/admin" : role === "field_officer" ? "/auth/login/field-officer" : null;
    if (!loginPath) throw new Error("Choose the correct sign-in page for your account.");
    const response = await api.post(loginPath, {
      email,
      password,
    });

    const { token, user } = response.data;

    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));

    setToken(token);
    setUser(user);

    return user;
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated: !!token,
        authLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
