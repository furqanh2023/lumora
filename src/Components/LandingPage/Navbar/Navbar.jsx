import React, { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { useTheme } from "../../../contexts/ThemeContext";
import "./Navbar.css";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, authLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const closeMenu = () => setMenuOpen(false);
  const navLinks = [
    { name: "Home", path: "/", end: true },
    { name: "Features", path: "/services" },
    { name: "About", path: "/about" },
    { name: "Contact", path: "/contact" },
  ];

  return (
    <header className="public-header">
      <nav className="navbar" aria-label="Main navigation">
        <Link to="/" className="navbar-brand" onClick={closeMenu} aria-label="Lumora home">
          <img className="navbar-logo-image" src="/lumora-mark.svg" alt="" />
          <span className="navbar-brand-text"><strong>Lumora</strong><small>PEOPLE · IDEAS · STORIES · TOGETHER</small></span>
        </Link>
        <div id="main-navigation" className={`navbar-links ${menuOpen ? "open" : ""}`}>
          {navLinks.map((link) => (
            <NavLink key={link.name} to={link.path} end={link.end} className={({ isActive }) => `navbar-link ${isActive ? "active" : ""}`} onClick={closeMenu}>{link.name}</NavLink>
          ))}
          <div className="navbar-mobile-buttons">
            {!authLoading && user ? <Link to="/feed" className="navbar-signup" onClick={closeMenu}>Open Lumora <span aria-hidden="true">↗</span></Link> : <><Link to="/login" className="navbar-login" onClick={closeMenu}>Login</Link><Link to="/signup" className="navbar-signup" onClick={closeMenu}>Sign Up <span aria-hidden="true">↗</span></Link></>}
          </div>
        </div>
        <div className="navbar-actions">
          <button type="button" className="navbar-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>{theme === "dark" ? "☼" : "☾"}</button>
          {!authLoading && user ? <Link to="/feed" className="navbar-signup">Open Lumora <span aria-hidden="true">↗</span></Link> : <><Link to="/login" className="navbar-login">Login</Link><Link to="/signup" className="navbar-signup">Get Started <span aria-hidden="true">↗</span></Link></>}
        </div>
        <button type="button" className={`navbar-toggle ${menuOpen ? "is-open" : ""}`} onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="main-navigation"><span></span><span></span><span></span></button>
      </nav>
    </header>
  );
}
