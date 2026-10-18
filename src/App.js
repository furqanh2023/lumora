import React, { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
} from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { ShieldAlert } from "./Components/Admin/AdminIcons";

import Home from "./Components/LandingPage/Home";
import { AboutPage, ServicesPage, ContactPage } from "./Components/PublicPages";
import Login from "./Components/Login/Login";
import Signup from "./Components/Signup/Signup";
import DashboardLayout from "./Components/Dashboard/DashboardLayout";
import {
  ProfilePage,
  SettingsPage,
  NotificationsPage,
} from "./Components/Dashboard/DashboardPages";
import { ExplorePage, SavedPage, ContentDetailPage } from "./Components/Community/CommunityPages";
import { SocialFeedPage, PeoplePage, FriendsPage, MessagesPage, CommunitiesPage, CommunityDetailPage, PersonProfilePage, PostDetailPage, SavedPostsPage, FollowListPage } from "./Components/Community/SocialPages";
import AdminOperationsPage from "./Components/Admin/AdminOperationsPage";
import "./Components/Community/CommunityPages.css";
import { ForgotPasswordPage, TermsPage } from "./Components/AuthExtras";
import AdminLayout from "./Components/Admin/AdminLayout";
import {
  AdminOverviewPage,
  AdminUsersPage,
  AdminContentPage,
  AdminCommentsPage,
  AdminReportsPage,
} from "./Components/Admin/AdminPages";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { db } from "./firebase";
import { isAdminAccount } from "./adminAccess";
import "./Components/AuthExtras.css";
import "./App.css";
import "./lumora-redesign.css";

function LoadingScreen({ message = "Preparing your Lumora workspace…" }) {
  return <div className="lumora-auth-loading"><span className="lumora-loading-mark">✧</span><p>{message}</p></div>;
}

function SuspendedAccountScreen() {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const handleExit = async () => {
    setBusy(true);
    try { await logout(); window.location.assign("/login"); }
    catch { setError("Unable to sign out. Please try again."); setBusy(false); }
  };
  return <div className="lumora-access-screen"><section className="lumora-access-card"><span className="lumora-access-icon"><ShieldAlert size={25} /></span><h1>Account access paused</h1><p>This Lumora account has been suspended by an administrator. Protected workspace data is unavailable. Contact the site administrator if you believe this is a mistake.</p>{error && <p role="alert">{error}</p>}<button type="button" onClick={handleExit} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button></section></div>;
}

function RequireAuth() {
  const { user, authLoading } = useAuth();
  const location = useLocation();
  const [profileState, setProfileState] = useState({ uid: "", loading: true, suspended: false });

  useEffect(() => {
    if (!user?.uid) {
      setProfileState({ uid: "", loading: false, suspended: false });
      return undefined;
    }
    setProfileState({ uid: user.uid, loading: true, suspended: false });
    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      (snapshot) => setProfileState({ uid: user.uid, loading: false, suspended: snapshot.exists() && snapshot.data().suspended === true }),
      () => setProfileState({ uid: user.uid, loading: false, suspended: false })
    );
    return unsubscribe;
  }, [user?.uid]);

  if (authLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  // Admin access is exempt from member suspension checks; the UI never offers self-suspension.
  const isAdminIdentity = isAdminAccount(user);
  if (profileState.uid !== user.uid || profileState.loading) return <LoadingScreen message="Checking account access…" />;
  if (profileState.suspended && !isAdminIdentity) return <SuspendedAccountScreen />;
  return <Outlet />;
}

function RequireAdmin() {
  const { user, authLoading } = useAuth();
  const location = useLocation();
  if (authLoading) return <LoadingScreen message="Verifying administrator access…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!isAdminAccount(user)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <Router>
          <Toaster position="top-right" gutter={10} toastOptions={{ duration: 3200, className: "lumora-toast", style: { border: "1px solid var(--border-color, #e1e7f5)", background: "var(--lumora-toast-bg, #fff)", color: "var(--lumora-toast-text, #172044)", padding: "12px 16px", maxWidth: "min(92vw, 420px)" }, success: { iconTheme: { primary: "#18a875", secondary: "#fff" } }, error: { iconTheme: { primary: "#d93654", secondary: "#fff" } } }} />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<DashboardLayout />}>
                <Route path="/dashboard" element={<Navigate to="/feed" replace />} />
                <Route path="/feed" element={<SocialFeedPage />} />
                <Route path="/people" element={<PeoplePage />} />
                <Route path="/people/:personId" element={<PersonProfilePage />} />
                <Route path="/friends" element={<FriendsPage />} />
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/messages/:conversationId" element={<MessagesPage />} />
                <Route path="/communities" element={<CommunitiesPage />} />
                <Route path="/communities/:groupId" element={<CommunityDetailPage />} />
                <Route path="/post/:postId" element={<PostDetailPage />} />
                <Route path="/explore" element={<ExplorePage />} />
                <Route path="/saved" element={<SavedPage />} />
                <Route path="/saved-posts" element={<SavedPostsPage />} />
                <Route path="/people/:personId/followers" element={<FollowListPage />} />
                <Route path="/people/:personId/following" element={<FollowListPage />} />
                <Route path="/content/:contentId" element={<ContentDetailPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
              </Route>
            </Route>
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminOverviewPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="content" element={<AdminContentPage />} />
                <Route path="comments" element={<AdminCommentsPage />} />
                <Route path="reports" element={<AdminReportsPage />} />
                <Route path="operations/:section" element={<AdminOperationsPage />} />
                <Route path="operations" element={<AdminOperationsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </ThemeProvider>
    </AuthProvider>
  );
}
