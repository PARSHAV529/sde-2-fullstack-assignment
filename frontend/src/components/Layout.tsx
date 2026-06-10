import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">
            <span className="logo-icon">✉</span>
            Sequencer
          </h1>
        </div>
        <ul className="nav-links">
          <li>
            <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon">📋</span>
              Sequences
            </NavLink>
          </li>
          <li>
            <NavLink to="/mailboxes" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon">📊</span>
              Mailbox Quota
            </NavLink>
          </li>
        </ul>
        <div className="sidebar-footer">
          <div className="user-info">
            <span className="user-avatar">👤</span>
            <span className="user-email">{user?.email || 'User'}</span>
          </div>
          <button onClick={handleLogout} className="btn-logout">
            Sign Out
          </button>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
