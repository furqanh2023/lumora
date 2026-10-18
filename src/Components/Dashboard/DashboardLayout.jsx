import { notify } from "../../ui/feedback";
import React, { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { get, onDisconnect, onValue, push, ref, remove, serverTimestamp, set, update } from "firebase/database";
import { db, rtdb } from "../../firebase";
import { isAdminAccount } from "../../adminAccess";
import "./DashboardLayout.css";

const navigation = [
  { label: "Home", path: "/feed", icon: "⌂" },
  { label: "Explore", path: "/explore", icon: "⌕" },
  { label: "Communities", path: "/communities", icon: "◉" },
  { label: "Messages", path: "/messages", icon: "☏" },
  { label: "Notifications", path: "/notifications", icon: "♧" },
  { label: "Profile", path: "/profile", icon: "◉" },
];

function initials(user) {
  const name = user?.displayName?.trim();
  if (name) {
    return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }
  return (user?.email?.[0] || "N").toUpperCase();
}

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isOwnerAccount = isAdminAccount(user);
  const roleLabel = isOwnerAccount ? "OWNER" : "USER";
  const roleBadgeClass = isOwnerAccount ? "role-badge owner-badge" : "role-badge user-badge";
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("lumora-sidebar-collapsed") === "true"; } catch { return false; } });
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [accountOnline, setAccountOnline] = useState(false);

  // Presence runs across the authenticated workspace. Each tab owns one connection
  // record; onDisconnect removes only that record so another live tab is not marked offline.
  useEffect(() => {
    if (!user?.uid) return undefined;
    const uid = user.uid;
    const statusRef = ref(rtdb, `status/${uid}`);
    const connectionsRef = ref(rtdb, `status/${uid}/connections`);
    const connectedRef = ref(rtdb, ".info/connected");
    let disposed = false;
    let currentConnectionRef = null;
    let heartbeatTimer = null;
    const stop = onValue(connectedRef, async (snapshot) => {
      if (disposed) return;
      if (snapshot.val() !== true) {
        setAccountOnline(false);
        if (heartbeatTimer) window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        currentConnectionRef = null;
        return;
      }
      if (currentConnectionRef) return;
      const connectionRef = push(connectionsRef);
      currentConnectionRef = connectionRef;
      try {
        // Register server cleanup before publishing the online state.
        await onDisconnect(connectionRef).remove();
        if (disposed) {
          await remove(connectionRef).catch(() => {});
          currentConnectionRef = null;
          return;
        }
        const publishHeartbeat = async () => {
          const lastChanged = serverTimestamp();
          await Promise.all([
            set(connectionRef, { state: "online", lastChanged }),
            update(statusRef, { state: "online", lastChanged }),
          ]);
        };
        await publishHeartbeat();
        if (!disposed) setAccountOnline(true);
        heartbeatTimer = window.setInterval(() => {
          if (!disposed && currentConnectionRef === connectionRef) {
            publishHeartbeat().catch((presenceError) => console.warn("[Lumora] Presence heartbeat failed.", presenceError.code || presenceError.message));
          }
        }, 25000);
      } catch (presenceError) {
        setAccountOnline(false);
        currentConnectionRef = null;
        console.warn("[Lumora] Realtime presence could not be published. Check Realtime Database rules.", presenceError.code || presenceError.message);
      }
    }, (presenceError) => {
      console.warn("[Lumora] Realtime Database connection listener failed.", presenceError.code || presenceError.message);
    });
    return () => {
      disposed = true;
      setAccountOnline(false);
      stop();
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      const connectionToRemove = currentConnectionRef;
      currentConnectionRef = null;
      if (connectionToRemove) {
        remove(connectionToRemove).then(async () => {
          try {
            const remaining = await get(connectionsRef);
            if (!remaining.exists() || !Object.keys(remaining.val() || {}).length) {
              await update(statusRef, { state: "offline", lastChanged: serverTimestamp() });
            }
          } catch (presenceError) {
            // The server-side onDisconnect cleanup remains the fallback on abrupt disconnects.
            console.warn("[Lumora] Presence cleanup will rely on onDisconnect.", presenceError.code || presenceError.message);
          }
        }).catch((presenceError) => console.warn("[Lumora] Could not remove this presence connection.", presenceError.code || presenceError.message));
      }
    };
  }, [user?.uid]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [chatNotificationsEnabled, setChatNotificationsEnabled] = useState(true);
  const [publicProfile, setPublicProfile] = useState({});

  useEffect(() => onSnapshot(doc(db, "users", user.uid, "settings", "preferences"), (snap) => {
    setChatNotificationsEnabled(snap.exists() ? snap.data().chat !== false : true);
  }, (error) => {
    console.warn("[Lumora] Could not load chat notification preference; keeping the default enabled.", error);
    setChatNotificationsEnabled(true);
  }), [user.uid]);
  useEffect(() => onSnapshot(query(collection(db, "users", user.uid, "notifications"), limit(100)), (snap) => {
    const rows = snap.docs.map((item) => item.data());
    const visibleUnread = rows.filter((item) => item.isRead === false
      && (chatNotificationsEnabled || !["chat", "group_chat_invite"].includes(item.type)));
    setUnreadNotifications(visibleUnread.length);
  }, (error) => {
    console.error("[Lumora] Could not load notification badge count.", error);
    setUnreadNotifications(0);
  }), [user.uid, chatNotificationsEnabled]);
  // Keep this query aligned with the Messages inbox query. The badge is based on
  // conversation read-state, never on notification documents/preferences, so it
  // remains visible even when the user disables message notifications.
  useEffect(() => onSnapshot(query(
    collection(db, "conversations"),
    where("memberUids", "array-contains", user.uid),
    orderBy("lastMessageAt", "desc"),
    limit(100),
  ), (snap) => {
    const count = snap.docs.reduce((total, entry) => {
      const conversation = entry.data();
      const unread = conversation.lastMessageSenderUid
        && conversation.lastMessageSenderUid !== user.uid
        && !(conversation.lastMessageReadBy || []).includes(user.uid);
      return total + (unread ? 1 : 0);
    }, 0);
    setUnreadMessages(count);
  }, (error) => {
    console.error("[Lumora] Could not load unread message badge count.", error);
    setUnreadMessages(0);
  }), [user.uid]);
  useEffect(() => onSnapshot(doc(db, "publicProfiles", user.uid), (snap) => setPublicProfile(snap.exists() ? snap.data() : {}), () => setPublicProfile({})), [user.uid]);
  const toggleSidebar = () => setCollapsed((old) => {
    const next = !old;
    try { localStorage.setItem("lumora-sidebar-collapsed", String(next)); } catch { /* session-only fallback */ }
    return next;
  });
  const navigate = useNavigate();

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      // Sign-out does not necessarily close the RTDB socket immediately, so clear this
      // account's presence records while Firebase Auth is still available.
      try {
        await remove(ref(rtdb, `status/${user.uid}/connections`));
        await update(ref(rtdb, `status/${user.uid}`), { state: "offline", lastChanged: serverTimestamp() });
      } catch (presenceError) {
        console.warn("[Lumora] Could not clear presence before logout; onDisconnect will clean it up.", presenceError.code || presenceError.message);
      }
      await logout();
      notify("You have been logged out successfully.", "success");
      navigate("/login", { replace: true });
    } catch {
      notify("Logout failed. Please try again.", "error");
      setLoggingOut(false);
    }
  };

  return (
    <div className={`lumora-workspace ${collapsed ? "sidebar-collapsed" : ""}`} data-theme={theme}>
      {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
      <aside className={`workspace-sidebar ${menuOpen ? "is-open" : ""}`}>
        <NavLink to="/" className="workspace-brand" onClick={() => setMenuOpen(false)}>
          <img className="workspace-brand-mark-image" src="/lumora-mark.svg" alt="" />
          <span><strong>Lumora</strong><small>YOUR DIGITAL SPACE</small></span>
        </NavLink>

        <button type="button" className="sidebar-collapse-button" onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? "›" : "‹"}</button>
        <div className="sidebar-label">YOUR LUMORA</div>
        <nav className="workspace-nav" aria-label="Workspace navigation">
          {navigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) => `workspace-nav-link ${isActive ? "active" : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-glyph" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.label === "Notifications" && unreadNotifications > 0 && <span className="nav-count-badge" aria-label={`${unreadNotifications} unread notifications`}>{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>}
              {item.label === "Messages" && unreadMessages > 0 && <span className="nav-count-badge message-count" aria-label={`${unreadMessages} unread messages`}>{unreadMessages > 99 ? "99+" : unreadMessages}</span>}
            </NavLink>
          ))}
          {isAdminAccount(user) && (
            <NavLink
              to="/admin"
              className={({ isActive }) => `workspace-nav-link admin-shortcut ${isActive ? "active" : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-glyph" aria-hidden="true">♜</span>
              <span>Admin panel</span>
            </NavLink>
          )}
        </nav>

      </aside>

      <div className="workspace-main">
        <header className="workspace-topbar">
          <button className="mobile-menu-button" type="button" onClick={() => setMenuOpen(true)} aria-label="Open navigation">☰</button>
          <div className="topbar-breadcrumb"><span>Workspace</span><b>/</b><strong>My account</strong></div>
          <div className="topbar-actions">
            <button className="icon-button topbar-theme-button" type="button" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? "☼" : "☾"}</button>
            <div className="account-menu-wrap">
              <button type="button" className={`topbar-user account-menu-trigger ${accountMenuOpen ? "is-open" : ""}`} onClick={() => setAccountMenuOpen((v) => !v)} aria-expanded={accountMenuOpen} aria-label="Open account menu">
                <span className="topbar-avatar">{(publicProfile.avatarURL || user?.photoURL) ? <img src={publicProfile.avatarURL || user.photoURL} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : initials(user)}</span>
                <span className="topbar-user-copy"><strong className="topbar-identity-line"><span className="topbar-display-name">{publicProfile.displayName || user?.displayName || user?.email?.split("@")[0] || "Member"}</span><span className={roleBadgeClass}>{roleLabel}</span></strong><span className="topbar-user-meta"><small title={user?.email || ""}>{user?.email || (publicProfile.username ? `@${publicProfile.username}` : "Personal account")}</small><span className={`account-active-status ${accountOnline ? "is-online" : "is-offline"}`}><i aria-hidden="true" />{accountOnline ? "Active now" : "Offline"}</span></span></span>
                <span className="topbar-chevron">⌄</span>
              </button>
              {accountMenuOpen && <button className="account-menu-dismiss" type="button" aria-label="Close account menu" onClick={() => setAccountMenuOpen(false)} />}
              <div className={`account-dropdown ${accountMenuOpen ? "is-open" : "is-closed"}`} aria-hidden={!accountMenuOpen}>
                <Link to="/profile" tabIndex={accountMenuOpen ? 0 : -1} className="account-dropdown-profile" onClick={() => setAccountMenuOpen(false)}><span className="account-dropdown-avatar">{(publicProfile.avatarURL || user?.photoURL) ? <img src={publicProfile.avatarURL || user.photoURL} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : initials(user)}</span><span className="account-dropdown-identity"><strong className="account-dropdown-name-line"><span>{publicProfile.displayName || user?.displayName || user?.email?.split("@")[0] || "Member"}</span><span className={roleBadgeClass}>{roleLabel}</span></strong><small className="account-dropdown-username">{publicProfile.username ? `@${publicProfile.username}` : "Personal account"}</small>{user?.email && <small className="account-dropdown-email">{user.email}</small>}<span className={`account-active-status ${accountOnline ? "is-online" : "is-offline"}`}><i aria-hidden="true" />{accountOnline ? "Active now" : "Offline"}</span><b>View your profile</b></span></Link>
                <div className="account-dropdown-divider" />
                <Link to="/saved-posts" tabIndex={accountMenuOpen ? 0 : -1} onClick={() => setAccountMenuOpen(false)}>☆ <span>Saved posts</span></Link>
                <Link to="/settings" tabIndex={accountMenuOpen ? 0 : -1} onClick={() => setAccountMenuOpen(false)}>⚙ <span>Settings &amp; privacy</span></Link>
                <button type="button" tabIndex={accountMenuOpen ? 0 : -1} onClick={() => { toggleTheme(); setAccountMenuOpen(false); }}>{theme === "dark" ? "☼" : "☾"} <span>Display &amp; accessibility</span><small>{theme === "dark" ? "Dark mode" : "Light mode"}</small></button>
                <button type="button" tabIndex={accountMenuOpen ? 0 : -1} onClick={handleLogout} disabled={loggingOut}>⇥ <span>{loggingOut ? "Signing out…" : "Log out"}</span></button>
              </div>
            </div>
          </div>
        </header>

        <main className="workspace-content"><Outlet /></main>
        <footer className="workspace-footer"><span>© {new Date().getFullYear()} Lumora</span><span>Made for your next chapter.</span></footer>
      </div>
    </div>
  );
}
