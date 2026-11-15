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

  async function login(email, password) {
    // One sign-in endpoint for every account: the stored role decides the workspace after this
    // returns. The old role-specific paths still exist for API clients but the UI no longer asks.
    const response = await api.post("/auth/login", {
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
