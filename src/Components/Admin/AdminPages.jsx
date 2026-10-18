import React, { useCallback, useEffect, useMemo, useState } from "react";
import { confirmDialog, promptDialog } from "../../ui/feedback";
import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDocs, getDoc,
  limit, orderBy, query, serverTimestamp, updateDoc, where, writeBatch,
} from "firebase/firestore";
import {
  Activity, AlertTriangle, ArrowDownToLine, BarChart3, Check, CheckCircle2, CircleHelp,
  FileText, MessageSquare, Pencil, Plus, RefreshCw, Search,
  ShieldAlert, ShieldCheck, Trash2, Users, X, Eye, EyeOff,
} from "./AdminIcons";
import { auth, db } from "../../firebase";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { isAdminAccount } from "../../adminAccess";
const COLLECTION_LIMIT = 500;

function readableError(error) {
  if (error?.code === "permission-denied") {
    return "Firebase denied this operation. Confirm that the latest firestore.rules file has been published and that you are signed in with the authorized furqan@gmail.com account and matching UID.";
  }
  if (error?.code === "unavailable") return "Firebase is temporarily unavailable. Check your connection and try again.";
  return error?.message || "Something went wrong. Please try again.";
}

function dateLabel(value) {
  if (!value) return "—";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function timestampValue(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function statusClass(status) {
  return `admin-status admin-status-${String(status || "unknown").toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

async function writeAuditEvent({ action, targetType, targetId = "", details = "" }) {
  const actor = auth.currentUser;
  if (!isAdminAccount(actor)) {
    throw new Error("The authorized administrator session is required for this action.");
  }
  await addDoc(collection(db, "auditLogs"), {
    action,
    targetType,
    targetId: String(targetId || ""),
    details: String(details || "").slice(0, 500),
    actorUid: actor.uid,
    actorEmail: actor.email,
    createdAt: serverTimestamp(),
  });
}

async function notifyMembersOfPublishedContent({ contentId, title, category, actorUid }) {
  // Browser-side fan-out is intentionally capped for Firebase Spark; no paid scheduler is assumed.
  const memberSnapshot = await getDocs(query(collection(db, "users"), limit(200)));
  const candidates = memberSnapshot.docs.filter((member) => member.id !== actorUid);
  const preferenceResults = [];
  for (let index = 0; index < candidates.length; index += 10) {
    const chunkResults = await Promise.all(candidates.slice(index, index + 10).map(async (member) => {
      try {
        const preference = await getDoc(doc(db, "users", member.id, "settings", "preferences"));
        return !preference.exists() || preference.data().content !== false ? member : null;
      } catch { return null; }
    }));
    preferenceResults.push(...chunkResults);
  }
  const recipients = preferenceResults.filter(Boolean);
  if (!recipients.length) return 0;
  let delivered = 0;
  // Rules read one preference document per recipient, so keep atomic batches small
  // enough to stay below Firestore's per-request document-access-call limit.
  for (let index = 0; index < recipients.length; index += 10) {
    const batch = writeBatch(db);
    recipients.slice(index, index + 10).forEach((member) => {
      const notificationRef = doc(collection(db, "users", member.id, "notifications"));
      batch.set(notificationRef, {
        type: "content",
        title: "New content on Lumora",
        message: `“${String(title || "New content").slice(0, 140)}” has been published${category ? ` in ${String(category).slice(0, 60)}` : ""}.`,
        contentId,
        contentTitle: String(title || "Untitled content").slice(0, 140),
        sourceCommentId: "",
        parentCommentId: "",
        link: `/content/${contentId}`,
        isRead: false,
        createdAt: serverTimestamp(),
        createdByUid: actorUid,
      });
    });
    try { await batch.commit(); delivered += recipients.slice(index, index + 10).length; }
    catch { /* Publishing must not be reported as failed only because fan-out was denied. */ }
  }
  return delivered;
}

function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="admin-page-heading">
      <div>
        <div className="admin-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

function StateMessage({ kind = "info", children }) {
  if (!children) return null;
  return <div className={`admin-state admin-state-${kind}`} role={kind === "error" ? "alert" : "status"}>{kind === "error" ? <AlertTriangle size={16} /> : kind === "success" ? <CheckCircle2 size={16} /> : <CircleHelp size={16} />}<span>{children}</span></div>;
}

function EmptyState({ icon: Icon = FileText, title, description }) {
  return <div className="admin-empty"><span className="admin-empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{description}</p></div>;
}

function SearchField({ value, onChange, placeholder = "Search records…" }) {
  return <div className="admin-search"><Search size={16} /><input className="admin-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>;
}

function MetricCard({ icon: Icon, label, value, detail, color = "" }) {
  return <article className="admin-metric-card"><div className="admin-metric-top"><span className={`admin-metric-icon ${color}`}><Icon size={19} /></span><span className="admin-metric-trend">Live data</span></div><p className="admin-metric-label">{label}</p><strong className="admin-metric-value">{value ?? "—"}</strong><small className="admin-metric-detail">{detail}</small></article>;
}

function LoadingRow({ text = "Loading records…" }) {
  return <div className="admin-empty"><span className="admin-spin" /><p>{text}</p></div>;
}

function AdminUserAvatar({ src, initial, className = "admin-table-avatar" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <span className={className} aria-hidden="true">{src && !failed ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initial}</span>;
}

export function AdminOverviewPage() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const names = ["users", "content", "comments", "reports"];
      const countResults = await Promise.all(names.map((name) => getCountFromServer(collection(db, name))));
      const nextStats = {};
      names.forEach((name, index) => { nextStats[name] = countResults[index].data().count; });
      const activitySnapshot = await getDocs(query(collection(db, "auditLogs"), limit(30)));
      const rows = activitySnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
      rows.sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt));
      setStats(nextStats);
      setActivity(rows.slice(0, 8));
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  return <div className="admin-page">
    <PageHeading eyebrow="SYSTEM OVERVIEW" title="Good to see you, Admin." description="A live snapshot of your Lumora workspace and moderation activity." action={<button className="admin-secondary-btn" type="button" onClick={loadDashboard} disabled={loading}><RefreshCw size={15} /> Refresh</button>} />
    <StateMessage kind="error">{error}</StateMessage>
    <div className="admin-metric-grid">
      <MetricCard icon={Users} label="REGISTERED USERS" value={loading && !stats ? "…" : stats?.users ?? 0} detail="Profiles stored in Firestore" />
      <MetricCard icon={FileText} label="CONTENT ITEMS" value={loading && !stats ? "…" : stats?.content ?? 0} detail="Draft, published and hidden" />
      <MetricCard icon={MessageSquare} label="COMMENTS" value={loading && !stats ? "…" : stats?.comments ?? 0} detail="Records available to moderate" />
      <MetricCard icon={ShieldAlert} label="USER REPORTS" value={loading && !stats ? "…" : stats?.reports ?? 0} detail="Reports submitted for review" />
    </div>
    <div className="admin-grid-two">
      <section className="admin-panel">
        <div className="admin-panel-header"><div><h2>Recent admin activity</h2><p>Recent actions recorded in the audit log</p></div><Activity size={18} /></div>
        <div className="admin-panel-body">
          {loading && !stats ? <LoadingRow /> : activity.length === 0 ? <EmptyState icon={Activity} title="No activity recorded yet" description="Your moderation and management actions will appear here as they are performed." /> : <div className="admin-activity-list">{activity.map((item) => <article className="admin-activity-item" key={item.id}><span className="admin-activity-mark"><Activity size={15} /></span><div className="admin-activity-copy"><strong>{String(item.action || "Admin action").replaceAll("_", " ")}</strong><p>{item.details || `${item.targetType || "Record"}${item.targetId ? ` · ${item.targetId}` : ""}`}</p><small>{dateLabel(item.createdAt)} · {item.actorEmail || "Administrator"}</small></div></article>)}</div>}
        </div>
      </section>
      <section className="admin-panel">
        <div className="admin-panel-header"><div><h2>Management shortcuts</h2><p>Jump straight to a workspace</p></div></div>
        <div className="admin-panel-body"><div className="admin-quick-links">
          <Link className="admin-quick-link" to="/admin/users"><span className="admin-quick-link-icon"><Users size={18} /></span><span className="admin-quick-link-copy"><strong>Review users</strong><small>Search accounts and manage suspension</small></span><ChevronRightIcon /></Link>
          <Link className="admin-quick-link" to="/admin/content"><span className="admin-quick-link-icon"><FileText size={18} /></span><span className="admin-quick-link-copy"><strong>Manage content</strong><small>Create, edit, publish or hide content</small></span><ChevronRightIcon /></Link>
          <Link className="admin-quick-link" to="/admin/comments"><span className="admin-quick-link-icon"><MessageSquare size={18} /></span><span className="admin-quick-link-copy"><strong>Moderate comments</strong><small>Approve, remove and restore comments</small></span><ChevronRightIcon /></Link>
          <Link className="admin-quick-link" to="/admin/reports"><span className="admin-quick-link-icon"><BarChart3Icon /></span><span className="admin-quick-link-copy"><strong>Reports & analytics</strong><small>Review reports and export CSV summaries</small></span><ChevronRightIcon /></Link>
        </div></div>
      </section>
    </div>
    <div style={{ marginTop: 17 }}><StateMessage kind="info">Counts come from Firestore aggregate queries. New collections will show zero until real records are created; no sample data is fabricated.</StateMessage></div>
  </div>;
}

function ChevronRightIcon() { return <span aria-hidden="true" style={{ color: "var(--admin-muted)", fontSize: 20 }}>›</span>; }
function BarChart3Icon() { return <BarChart3 size={18} />; }

export function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pendingUser, setPendingUser] = useState(null);
  const [reason, setReason] = useState("Repeated policy violations");
  const [page, setPage] = useState(1);
  const [publicProfiles, setPublicProfiles] = useState({});
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const [previewUser, setPreviewUser] = useState(null);
  const { user: adminUser } = useAuth();

  useEffect(() => {
    if (!previewUser) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setPreviewUser(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewUser]);

  const loadUsers = useCallback(async () => {
    setLoading(true); setError(""); setPublicProfiles({}); setProfileRefreshKey((value) => value + 1);
    try {
      const snapshot = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(COLLECTION_LIMIT)));
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      setUsers(rows);
    } catch (loadError) { setError(readableError(loadError)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filteredUsers = useMemo(() => users.filter((item) => {
    const haystack = `${item.displayName || ""} ${item.email || ""} ${item.uid || item.id}`.toLowerCase();
    const statusMatches = statusFilter === "all" || (statusFilter === "suspended" ? item.suspended === true : item.suspended !== true);
    return haystack.includes(search.toLowerCase()) && statusMatches;
  }), [users, search, statusFilter]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const pageUsers = useMemo(() => filteredUsers.slice((page - 1) * pageSize, page * pageSize), [filteredUsers, page]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);
  useEffect(() => {
    let active = true;
    Promise.all(pageUsers.map(async (item) => {
      try { const profileId = item.uid || item.id;
        const snap = await getDoc(doc(db, "publicProfiles", profileId));
        return [item.id, snap.exists() ? snap.data() : {}]; }
      catch (profileError) {
        if (profileError?.code === "permission-denied") setError("Profile pictures and previews were denied by Firestore. Publish the current firestore.rules file, then refresh this directory.");
        return [item.id, {}];
      }
    })).then((rows) => { if (active) setPublicProfiles((old) => ({ ...old, ...Object.fromEntries(rows) })); });
    return () => { active = false; };
  }, [pageUsers, profileRefreshKey]);

  const confirmSuspension = async () => {
    if (!pendingUser) return;
    const target = pendingUser;
    if (target.id === adminUser?.uid) {
      setError("The administrator account cannot suspend itself."); setPendingUser(null); return;
    }
    setBusyId(target.id); setError(""); setNotice("");
    const suspended = !target.suspended;
    try {
      await updateDoc(doc(db, "users", target.id), {
        suspended,
        suspensionReason: suspended ? (reason.trim() || "Suspended by administrator") : "",
        suspendedAt: suspended ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
      await writeAuditEvent({
        action: suspended ? "user_suspended" : "user_restored",
        targetType: "user", targetId: target.id,
        details: `${target.email || target.id} ${suspended ? "suspended" : "restored"}${suspended ? `: ${reason.trim() || "Suspended by administrator"}` : ""}`,
      });
      setNotice(`${target.email || "User"} ${suspended ? "has been suspended" : "has been restored"}.`);
      setPendingUser(null);
      await loadUsers();
    } catch (actionError) { setError(readableError(actionError)); }
    finally { setBusyId(""); }
  };

  return <div className="admin-page">
    <PageHeading eyebrow="ACCOUNT DIRECTORY" title="User management" description="Search member profiles and apply an app-level suspension when needed." action={<button className="admin-secondary-btn" type="button" onClick={loadUsers} disabled={loading}><RefreshCw size={15} /> Refresh</button>} />
    <StateMessage kind="error">{error}</StateMessage><StateMessage kind="success">{notice}</StateMessage>
    <div className="admin-toolbar"><SearchField value={search} onChange={setSearch} placeholder="Search name, email or UID…" /><select className="admin-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter users by status"><option value="all">All accounts</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
    <section className="admin-panel">
      <div className="admin-panel-header"><div><h2>Registered accounts</h2><p>{pageUsers.length} shown on this page · {filteredUsers.length} matching · maximum {COLLECTION_LIMIT} records fetched per refresh</p></div><span className="admin-status admin-status-active">{users.filter((item) => item.suspended !== true).length} active</span></div>
      {loading ? <LoadingRow text="Loading user profiles…" /> : filteredUsers.length === 0 ? <EmptyState icon={Users} title="No matching users" description={users.length ? "Try changing your search or status filter." : "User profiles will appear after people sign in and their profile documents are created."} /> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Member</th><th>Provider</th><th>Joined</th><th>Status</th><th>View</th><th>Action</th></tr></thead><tbody>
        {pageUsers.map((item) => {
          const profile = publicProfiles[item.id] || {};
          const avatarURL = profile.avatarURL || profile.avatarUrl || profile.avatar || profile.photoURL || item.avatarURL || item.avatarUrl || item.avatar || item.photoURL || "";
          const initial = (profile.displayName || item.displayName || item.email || "U").charAt(0).toUpperCase();
          const isSelf = item.id === adminUser?.uid;
          return <tr key={item.id}><td><div className="admin-table-primary"><AdminUserAvatar src={avatarURL} initial={initial} /><span className="admin-table-copy"><strong>{profile.displayName || item.displayName || "Unnamed user"}</strong><small>{item.email || item.id}</small></span></div></td><td>{item.provider === "google.com" ? "Google" : item.provider === "password" ? "Email/password" : "—"}</td><td className="admin-cell-muted">{dateLabel(item.createdAt)}</td><td><span className={statusClass(item.suspended ? "suspended" : "active")}>{item.suspended ? "Suspended" : "Active"}</span></td><td><button className="admin-secondary-btn admin-user-view-btn" type="button" onClick={() => setPreviewUser({ ...item, ...profile, id: item.id, email: item.email || profile.email })}><Eye size={14} /> View</button></td><td><button className={item.suspended ? "admin-secondary-btn" : "admin-danger-btn"} type="button" disabled={isSelf || busyId === item.id} title={isSelf ? "You cannot suspend your own admin account" : "Change account status"} onClick={() => { setPendingUser(item); setReason(item.suspensionReason || "Repeated policy violations"); }}>{busyId === item.id ? "Working…" : item.suspended ? <><Check size={14} /> Restore</> : <><ShieldAlert size={14} /> Suspend</>}</button></td></tr>;
        })}
      </tbody></table><div className="admin-pagination"><span>Page {page} of {pageCount}</span><div><button className="admin-secondary-btn" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button className="admin-secondary-btn" type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button></div></div></div>}
    </section>
    <StateMessage kind="info">Suspension blocks Lumora's protected data operations when current Firestore rules are published. It does not disable or delete the Firebase Authentication account.</StateMessage>
    {previewUser && <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewUser(null); }}><section className="admin-modal admin-user-preview-modal" role="dialog" aria-modal="true" aria-labelledby="user-preview-title" aria-describedby="user-preview-bio" tabIndex={-1}><div className="admin-user-preview-cover" style={previewUser.coverURL && ["http:", "https:"].includes((() => { try { return new URL(previewUser.coverURL).protocol; } catch { return ""; } })()) ? { backgroundImage: `url("${previewUser.coverURL.replace(/["\\\n\r]/g, "")}")` } : {}}/><AdminUserAvatar className="admin-user-preview-avatar" src={previewUser.avatarURL || previewUser.avatarUrl || previewUser.avatar || previewUser.photoURL} initial={(previewUser.displayName || previewUser.email || "U").charAt(0).toUpperCase()} /><h2 id="user-preview-title">{previewUser.displayName || "Unnamed user"}</h2><p className="admin-user-preview-username">@{previewUser.username || "member"}</p><p id="user-preview-bio">{previewUser.bio || "This member has not added a bio yet."}</p><div className="admin-user-preview-details"><span>Email</span><strong>{previewUser.email || "Not available"}</strong><span>Profile visibility</span><strong>{previewUser.privacy === "private" ? "Private" : "Public"}</strong><span>Account status</span><strong>{previewUser.suspended ? "Suspended" : "Active"}</strong></div><div className="admin-modal-actions"><button className="admin-secondary-btn" type="button" autoFocus onClick={() => setPreviewUser(null)}>Close</button></div></section></div>}
    {pendingUser && <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingUser(null); }}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="suspend-dialog-title"><h2 id="suspend-dialog-title">{pendingUser.suspended ? "Restore account?" : "Suspend account?"}</h2><p>{pendingUser.email || pendingUser.id} will {pendingUser.suspended ? "be allowed to use protected Lumora features again" : "be blocked from protected Lumora data operations"}. This does not disable their Firebase Authentication account.</p>{!pendingUser.suspended && <><label className="admin-form-field" style={{ marginTop: 13 }}><span style={{ color: "var(--admin-muted)", fontSize: 11, fontWeight: 800 }}>REASON (OPTIONAL)</span><textarea className="admin-textarea" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="Explain why this account is being suspended…" /></label></>}<div className="admin-modal-actions"><button className="admin-secondary-btn" type="button" onClick={() => setPendingUser(null)} disabled={Boolean(busyId)}>Cancel</button><button className={pendingUser.suspended ? "admin-primary-btn" : "admin-danger-btn"} type="button" onClick={confirmSuspension} disabled={Boolean(busyId)}>{busyId ? "Applying…" : pendingUser.suspended ? "Restore account" : "Confirm suspension"}</button></div></section></div>}
  </div>;
}

const EMPTY_CONTENT_FORM = { title: "", body: "", category: "General", status: "draft" };

export function AdminContentPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY_CONTENT_FORM);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { user } = useAuth();

  const loadContent = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const snapshot = await getDocs(query(collection(db, "content"), limit(COLLECTION_LIMIT)));
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      rows.sort((a, b) => timestampValue(b.updatedAt || b.createdAt) - timestampValue(a.updatedAt || a.createdAt));
      setItems(rows);
    } catch (loadError) { setError(readableError(loadError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadContent(); }, [loadContent]);

  const filteredItems = useMemo(() => items.filter((item) => {
    const matches = `${item.title || ""} ${item.body || ""} ${item.category || ""}`.toLowerCase().includes(search.toLowerCase());
    return matches && (statusFilter === "all" || item.status === statusFilter);
  }), [items, search, statusFilter]);

  const startCreate = () => { setEditingId(""); setForm(EMPTY_CONTENT_FORM); setError(""); setNotice(""); setShowForm(true); };
  const startEdit = (item) => { setEditingId(item.id); setForm({ title: item.title || "", body: item.body || "", category: item.category || "General", status: item.status || "draft" }); setError(""); setNotice(""); setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const saveContent = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.body.trim()) { setError("Enter both a title and body before saving."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const base = { title: form.title.trim(), body: form.body.trim(), category: form.category.trim() || "General", status: form.status, updatedBy: user.uid, updatedAt: serverTimestamp() };
      let savedId = editingId;
      let shouldNotify = false;
      if (editingId) {
        const previous = items.find((item) => item.id === editingId);
        shouldNotify = form.status === "published" && previous?.status !== "published";
        await updateDoc(doc(db, "content", editingId), base);
        await writeAuditEvent({ action: "content_updated", targetType: "content", targetId: editingId, details: `Updated “${form.title.trim()}” (${form.status})` });
        setNotice("Content was updated.");
      } else {
        const created = await addDoc(collection(db, "content"), { ...base, createdBy: user.uid, createdAt: serverTimestamp() });
        savedId = created.id;
        shouldNotify = form.status === "published";
        await writeAuditEvent({ action: "content_created", targetType: "content", targetId: created.id, details: `Created “${form.title.trim()}” (${form.status})` });
        setNotice("Content was created.");
      }
      if (shouldNotify && savedId) {
        try {
          await notifyMembersOfPublishedContent({ contentId: savedId, title: form.title.trim(), category: form.category.trim() || "General", actorUid: user.uid });
        } catch {
          setNotice((current) => `${current} Content is saved, but some in-app notifications could not be delivered.`);
        }
      }
      setShowForm(false); setEditingId(""); setForm(EMPTY_CONTENT_FORM); await loadContent();
    } catch (saveError) { setError(readableError(saveError)); }
    finally { setSaving(false); }
  };

  const deleteContent = async (item) => {
    if (!await confirmDialog("Delete content permanently?", `“${item.title}” will be deleted. This action cannot be undone.`, { confirmText: "Delete content", danger: true })) return;
    setError(""); setNotice("");
    try {
      const [linkedComments, linkedReports] = await Promise.all([
        getDocs(query(collection(db, "comments"), where("contentId", "==", item.id), limit(1))),
        getDocs(query(collection(db, "reports"), where("targetId", "==", item.id), limit(1))),
      ]);
      if (!linkedComments.empty || !linkedReports.empty) {
        setError("This content has linked comments or reports. Hide it instead of deleting it so moderation history remains intact.");
        return;
      }
      await deleteDoc(doc(db, "content", item.id));
      await writeAuditEvent({ action: "content_deleted", targetType: "content", targetId: item.id, details: `Deleted “${item.title || item.id}”` });
      setNotice("Content was deleted."); await loadContent();
    } catch (deleteError) { setError(readableError(deleteError)); }
  };

  return <div className="admin-page">
    <PageHeading eyebrow="PUBLISHING WORKSPACE" title="Content management" description="Draft, publish, hide, edit or remove Lumora content." action={<button className="admin-primary-btn" type="button" onClick={showForm ? () => setShowForm(false) : startCreate}>{showForm ? <X size={15} /> : <Plus size={15} />}{showForm ? "Close editor" : "Create content"}</button>} />
    <StateMessage kind="error">{error}</StateMessage><StateMessage kind="success">{notice}</StateMessage>
    {showForm && <section className="admin-panel admin-form-panel"><div className="admin-panel-header"><div><h2>{editingId ? "Edit content" : "Create content"}</h2><p>Content is stored in the Firestore content collection.</p></div></div><div className="admin-panel-body"><form onSubmit={saveContent}><div className="admin-form-grid"><div className="admin-form-field full"><label htmlFor="content-title">TITLE</label><input id="content-title" className="admin-input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={140} required placeholder="Give this item a clear title" /></div><div className="admin-form-field"><label htmlFor="content-category">CATEGORY</label><input id="content-category" className="admin-input" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} maxLength={60} placeholder="General" /></div><div className="admin-form-field"><label htmlFor="content-status">STATUS</label><select id="content-status" className="admin-select" style={{ width: "100%" }} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="draft">Draft</option><option value="published">Published</option><option value="hidden">Hidden</option></select></div><div className="admin-form-field full"><label htmlFor="content-body">BODY</label><textarea id="content-body" className="admin-textarea" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} maxLength={20000} required placeholder="Write your content…" /></div></div><div className="admin-form-actions"><button className="admin-secondary-btn" type="button" onClick={() => { setShowForm(false); setEditingId(""); }} disabled={saving}>Cancel</button><button className="admin-primary-btn" type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Create content"}</button></div></form></div></section>}
    <div className="admin-toolbar"><SearchField value={search} onChange={setSearch} placeholder="Search title, body or category…" /><select className="admin-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter content by status"><option value="all">All statuses</option><option value="draft">Drafts</option><option value="published">Published</option><option value="hidden">Hidden</option></select><button className="admin-secondary-btn" type="button" onClick={loadContent} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
    {loading ? <section className="admin-panel"><LoadingRow text="Loading content…" /></section> : filteredItems.length === 0 ? <section className="admin-panel"><EmptyState icon={FileText} title={items.length ? "No matching content" : "No content yet"} description={items.length ? "Try another search term or status." : "Create your first content item to start using the publishing workflow. No placeholder content has been added."} /></section> : <div className="admin-content-card-grid">{filteredItems.map((item) => <article className="admin-content-card" key={item.id}><div className="admin-content-card-top"><span className={statusClass(item.status)}>{item.status || "draft"}</span><span className="admin-cell-muted" style={{ fontSize: 10 }}>{item.category || "General"}</span></div><h3>{item.title || "Untitled content"}</h3><p>{item.body || "No body text."}</p><div className="admin-content-meta"><span>Updated {dateLabel(item.updatedAt || item.createdAt)}</span><span>{item.id.slice(0, 9)}…</span></div><div className="admin-content-actions"><button className="admin-secondary-btn" type="button" onClick={() => startEdit(item)}><Pencil size={14} /> Edit</button>{item.status === "published" ? <button className="admin-secondary-btn" type="button" onClick={async () => { try { await updateDoc(doc(db, "content", item.id), { status: "hidden", updatedBy: user.uid, updatedAt: serverTimestamp() }); await writeAuditEvent({ action: "content_hidden", targetType: "content", targetId: item.id, details: `Hidden “${item.title}”` }); setNotice("Content hidden."); await loadContent(); } catch (actionError) { setError(readableError(actionError)); } }}><EyeOff size={14} /> Hide</button> : <button className="admin-secondary-btn" type="button" onClick={async () => { try { await updateDoc(doc(db, "content", item.id), { status: "published", updatedBy: user.uid, updatedAt: serverTimestamp() }); await writeAuditEvent({ action: "content_published", targetType: "content", targetId: item.id, details: `Published “${item.title}”` }); let deliveryNotice = "Content published."; try { await notifyMembersOfPublishedContent({ contentId: item.id, title: item.title, category: item.category || "General", actorUid: user.uid }); } catch { deliveryNotice = "Content published; some notifications could not be delivered."; } setNotice(deliveryNotice); await loadContent(); } catch (actionError) { setError(readableError(actionError)); } }}><Eye size={14} /> Publish</button>}<button className="admin-icon-btn" type="button" title="Delete content" aria-label={`Delete ${item.title}`} onClick={() => deleteContent(item)}><Trash2 size={14} /></button></div></article>)}</div>}
    <StateMessage kind="info">Published content is readable by signed-in active members under the included Firestore rules. Content changes are written directly to Firestore and recorded in the admin audit log.</StateMessage>
  </div>;
}

export function AdminCommentsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { user } = useAuth();

  const loadComments = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const snapshot = await getDocs(query(collection(db, "comments"), limit(COLLECTION_LIMIT)));
      const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      rows.sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt)); setItems(rows);
    } catch (loadError) { setError(readableError(loadError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadComments(); }, [loadComments]);

  const filtered = useMemo(() => items.filter((item) => {
    const matches = `${item.displayName || ""} ${item.email || ""} ${item.body || item.text || ""} ${item.contentTitle || item.contentId || ""}`.toLowerCase().includes(search.toLowerCase());
    return matches && (statusFilter === "all" || (item.status || "pending") === statusFilter);
  }), [items, search, statusFilter]);

  const moderate = async (item, status) => {
    let reason = "";
    if (status === "removed") {
      const response = await promptDialog("Moderation reason", "Removed by administrator", { message: "Optionally add a reason for removing this comment.", placeholder: "Moderation reason", confirmText: "Continue" });
      if (response === null) return;
      reason = response || "Removed by administrator";
    }
    setBusyId(item.id); setError(""); setNotice("");
    try {
      await updateDoc(doc(db, "comments", item.id), { status, moderatedBy: user.uid, moderatedAt: serverTimestamp(), moderationReason: reason.slice(0, 300), updatedAt: serverTimestamp() });
      await writeAuditEvent({ action: `comment_${status}`, targetType: "comment", targetId: item.id, details: `${status} comment from ${item.displayName || item.uid || "member"}` });
      if (item.uid) {
        try {
          await addDoc(collection(db, "users", item.uid, "notifications"), {
            type: "moderation",
            title: status === "approved" ? "Your comment was approved" : "Your comment was removed",
            message: status === "approved"
              ? `Your comment on “${item.contentTitle || "Lumora content"}” is now visible.`
              : `Your comment on “${item.contentTitle || "Lumora content"}” was removed by a moderator.${reason ? ` Reason: ${reason.slice(0, 240)}` : ""}`,
            contentId: item.contentId || "",
            contentTitle: item.contentTitle || "",
            sourceCommentId: item.id,
            parentCommentId: item.parentId || "",
            link: item.contentId ? `/content/${item.contentId}` : "/notifications",
            isRead: false,
            createdAt: serverTimestamp(),
            createdByUid: user.uid,
          });
        } catch (notificationError) {
          // Moderation has already succeeded. Failed notification delivery must not reverse it.
        }
      }
      setNotice(`Comment marked ${status}.`); await loadComments();
    } catch (actionError) { setError(readableError(actionError)); }
    finally { setBusyId(""); }
  };

  return <div className="admin-page">
    <PageHeading eyebrow="COMMUNITY SAFETY" title="Comment moderation" description="Review comments and approve, remove or restore content that appears in the community." action={<button className="admin-secondary-btn" type="button" onClick={loadComments} disabled={loading}><RefreshCw size={15} /> Refresh</button>} />
    <StateMessage kind="error">{error}</StateMessage><StateMessage kind="success">{notice}</StateMessage>
    <div className="admin-toolbar"><SearchField value={search} onChange={setSearch} placeholder="Search comment, author or content…" /><select className="admin-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter comments"><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="removed">Removed</option></select></div>
    <section className="admin-panel"><div className="admin-panel-header"><div><h2>Comment queue</h2><p>{filtered.length} matching records · maximum {COLLECTION_LIMIT} loaded</p></div><span className="admin-status admin-status-pending">{items.filter((item) => !item.status || item.status === "pending").length} pending</span></div>
      {loading ? <LoadingRow text="Loading comments…" /> : filtered.length === 0 ? <EmptyState icon={MessageSquare} title={items.length ? "No matching comments" : "No comments to review"} description={items.length ? "Try a different status or search term." : "No comment documents were found. Member comments and replies from published content appear here for review."} /> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Comment</th><th>Author</th><th>Content</th><th>Submitted</th><th>Status</th><th>Moderation</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td style={{ minWidth: 250, maxWidth: 360, whiteSpace: "normal", lineHeight: 1.6 }}>{item.body || item.text || "(Empty comment)"}{item.moderationReason && <small style={{ display: "block", marginTop: 5, color: "var(--admin-muted)" }}>Reason: {item.moderationReason}</small>}</td><td>{item.displayName || item.uid || "Member"}</td><td>{item.contentTitle || item.contentId || "—"}</td><td className="admin-cell-muted">{dateLabel(item.createdAt)}</td><td><span className={statusClass(item.status || "pending")}>{item.status || "pending"}</span></td><td><div className="admin-row-actions">{item.status !== "approved" && <button className="admin-icon-btn" type="button" title="Approve" aria-label="Approve comment" disabled={busyId === item.id} onClick={() => moderate(item, "approved")}><Check size={15} /></button>}{item.status !== "removed" && <button className="admin-icon-btn" type="button" title="Remove" aria-label="Remove comment" disabled={busyId === item.id} onClick={() => moderate(item, "removed")}><Trash2 size={15} /></button>}{item.status === "removed" && <button className="admin-icon-btn" type="button" title="Restore as approved" aria-label="Restore comment" disabled={busyId === item.id} onClick={() => moderate(item, "approved")}><RefreshCw size={15} /></button>}</div></td></tr>)}</tbody></table></div>}
    </section>
    <StateMessage kind="info">Admin moderation changes only the status and moderation metadata. Original comment text and author identity are preserved for review history.</StateMessage>
  </div>;
}

export function AdminReportsPage() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const { user } = useAuth();

  const loadReports = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [reportsSnapshot, usersCount, contentCount, commentsCount] = await Promise.all([
        getDocs(query(collection(db, "reports"), limit(COLLECTION_LIMIT))),
        getCountFromServer(collection(db, "users")),
        getCountFromServer(collection(db, "content")),
        getCountFromServer(collection(db, "comments")),
      ]);
      const rows = reportsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      rows.sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt));
      setItems(rows);
      setStats({ users: usersCount.data().count, content: contentCount.data().count, comments: commentsCount.data().count, reports: rows.length });
    } catch (loadError) { setError(readableError(loadError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadReports(); }, [loadReports]);

  const filtered = useMemo(() => items.filter((item) => {
    const matches = `${item.reason || ""} ${item.targetType || ""} ${item.targetId || ""} ${item.reporterEmail || ""} ${item.reporterUid || ""}`.toLowerCase().includes(search.toLowerCase());
    const statusMatches = statusFilter === "all" || (item.status || "open") === statusFilter;
    const created = timestampValue(item.createdAt);
    const fromMatches = !fromDate || created >= new Date(`${fromDate}T00:00:00`).getTime();
    const toMatches = !toDate || created <= new Date(`${toDate}T23:59:59.999`).getTime();
    return matches && statusMatches && fromMatches && toMatches;
  }), [items, search, statusFilter, fromDate, toDate]);

  const reviewReport = async (item, status) => {
    const note = await promptDialog("Review note", item.reviewNote || "", { message: `Optional review note for this report (${status}).`, placeholder: "Add a note for the audit trail…", multiline: true, confirmText: "Save review" });
    if (note === null) return;
    setBusyId(item.id); setError(""); setNotice("");
    try {
      await updateDoc(doc(db, "reports", item.id), { status, reviewNote: note.slice(0, 500), reviewedBy: user.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await writeAuditEvent({ action: `report_${status}`, targetType: "report", targetId: item.id, details: `Report ${status}: ${item.targetType || "item"} ${item.targetId || ""}` });
      setNotice(`Report marked ${status}.`); await loadReports();
    } catch (actionError) { setError(readableError(actionError)); }
    finally { setBusyId(""); }
  };

  const exportCsv = () => {
    const escapeCsv = (value) => {
      let text = String(value ?? "");
      // Prevent spreadsheet formula execution when a field starts with a formula marker.
      if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const columns = ["id", "targetType", "targetId", "reporterEmail", "reporterUid", "reason", "status", "createdAt", "reviewNote", "reviewedBy"];
    const rows = [columns.map(escapeCsv).join(",")];
    filtered.forEach((item) => rows.push(columns.map((key) => escapeCsv(key === "createdAt" ? dateLabel(item[key]) : key === "status" ? (item[key] || "open") : item[key])).join(",")));
    const blob = new Blob([`\uFEFF${rows.join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `lumora-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    setNotice(`Exported ${filtered.length} filtered report records to CSV.`);
  };

  return <div className="admin-page">
    <PageHeading eyebrow="INSIGHTS & ACCOUNTABILITY" title="Reports & analytics" description="Review report submissions, track workspace record counts and export filtered reports." action={<button className="admin-primary-btn" type="button" onClick={exportCsv} disabled={filtered.length === 0}><ArrowDownToLine size={15} /> Export CSV</button>} />
    <StateMessage kind="error">{error}</StateMessage><StateMessage kind="success">{notice}</StateMessage>
    <div className="admin-report-metrics"><div className="admin-mini-stat"><span>Registered users</span><strong>{loading && !stats ? "…" : stats?.users ?? 0}</strong></div><div className="admin-mini-stat"><span>Content items</span><strong>{loading && !stats ? "…" : stats?.content ?? 0}</strong></div><div className="admin-mini-stat"><span>Comments</span><strong>{loading && !stats ? "…" : stats?.comments ?? 0}</strong></div><div className="admin-mini-stat"><span>Reports loaded</span><strong>{items.length}</strong></div></div>
    <div className="admin-toolbar"><SearchField value={search} onChange={setSearch} placeholder="Search reason, target or reporter…" /><select className="admin-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter report status"><option value="all">All statuses</option><option value="open">Open</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select><input className="admin-input admin-date-input" type="date" aria-label="From date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /><input className="admin-input admin-date-input" type="date" aria-label="To date" value={toDate} onChange={(event) => setToDate(event.target.value)} /><button className="admin-secondary-btn" type="button" onClick={loadReports} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
    <section className="admin-panel"><div className="admin-panel-header"><div><h2>Submitted reports</h2><p>{filtered.length} matching reports · maximum {COLLECTION_LIMIT} fetched per refresh</p></div><span className="admin-status admin-status-open">{items.filter((item) => !item.status || item.status === "open").length} open</span></div>
      {loading ? <LoadingRow text="Loading reports and analytics…" /> : filtered.length === 0 ? <EmptyState icon={ShieldCheck} title={items.length ? "No matching reports" : "No reports submitted yet"} description={items.length ? "Change the search, status or date filters to see other records." : "There are currently no user-submitted reports in Firestore. This page will populate when a report flow creates real records; nothing is mocked."} /> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Target</th><th>Reason</th><th>Reporter</th><th>Received</th><th>Status</th><th>Review</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><div className="admin-table-copy"><strong>{item.targetType || "Item"}</strong><small>{item.targetId || "ID not available"}</small></div></td><td style={{ minWidth: 200, maxWidth: 320, whiteSpace: "normal", lineHeight: 1.6 }}>{item.reason || "No reason provided"}{item.reviewNote && <small style={{ display: "block", color: "var(--admin-muted)", marginTop: 5 }}>Note: {item.reviewNote}</small>}</td><td>{item.reporterEmail || item.reporterUid || "Member"}</td><td className="admin-cell-muted">{dateLabel(item.createdAt)}</td><td><span className={statusClass(item.status || "open")}>{item.status || "open"}</span></td><td><select className="admin-select" style={{ minWidth: 128 }} aria-label={`Update report ${item.id}`} value={item.status || "open"} disabled={busyId === item.id} onChange={(event) => reviewReport(item, event.target.value)}><option value="open">Open</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></td></tr>)}</tbody></table></div>}
    </section>
    <StateMessage kind="info">CSV exports include only the currently filtered report rows. Aggregate metrics are live Firestore counts, not simulated analytics. Report creation is part of the user-community workflow and is not populated automatically.</StateMessage>
  </div>;
}
