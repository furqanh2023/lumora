import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot, query, limit, getDoc, getDocs, doc, updateDoc, serverTimestamp, setDoc, deleteDoc, addDoc, where, writeBatch, arrayRemove } from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { auth, db } from "../../firebase";
import { saveUserProfile } from "../userProfile";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import "./DashboardPages.css";

function displayName(user) {
  return user?.displayName?.trim() || user?.email?.split("@")[0] || "there";
}

function providerName(user) {
  if ((user?.providerData || []).some((provider) => provider.providerId === "google.com")) return "Google";
  return "Email and password";
}

function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading-row">
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="page-heading-action">{action}</div>}
    </div>
  );
}

function MetricCard({ icon, label, value, detail, accent }) {
  return (
    <article className={`metric-card ${accent || ""}`}>
      <div className="metric-card-top"><span className="metric-icon">{icon}</span><span className="metric-live-dot" /></div>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function DashboardHome() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const name = displayName(user);
  const profileComplete = Boolean(user?.displayName?.trim() && user?.email);

  return (
    <div className="dashboard-page-content">
      <PageHeading eyebrow="OVERVIEW" title={`Welcome back, ${name}`} description="Your personal Lumora workspace is ready when you are." action={<span className="dashboard-date-chip"><span /> Account connected</span>} />

      <section className="dashboard-hero-card">
        <div className="dashboard-hero-glow glow-one" /><div className="dashboard-hero-glow glow-two" />
        <div className="dashboard-hero-copy">
          <span className="hero-overline"><span className="hero-overline-dot" /> YOUR SPACE IS READY</span>
          <h2>Make room for<br /><span>what matters.</span></h2>
          <p>Manage your account, personalize your experience, and keep everything organized in one calm workspace.</p>
          <Link className="hero-action-link" to="/profile">Complete your profile <span>↗</span></Link>
        </div>
        <div className="dashboard-hero-art" aria-hidden="true">
          <div className="art-orbit orbit-a" /><div className="art-orbit orbit-b" />
          <div className="art-window"><div className="art-window-bar"><i /><i /><i /></div><div className="art-window-body"><div className="art-side-line" /><div className="art-chart"><b /><b /><b /><b /><b /></div><div className="art-lines"><i /><i /><i /></div></div></div>
          <div className="art-floating-badge"><span>✦</span><div><strong>Lumora</strong><small>Your next chapter</small></div></div>
        </div>
      </section>

      <section className="dashboard-metrics" aria-label="Account summary">
        <MetricCard icon="◉" label="ACCOUNT STATUS" value="Active" detail="Authentication is connected" accent="metric-purple" />
        <MetricCard icon="✓" label="PROFILE STATUS" value={profileComplete ? "Ready" : "Almost there"} detail={profileComplete ? "Basic details are available" : "Add your display name"} accent="metric-green" />
        <MetricCard icon="↗" label="SIGN-IN METHOD" value={providerName(user)} detail="Verified by Firebase Auth" accent="metric-blue" />
      </section>

      <div className="dashboard-lower-grid">
        <section className="surface-card quick-actions-card">
          <div className="section-heading-row"><div><span className="section-kicker">GETTING STARTED</span><h2>Your next steps</h2></div><span className="card-sparkle">✦</span></div>
          <Link to="/explore" className="action-row"><span className="action-row-icon lavender">⌕</span><span className="action-row-copy"><strong>Explore published content</strong><small>Search topics, join discussions, and save useful items</small></span><span className="action-arrow">↗</span></Link>
          <Link to="/profile" className="action-row"><span className="action-row-icon lavender">◉</span><span className="action-row-copy"><strong>Personalize your profile</strong><small>Update the name shown across Lumora</small></span><span className="action-arrow">↗</span></Link>
          <Link to="/settings" className="action-row"><span className="action-row-icon peach">⚙</span><span className="action-row-copy"><strong>Adjust your preferences</strong><small>Choose the theme that feels right</small></span><span className="action-arrow">↗</span></Link>
          <Link to="/notifications" className="action-row"><span className="action-row-icon mint">♧</span><span className="action-row-copy"><strong>Check notifications</strong><small>Keep up with account updates</small></span><span className="action-arrow">↗</span></Link>
        </section>

        <section className="surface-card account-overview-card">
          <div className="section-heading-row"><div><span className="section-kicker">ACCOUNT OVERVIEW</span><h2>Your details</h2></div><Link to="/profile" className="text-link">Edit <span>↗</span></Link></div>
          <div className="account-identity"><div className="account-avatar">{(user?.displayName?.[0] || user?.email?.[0] || "N").toUpperCase()}</div><div className="account-identity-copy"><strong>{displayName(user)}</strong><span>{user?.email || "No email available"}</span></div><span className="verified-pill">✓ Verified session</span></div>
          <div className="account-detail-row"><span>Email address</span><strong>{user?.email || "Not available"}</strong></div>
          <div className="account-detail-row"><span>Login provider</span><strong>{providerName(user)}</strong></div>
          <button type="button" className="theme-preference-row" onClick={toggleTheme}><span className="theme-preference-symbol">{theme === "dark" ? "☼" : "☾"}</span><span><strong>Appearance</strong><small>Currently using {theme} mode</small></span><span className="theme-switch-label">Change</span></button>
        </section>
      </div>

      <div className="dashboard-footnote"><span className="footnote-icon">i</span><p>Your workspace, published content, saved items and moderated community discussions work together here. New comments stay private until approved by a moderator.</p></div>
    </div>
  );
}

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [profile, setProfile] = useState({ displayName: user?.displayName || "", username: "", bio: "", avatarURL: user?.photoURL || "", coverURL: "", coverPosition: { x: 50, y: 50 }, privacy: "public" });
  const coverDragRef = useRef(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [profileMeta, setProfileMeta] = useState({});
  const [profileActivity, setProfileActivity] = useState([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [publicSnap, userSnap] = await Promise.all([
          getDoc(doc(db, "publicProfiles", user.uid)), getDoc(doc(db, "users", user.uid)),
        ]);
        if (!active) return;
        const current = publicSnap.exists() ? publicSnap.data() : {};
        const base = userSnap.exists() ? userSnap.data() : {};
        setProfile({
          displayName: current.displayName || base.displayName || user.displayName || "",
          username: current.username || "", bio: current.bio || "",
          avatarURL: current.avatarURL || user.photoURL || "", coverURL: current.coverURL || "",
          coverPosition: { x: Number.isFinite(current.coverPosition?.x) ? current.coverPosition.x : 50, y: Number.isFinite(current.coverPosition?.y) ? current.coverPosition.y : 50 },
          privacy: current.privacy || "public",
        });
        setProfileMeta(current);
      } catch {
        if (active) setError("Profile could not be loaded. Check the latest Firestore rules and try again.");
      } finally { if (active) setLoadingProfile(false); }
    })();
    return () => { active = false; };
  }, [user]);

  useEffect(() => onSnapshot(query(collection(db, "profileActivity"), where("uid", "==", user.uid), limit(20)), (snapshot) => {
    const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    setProfileActivity(rows);
  }, () => setProfileActivity([])), [user.uid]);

  const coverPosition = profile.coverPosition || { x: 50, y: 50 };
  const clampPosition = (value) => Math.max(0, Math.min(100, value));
  const startCoverDrag = (event) => {
    if (!profile.coverURL || loading) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    coverDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPosition: { x: coverPosition.x, y: coverPosition.y }, width: rect.width || 1, height: rect.height || 1 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveCoverDrag = (event) => {
    const drag = coverDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setProfile((current) => ({ ...current, coverPosition: {
      x: clampPosition(drag.startPosition.x - (dx / drag.width) * 100),
      y: clampPosition(drag.startPosition.y - (dy / drag.height) * 100),
    } }));
  };
  const endCoverDrag = (event) => {
    if (coverDragRef.current?.pointerId === event.pointerId) coverDragRef.current = null;
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setMessage(""); setError("");
    const normalizedName = String(profile.displayName || "").trim();
    const normalizedUsername = String(profile.username || "").trim().toLowerCase().replace(/^@+/, "");
    const bio = String(profile.bio || "").trim();
    const avatarURL = String(profile.avatarURL || "").trim();
    const coverURL = String(profile.coverURL || "").trim();
    const validUrl = (value) => { if (!value) return true; try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } };
    if (!normalizedName || normalizedName.length > 80) { setError("Display name must contain 1–80 characters."); return; }
    if (!/^[a-z0-9_.]{3,20}$/.test(normalizedUsername)) { setError("Username must be 3–20 characters: lowercase letters, numbers, underscores or periods."); return; }
    if (bio.length > 240) { setError("Bio must be no longer than 240 characters."); return; }
    if (!validUrl(avatarURL) || !validUrl(coverURL)) { setError("Avatar and cover image must use a valid HTTP or HTTPS URL."); return; }
    const oldName = profileMeta.displayName || user.displayName || "";
    const oldUsername = profileMeta.username || "";
    const nameChanged = normalizedName !== oldName;
    const usernameChanged = normalizedUsername !== oldUsername;
    const cooldownOkay = (field) => {
      const value = profileMeta[field];
      if (!value) return true;
      const date = value?.toDate ? value.toDate() : new Date(value);
      return Number.isNaN(date.getTime()) || Date.now() - date.getTime() >= 90 * 24 * 60 * 60 * 1000;
    };
    const nameAllowed = !nameChanged || cooldownOkay("displayNameChangedAt");
    const usernameAllowed = !usernameChanged || cooldownOkay("usernameChangedAt");
    if ((nameChanged && !nameAllowed) || (usernameChanged && !usernameAllowed)) {
      setError("Your display name and username have a 90-day cooldown. Submit an urgent change request for administrator approval, or wait until the cooldown ends.");
      return;
    }
    setLoading(true);
    try {
      const profileRef = doc(db, "publicProfiles", user.uid);
      const usernameRef = doc(db, "usernames", normalizedUsername);
      const usernameSnapshot = await getDoc(usernameRef);
      if (usernameSnapshot.exists() && usernameSnapshot.data().uid !== user.uid) {
        setError("That username is already taken. Please choose another one.");
        setLoading(false);
        return;
      }
      const needsNewReservation = !usernameSnapshot.exists();
      let canReleaseOldReservation = false;
      if (oldUsername && oldUsername !== normalizedUsername) {
        const oldReservation = await getDoc(doc(db, "usernames", oldUsername));
        canReleaseOldReservation = oldReservation.exists() && oldReservation.data().uid === user.uid;
      }
      const newProfile = {
        uid: user.uid, displayName: normalizedName, username: normalizedUsername, bio,
        avatarURL, coverURL, coverPosition: { x: clampPosition(Number(profile.coverPosition?.x ?? 50)), y: clampPosition(Number(profile.coverPosition?.y ?? 50)) }, privacy: profile.privacy === "private" ? "private" : "public",
        updatedAt: serverTimestamp(),
        ...(nameChanged ? { displayNameChangedAt: serverTimestamp() } : {}),
        ...(usernameChanged ? { usernameChangedAt: serverTimestamp() } : {}),
      };
      const previousDisplayName = oldName;
      const publicSnap = await getDoc(profileRef);
      if (!publicSnap.exists()) newProfile.createdAt = serverTimestamp();
      // Reserve a unique username and write the matching profile atomically.
      // Firestore rules validate the reservation against getAfter(publicProfiles/{uid}).
      const batch = writeBatch(db);
      if (needsNewReservation) {
        batch.set(usernameRef, { uid: user.uid, username: normalizedUsername, createdAt: serverTimestamp() });
      }
      if (canReleaseOldReservation) batch.delete(doc(db, "usernames", oldUsername));
      batch.set(profileRef, newProfile, { merge: true });
      await batch.commit();
      if (nameChanged) {
        await updateProfile(auth.currentUser, { displayName: normalizedName });
        await saveUserProfile(auth.currentUser);
        await refreshUser();
      }
      if (nameChanged || usernameChanged) {
        try { await addDoc(collection(db, "profileActivity"), { uid: user.uid, actorUid: user.uid, action: "profile_updated", oldDisplayName: previousDisplayName, displayName: normalizedName, oldUsername, username: normalizedUsername, createdAt: serverTimestamp() }); } catch { /* Activity history is best-effort; profile save already succeeded. */ }
      }
      const refreshed = await getDoc(profileRef);
      setProfileMeta(refreshed.exists() ? refreshed.data() : newProfile);
      setMessage("Profile saved successfully. Your public details and image previews are updated.");
    } catch (saveError) {
      setError(saveError.code === "permission-denied"
        ? "Firestore denied this change. Publish the Lumora rules included in this release, then retry."
        : (saveError.message || "Unable to save your profile. Please try again."));
    } finally { setLoading(false); }
  };

  const submitUrgentRequest = async () => {
    setError(""); setMessage("");
    const proposedName = String(profile.displayName || "").trim();
    const proposedUsername = String(profile.username || "").trim().toLowerCase().replace(/^@+/, "");
    if (!proposedName || !/^[a-z0-9_.]{3,20}$/.test(proposedUsername)) { setError("Enter a valid display name and username before requesting approval."); return; }
    setLoading(true);
    try {
      await addDoc(collection(db, "profileRequests"), {
        uid: user.uid, email: user.email || "", currentDisplayName: profileMeta.displayName || user.displayName || "",
        currentUsername: profileMeta.username || "", proposedDisplayName: proposedName, proposedUsername,
        requestType: "urgent_profile_change", reason: "User requested an exception to the 90-day cooldown.",
        status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      setMessage("Urgent change request submitted. It will remain pending until an administrator reviews it.");
    } catch { setError("Could not submit the approval request. Publish the latest Firestore rules and retry."); }
    finally { setLoading(false); }
  };

  return <div className="dashboard-page-content">
    <PageHeading eyebrow="PERSONAL ACCOUNT" title="My profile" description="Your display name and username have a 90-day cooldown. Urgent exceptions require administrator approval." /><p className="field-help"><Link to={`/people/${user.uid}`}>View your public profile and timeline ↗</Link></p>
    <div className="profile-layout-grid">
      <section className="surface-card profile-summary-card">
        <div className={`profile-summary-banner ${profile.coverURL ? "is-draggable-cover" : ""}`} style={profile.coverURL ? { backgroundImage: `url("${profile.coverURL}")`, backgroundSize: "cover", backgroundPosition: `${coverPosition.x}% ${coverPosition.y}%` } : {}} onPointerDown={startCoverDrag} onPointerMove={moveCoverDrag} onPointerUp={endCoverDrag} onPointerCancel={endCoverDrag} title={profile.coverURL ? "Click and drag to reposition your cover photo" : undefined}><span aria-hidden="true">✦</span>{profile.coverURL && <small className="cover-drag-hint">Click and drag to reposition</small>}</div>
        {profile.avatarURL ? <img className="profile-large-avatar profile-avatar-image" src={profile.avatarURL} alt="Avatar preview" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <div className="profile-large-avatar">{(profile.displayName?.[0] || user?.email?.[0] || "L").toUpperCase()}</div>}
        <h2>{profile.displayName.trim() || user?.email?.split("@")[0] || "Lumora member"}</h2><p>{profile.username ? `@${profile.username}` : "Choose a unique username"}</p>
        {profile.bio && <p className="profile-bio-preview">{profile.bio}</p>}
        <div className="profile-status-pill"><span /> Account active</div><div className="profile-summary-divider" />
        <div className="profile-info-line"><span>Provider</span><strong>{providerName(user)}</strong></div><div className="profile-info-line"><span>Email verified</span><strong>{user?.emailVerified ? "Yes" : "Not yet"}</strong></div><div className="profile-info-line"><span>Profile visibility</span><strong>{profile.privacy === "private" ? "Private" : "Public"}</strong></div>
      </section>
      <section className="surface-card profile-form-card">
        <div className="section-heading-row"><div><span className="section-kicker">PROFILE INFORMATION</span><h2>Edit your public profile</h2></div><span className="profile-edit-glyph">✎</span></div>
        {loadingProfile ? <div className="form-loading">Loading profile…</div> : <form className="lumora-form" onSubmit={handleSave}>
          <label htmlFor="profile-name">Display name</label><input id="profile-name" type="text" value={profile.displayName} onChange={(e) => setProfile((v) => ({ ...v, displayName: e.target.value }))} maxLength={80} placeholder="Your name" required />
          <label htmlFor="profile-username">Unique username</label><div className="profile-username-input"><span>@</span><input id="profile-username" type="text" value={profile.username} onChange={(e) => setProfile((v) => ({ ...v, username: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0,20) }))} maxLength={20} minLength={3} pattern="[a-z0-9_.]{3,20}" placeholder="yourname" required /></div><p className="field-help">3–20 lowercase letters, numbers, periods or underscores. Unique usernames cannot be reused while claimed.</p>
          <label htmlFor="profile-bio">Bio</label><textarea id="profile-bio" value={profile.bio} onChange={(e) => setProfile((v) => ({ ...v, bio: e.target.value }))} maxLength={240} rows={3} placeholder="A little about you (240 characters max)" />
          <label htmlFor="profile-avatar">Avatar image URL</label><input id="profile-avatar" type="url" value={profile.avatarURL} onChange={(e) => setProfile((v) => ({ ...v, avatarURL: e.target.value }))} placeholder="https://example.com/avatar.jpg" />
          {profile.avatarURL && <div className="profile-url-preview"><img src={profile.avatarURL} alt="Avatar preview" onError={(e) => { e.currentTarget.dataset.error = "true"; }} /><span>Avatar preview</span></div>}
          <label htmlFor="profile-cover">Cover image URL</label><input id="profile-cover" type="url" value={profile.coverURL} onChange={(e) => setProfile((v) => ({ ...v, coverURL: e.target.value }))} placeholder="https://example.com/cover.jpg" />
          {profile.coverURL && <div className="profile-cover-preview is-draggable-cover" onPointerDown={startCoverDrag} onPointerMove={moveCoverDrag} onPointerUp={endCoverDrag} onPointerCancel={endCoverDrag} title="Click and drag the image to choose which part appears on your profile"><img src={profile.coverURL} alt="Cover preview" draggable="false" style={{ objectPosition: `${coverPosition.x}% ${coverPosition.y}%` }} onError={(e) => { e.currentTarget.dataset.error = "true"; }} /><span>Click and drag to reposition · Save profile to keep this position</span></div>}
          <label htmlFor="profile-privacy">Profile visibility</label><select id="profile-privacy" value={profile.privacy} onChange={(e) => setProfile((v) => ({ ...v, privacy: e.target.value }))}><option value="public">Public profile (posts stay public)</option><option value="private">Private profile (only you see profile details)</option></select>
          <label htmlFor="profile-email">Email address</label><input id="profile-email" type="email" value={user?.email || ""} readOnly disabled />
          {message && <div className="form-feedback success-feedback" role="status">✓ {message}</div>}{error && <div className="form-feedback error-feedback" role="alert">{error}</div>}
          <button className="primary-action-button" type="submit" disabled={loading}>{loading ? "Saving profile…" : "Save profile"}</button>
          <button className="secondary-action-button profile-urgent-request" type="button" onClick={submitUrgentRequest} disabled={loading}>Request urgent name/username change approval</button>
          <p className="field-help">Name and username changes are limited to once every 90 days. Urgent requests remain pending until approved by the administrator. Public posts and saved content follow separate visibility rules.</p>
        </form>}
      </section>
    </div>
    <section className="surface-card profile-history-card"><div className="section-heading-row"><div><span className="section-kicker">PROFILE HISTORY</span><h2>Recent profile changes</h2></div><span className="profile-edit-glyph">◷</span></div>{profileActivity.length === 0 ? <p className="field-help">Your profile-name and username changes will appear here.</p> : <div className="profile-history-list">{profileActivity.map((item) => <article className="profile-history-row" key={item.id}><span className="profile-history-dot">✓</span><div><strong>{item.action === "profile_updated" ? "Profile details updated" : String(item.action || "Profile activity").replaceAll("_", " ")}</strong><p>{item.oldDisplayName && item.displayName && item.oldDisplayName !== item.displayName ? `Display name: ${item.oldDisplayName} → ${item.displayName}` : "Profile information was changed."}{item.oldUsername && item.username && item.oldUsername !== item.username ? ` · Username: @${item.oldUsername} → @${item.username}` : ""}</p><small>{item.createdAt?.toDate ? item.createdAt.toDate().toLocaleString() : "Recent"}</small></div></article>)}</div>}</section>
  </div>;
}

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [preferences, setPreferences] = useState({ friendRequests: true, chat: true, replies: true, mentions: true, groupActivity: true, moderation: true, content: true, showOnline: false });
  const [blocked, setBlocked] = useState([]); const [muted, setMuted] = useState([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => {
    const unsubPreferences = onSnapshot(doc(db, "users", user.uid, "settings", "preferences"), (snap) => {
      if (snap.exists()) setPreferences((old) => ({ ...old, ...snap.data() }));
    }, () => setError("Notification preferences could not be loaded. Check the current Firestore rules."));
    const hydrateRelationshipRows = async (snapshot, setter) => {
      const rows = await Promise.all(snapshot.docs.map(async (entry) => {
        const data = entry.data();
        try {
          const profileSnap = await getDoc(doc(db, "publicProfiles", entry.id));
          return { id: entry.id, ...data, ...(profileSnap.exists() ? profileSnap.data() : {}) };
        } catch { return { id: entry.id, ...data }; }
      }));
      setter(rows);
    };
    const unsubBlocked = onSnapshot(query(collection(db, "users", user.uid, "blockedUsers"), limit(100)), (snap) => {
      hydrateRelationshipRows(snap, setBlocked).catch(() => setBlocked(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, () => setError("Blocked accounts could not be loaded. Check the current Firestore rules."));
    const unsubMuted = onSnapshot(query(collection(db, "users", user.uid, "mutedUsers"), limit(100)), (snap) => {
      hydrateRelationshipRows(snap, setMuted).catch(() => setMuted(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, () => setError("Muted accounts could not be loaded. Check the current Firestore rules."));
    return () => { unsubPreferences(); unsubBlocked(); unsubMuted(); };
  }, [user.uid]);
  const savePreferences = async () => {
    setBusy(true); setError(""); setNotice("");
    try { await setDoc(doc(db, "users", user.uid, "settings", "preferences"), { ...preferences, updatedAt: serverTimestamp() }, { merge: true }); setNotice("Your preferences were saved."); }
    catch { setError("Settings could not be saved. Publish the current Lumora security rules and retry."); }
    finally { setBusy(false); }
  };
  const removePerson = async (type, person) => {
    try {
      if (type === "blockedUsers") {
        // The account-level document drives the live UI. Also clear this user's legacy
        // blockedBy flag on any direct conversation so message sending is restored.
        const conversationSnap = await getDocs(query(collection(db, "conversations"), where("memberUids", "array-contains", user.uid), limit(100)));
        const matching = conversationSnap.docs.filter((entry) => {
          const data = entry.data();
          return data.type === "direct" && (data.memberUids || []).includes(person.id) && (data.blockedBy || []).includes(user.uid);
        });
        await Promise.all(matching.map((entry) => updateDoc(entry.ref, { blockedBy: arrayRemove(user.uid) })));
      }
      await deleteDoc(doc(db, "users", user.uid, type, person.id));
      if (type === "blockedUsers") setBlocked((old) => old.filter((x) => x.id !== person.id)); else setMuted((old) => old.filter((x) => x.id !== person.id));
      setNotice(type === "blockedUsers" ? "Member unblocked. Chat access is updating live." : "Member unmuted.");
    } catch (e) { setError(e.code === "permission-denied" ? "Could not sync this change. Confirm the latest Firestore rules are published." : "Could not update this list."); }
  };
  const categories = [
    ["friendRequests", "Friend requests", "When someone wants to connect with you."],
    ["chat", "Messages and chat", "New messages in your conversations."],
    ["replies", "Comments and replies", "Responses to your posts and conversations."],
    ["mentions", "Mentions", "When a member mentions you in content."],
    ["groupActivity", "Community activity", "Group posts, announcements and invitations."],
    ["moderation", "Moderation updates", "Changes to reports or moderated content."],
    ["content", "New published content", "Editorial content and platform announcements."],
  ];
  return (
    <div className="dashboard-page-content">
      <PageHeading eyebrow="PREFERENCES" title="Settings" description="Control your appearance, privacy, notification preferences and account protections." />
      {notice && <div className="form-feedback success-feedback" role="status">✓ {notice}</div>}{error && <div className="form-feedback error-feedback" role="alert">{error}</div>}
      <section className="surface-card settings-card">
        <div className="settings-section-title"><span className="settings-section-icon">◐</span><div><h2>Appearance</h2><p>Choose a comfortable look for Lumora.</p></div></div>
        <div className="theme-choice-grid">
          <button type="button" className={`theme-choice light-choice ${theme === "light" ? "selected" : ""}`} onClick={() => theme !== "light" && toggleTheme()} aria-pressed={theme === "light"}><span className="theme-preview light-preview"><i /><i /><i /><b /></span><span><strong>Light mode</strong><small>Bright, airy surfaces</small></span><span className="theme-choice-radio">{theme === "light" ? "✓" : ""}</span></button>
          <button type="button" className={`theme-choice dark-choice ${theme === "dark" ? "selected" : ""}`} onClick={() => theme !== "dark" && toggleTheme()} aria-pressed={theme === "dark"}><span className="theme-preview dark-preview"><i /><i /><i /><b /></span><span><strong>Dark mode</strong><small>Optional alternative</small></span><span className="theme-choice-radio">{theme === "dark" ? "✓" : ""}</span></button>
        </div>
      </section>
      <section className="surface-card settings-card">
        <div className="settings-section-title"><span className="settings-section-icon">♧</span><div><h2>In-app notifications</h2><p>Choose which activity should appear in your notification centre. These are in-app notices, not email or push notifications.</p></div></div>
        <div className="lumora-preference-list">{categories.map(([key,title,description]) => <label className="lumora-preference-row" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={preferences[key] !== false} onChange={(e) => setPreferences((old) => ({ ...old, [key]: e.target.checked }))}/></label>)}</div>
        <div className="settings-footer-action"><span>Preferences apply where each event is generated by Lumora.</span><button className="primary-action-button" type="button" onClick={savePreferences} disabled={busy}>{busy ? "Saving…" : "Save notification preferences"}</button></div>
      </section>
      <section className="surface-card settings-card">
        <div className="settings-section-title"><span className="settings-section-icon">♙</span><div><h2>Privacy and account</h2><p>Public posts can be discovered. Private profile details, settings and saved content remain protected.</p></div></div>
        <div className="settings-account-row"><span>Email address</span><strong>{user?.email || "Not available"}</strong></div><div className="settings-account-row"><span>Sign-in method</span><strong>{providerName(user)}</strong></div><div className="settings-account-row"><span>Authentication status</span><strong className="settings-status">Signed in</strong></div>
        <div className="settings-footer-action"><span>Display name and username changes follow a 90-day cooldown. Urgent exceptions require admin approval.</span><Link to="/profile" className="secondary-action-button">Edit profile ↗</Link></div>
      </section>
      <div className="settings-list-grid"><section className="surface-card settings-card"><div className="settings-section-title"><span className="settings-section-icon">⊘</span><div><h2>Blocked accounts ({blocked.length})</h2><p>Members you have blocked.</p></div></div>{blocked.length ? blocked.map((item) => <div className="lumora-list-row" key={item.id}><span>{item.displayName || item.username || item.uid || item.id}</span><button type="button" onClick={() => removePerson("blockedUsers", item)}>Unblock</button></div>) : <p className="field-help">You have not blocked any accounts.</p>}</section>
      <section className="surface-card settings-card"><div className="settings-section-title"><span className="settings-section-icon">◌</span><div><h2>Muted accounts ({muted.length})</h2><p>Members whose activity you muted.</p></div></div>{muted.length ? muted.map((item) => <div className="lumora-list-row" key={item.id}><span>{item.displayName || item.username || item.uid || item.id}</span><button type="button" onClick={() => removePerson("mutedUsers", item)}>Unmute</button></div>) : <p className="field-help">You have not muted any accounts.</p>}</section></div>
      <p className="settings-note">Security rules—not interface controls—protect profile fields, saved content, chats, and admin actions. In-app notifications do not guarantee delivery while the app is closed.</p>
    </div>
  );
}

export function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [chatNotificationsEnabled, setChatNotificationsEnabled] = useState(true);

  useEffect(() => onSnapshot(doc(db, "users", user.uid, "settings", "preferences"), (snap) => {
    setChatNotificationsEnabled(snap.exists() ? snap.data().chat !== false : true);
  }, () => setChatNotificationsEnabled(true)), [user.uid]);

  useEffect(() => {
    const notificationsRef = collection(db, "users", user.uid, "notifications");
    const notificationsQuery = query(notificationsRef, limit(50));
    const unsubscribe = onSnapshot(notificationsQuery, (snapshot) => {
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setNotifications(items);
      setLoading(false);
      setLoadError("");
    }, (error) => {
      setLoadError(error.code === "permission-denied"
        ? "Notifications access was denied. Publish the current Lumora Firestore rules."
        : "Notifications could not be loaded right now.");
      setLoading(false);
    });
    return unsubscribe;
  }, [user.uid]);

  const markRead = async (item) => {
    if (item.isRead) return;
    setBusy(item.id); setNotice(""); setLoadError("");
    try {
      await updateDoc(doc(db, "users", user.uid, "notifications", item.id), {
        isRead: true,
        readAt: serverTimestamp(),
      });
      setNotice("Notification marked as read.");
    } catch (error) {
      setLoadError(error.code === "permission-denied" ? "Firestore rules do not allow marking notifications as read. Publish the current rules." : "Could not update this notification.");
    } finally { setBusy(""); }
  };

  const markAllRead = async () => {
    const unread = notifications.filter((item) => !item.isRead
      && (chatNotificationsEnabled || !["chat", "group_chat_invite"].includes(item.type)));
    for (const item of unread) await markRead(item);
    if (unread.length) setNotice("All visible notifications have been marked as read.");
  };

  const visibleNotifications = notifications.filter((item) =>
    chatNotificationsEnabled || !["chat", "group_chat_invite"].includes(item.type));
  const unreadCount = visibleNotifications.filter((item) => !item.isRead).length;

  return (
    <div className="dashboard-page-content">
      <PageHeading eyebrow="YOUR UPDATES" title="Notifications" description="Review community replies and account updates. Mark items as read to keep your inbox organized." action={unreadCount > 0 ? <button type="button" className="secondary-action-button" onClick={markAllRead}>Mark all as read ({unreadCount})</button> : null} />
      {loadError && <div className="community-error" role="alert">{loadError}</div>}
      {notice && <div className="community-success" role="status">{notice}</div>}
      <section className="surface-card notifications-card">
        {loading ? <div className="notification-empty"><span className="notification-empty-icon">♧</span><h2>Checking for updates…</h2><p>Your latest notifications will appear here.</p></div>
          : loadError && notifications.length === 0 ? <div className="notification-empty"><span className="notification-empty-icon error-icon">!</span><h2>Could not load notifications</h2><p>{loadError}</p></div>
          : visibleNotifications.length === 0 ? <div className="notification-empty"><span className="notification-empty-icon">♧</span><h2>You’re all caught up</h2><p>Replies to your comments and account updates will appear here.</p><Link to="/explore" className="secondary-action-button">Explore content</Link></div>
          : <div className="notification-list">{visibleNotifications.map((item) => <article className={`notification-item ${item.isRead ? "notification-is-read" : "notification-is-unread"}`} key={item.id}><span className="notification-item-icon">{item.isRead ? "✓" : "✦"}</span><div className="notification-item-copy"><h3>{item.title || "Lumora update"}</h3><p>{item.message || item.body || "You have a new update."}</p><small>{item.createdAt?.toDate ? item.createdAt.toDate().toLocaleString() : "Recent"}</small><div className="notification-item-actions">{item.link && <Link to={item.link}>Open ↗</Link>}{!item.isRead && <button type="button" onClick={() => markRead(item)} disabled={busy === item.id}>{busy === item.id ? "Saving…" : "Mark as read"}</button>}</div></div>{!item.isRead && <span className="notification-unread-dot" aria-label="Unread" />}</article>)}</div>}
      </section>
    </div>
  );
}
