import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import GrantList from './pages/GrantList.jsx';
import GrantDetail from './pages/GrantDetail.jsx';
import Funders from './pages/Funders.jsx';
import Admin from './pages/Admin.jsx';
import Account from './pages/Account.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const navigate = useNavigate();

  const refresh = useCallback(() => api.get('/auth/me').then(setUser).catch(() => setUser(null)), []);

  useEffect(() => {
    refresh();
    const onSignedOut = () => setUser(null);
    window.addEventListener('grantapp:signed-out', onSignedOut);
    return () => window.removeEventListener('grantapp:signed-out', onSignedOut);
  }, [refresh]);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
    navigate('/');
  };

  if (user === undefined) return <div className="center-screen muted">Loading…</div>;
  if (!user) return <Login onSignedIn={refresh} />;

  const canManage = user.isSuperuser || user.programs.some((p) => p.access === 'manager');

  return (
    <AuthContext.Provider value={{ user, canManage, refresh }}>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">$</span>
            <span>Grant Tracker</span>
          </div>
          <nav className="nav">
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/grants">Grants</NavLink>
            <NavLink to="/funders">Funders</NavLink>
            {user.isSuperuser && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="user-menu">
            <NavLink to="/account" className="user-name" title={user.email}>
              {user.name}
              <span className="role-tag">{user.isSuperuser ? 'Superuser' : user.programs.map((p) => p.name).join(', ') || 'No programs'}</span>
            </NavLink>
            <button className="btn btn-ghost" onClick={logout}>Sign out</button>
          </div>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/grants" element={<GrantList />} />
            <Route path="/grants/:id" element={<GrantDetail />} />
            <Route path="/funders" element={<Funders />} />
            <Route path="/account" element={<Account />} />
            {user.isSuperuser && <Route path="/admin" element={<Admin />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AuthContext.Provider>
  );
}
