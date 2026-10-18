import { notify } from "../../ui/feedback";
import React, { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity, BarChart3, ChevronRight, FileText, LayoutDashboard,
  LogOut, Menu, MessageSquare, Moon, ShieldCheck, Sun, Users,
} from "./AdminIcons";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import "./Admin.css";

const adminNav = [
  { label: "Overview", to: "/admin", icon: LayoutDashboard, end: true },
  { label: "Users", to: "/admin/users", icon: Users },
  { label: "Content", to: "/admin/content", icon: FileText },
  { label: "Comments", to: "/admin/comments", icon: MessageSquare },
  { label: "Reports", to: "/admin/reports", icon: BarChart3 },
  { label: "Announcements", to: "/admin/operations/announcements", icon: Activity },
  { label: "Audit log", to: "/admin/operations/audit", icon: Activity },
  { label: "Settings & roles", to: "/admin/operations/roles", icon: ShieldCheck },
  { label: "Back to site", to: "/feed", icon: ChevronRight },
];

const pageTitles = {
  "/admin": "Overview",
  "/admin/users": "User management",
  "/admin/content": "Content management",
  "/admin/comments": "Comment moderation",
  "/admin/reports": "Reports & analytics",
  "/admin/operations": "Operations",
  "/admin/operations/announcements": "Announcements",
  "/admin/operations/audit": "Audit log",
  "/admin/operations/roles": "Settings & roles",
};

function getInitial(user) {
  const value = user?.displayName?.trim() || user?.email || "F";
  return value.charAt(0).toUpperCase();
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const pageTitle = pageTitles[location.pathname] || "Admin workspace";

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      notify("You have been logged out successfully.", "success");
      navigate("/login", { replace: true });
    } catch {
      notify("Unable to log out. Please try again.", "error");
      setLoggingOut(false);
    }
  };

  return (
    <div className={`lumora-admin theme-${theme}`}>
      {mobileOpen && (
        <button className="admin-backdrop" type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
      )}
      <aside className={`admin-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <NavLink to="/admin" className="admin-brand" onClick={() => setMobileOpen(false)}>
          <img className="admin-brand-mark-image" src="/lumora-mark.svg" alt="" />
          <span><strong>Lumora</strong><small>ADMIN CONSOLE</small></span>
        </NavLink>

        <div className="admin-sidebar-label">MANAGEMENT</div>
        <nav className="admin-nav" aria-label="Admin navigation">
          {adminNav.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `admin-nav-link ${isActive ? "active" : ""}`}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              <ChevronRight className="admin-nav-chevron" size={15} />
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-spacer" />
        <div className="admin-security-note">
          <span className="admin-security-icon"><ShieldCheck size={18} /></span>
          <strong>Protected workspace</strong>
          <p>Admin actions are restricted by Firebase security rules.</p>
        </div>
        <button className="admin-theme-toggle" type="button" onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          <span>{theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}</span>
        </button>
        <div className="admin-sidebar-user">
          <span className="admin-user-avatar">{getInitial(user)}</span>
          <span className="admin-user-meta"><strong>{user?.displayName || "Lumora Admin"}</strong><small>{user?.email}</small></span>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button className="admin-mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="admin-breadcrumb"><span>Admin console</span><b>/</b><strong>{pageTitle}</strong></div>
          <div className="admin-topbar-actions">
            <span className="admin-secure-chip"><span /> Authorized administrator</span>
            <button className="admin-top-icon" type="button" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="admin-logout" type="button" onClick={handleLogout} disabled={loggingOut}>
              <LogOut size={16} /> <span>{loggingOut ? "Signing out…" : "Log out"}</span>
            </button>
          </div>
        </header>

        <main className="admin-content"><Outlet /></main>
        <footer className="admin-footer"><span>© {new Date().getFullYear()} Lumora</span><span><Activity size={13} /> Admin activity is recorded where supported</span></footer>
      </div>
    </div>
  );
}
