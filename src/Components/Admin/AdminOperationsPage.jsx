import React, { useEffect, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import {
  addDoc, collection, doc, getDoc, getDocs, limit, onSnapshot, query,
  serverTimestamp, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import "./AdminOperations.css";

const SECTIONS = [
  ["overview", "Operations"], ["categories", "Categories & tags"], ["requests", "Name approvals"],
  ["bulk", "Bulk moderation"], ["communities", "Communities"], ["announcements", "Announcements"],
  ["audit", "Audit log"], ["exports", "Data exports"], ["roles", "Roles & authority"],
];
const dateText = (value) => { const date = value?.toDate ? value.toDate() : value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "—"; };
function csvEscape(value) { const text = value == null ? "" : typeof value === "object" ? (value.toDate ? value.toDate().toISOString() : JSON.stringify(value)) : String(value); return `"${text.replace(/"/g, '""')}"`; }
function downloadCsv(name, rows) {
  if (!rows.length) throw new Error("There are no records to export.");
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const csv = [columns.map(csvEscape).join(","), ...rows.map((row) => columns.map((key) => csvEscape(row[key])).join(","))].join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" }); const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
function State({ error, notice }) { return <>{error && <div className="admin-ops-alert" role="alert">{error}</div>}{notice && <div className="admin-ops-notice" role="status">{notice}</div>}</>; }
function OpsHeader({ title, description, action }) { return <header className="admin-ops-heading"><div><span>ADMIN STUDIO</span><h1>{title}</h1><p>{description}</p></div>{action}</header>; }
function Empty({ text = "No records to show yet." }) { return <div className="admin-ops-empty">{text}</div>; }

export default function AdminOperationsPage() {
  const { section: routeSection = "overview" } = useParams();
  const { user } = useAuth();
  const [section, setSection] = useState(routeSection);
  const [categories, setCategories] = useState([]); const [requests, setRequests] = useState([]); const [posts, setPosts] = useState([]); const [comments, setComments] = useState([]); const [groups, setGroups] = useState([]); const [announcements, setAnnouncements] = useState([]); const [audit, setAudit] = useState([]);
  const [selectedPosts, setSelectedPosts] = useState([]); const [selectedComments, setSelectedComments] = useState([]); const [socialComments, setSocialComments] = useState([]); const [selectedSocialComments, setSelectedSocialComments] = useState([]);
  const [categoryName, setCategoryName] = useState(""); const [categoryTags, setCategoryTags] = useState(""); const [announcementTitle, setAnnouncementTitle] = useState(""); const [announcementBody, setAnnouncementBody] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  useEffect(() => setSection(routeSection), [routeSection]);
  useEffect(() => {
    const unsubscribers = [
      onSnapshot(query(collection(db, "categories"), limit(100)), (snap) => setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}),
      onSnapshot(query(collection(db, "profileRequests"), limit(100)), (snap) => setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0))), () => {}),
      onSnapshot(query(collection(db, "posts"), limit(150)), (snap) => setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0))), () => {}),
      onSnapshot(query(collection(db, "comments"), limit(150)), (snap) => setComments(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0))), () => {}),
      onSnapshot(query(collection(db, "postComments"), limit(150)), (snap) => setSocialComments(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0))), () => {}),
      onSnapshot(query(collection(db, "communities"), limit(100)), (snap) => setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}),
      onSnapshot(query(collection(db, "adminAnnouncements"), limit(100)), (snap) => setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0))), () => {}),
      onSnapshot(query(collection(db, "auditLogs"), limit(150)), (snap) => setAudit(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0))), () => setError("Some admin logs require the matching rules to be published.")),
    ];
    setLoading(false); return () => unsubscribers.forEach((unsub) => unsub());
  }, []);
  const logAction = async (action, targetType, targetId, details) => {
    try { await addDoc(collection(db, "auditLogs"), { action, targetType, targetId: String(targetId || ""), details: String(details || "").slice(0, 500), actorUid: user.uid, actorEmail: user.email || "", createdAt: serverTimestamp() }); } catch { /* The primary admin action should not be rolled back due to audit log delivery. */ }
  };
  const resetNotice = () => { setError(""); setNotice(""); };
  const createCategory = async (event) => {
    event.preventDefault(); resetNotice(); const label = categoryName.trim().slice(0, 60); if (!label) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); if (!id) { setError("Category name must include a letter or number."); return; }
    try { await setDoc(doc(db, "categories", id), { name: label, tags: [...new Set(categoryTags.split(/[ ,#]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 20), active: true, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); await logAction("category_created", "category", id, `Created category ${label}`); setCategoryName(""); setCategoryTags(""); setNotice("Category saved."); }
    catch (e) { setError(e.code === "permission-denied" ? "Category write denied. Publish the current rules." : "Could not save category. The name may already exist."); }
  };
  const toggleCategory = async (item) => { resetNotice(); try { await updateDoc(doc(db, "categories", item.id), { active: item.active === false, updatedAt: serverTimestamp() }); await logAction("category_status_changed", "category", item.id, `Category active set to ${item.active === false}`); setNotice("Category status updated."); } catch { setError("Category could not be updated."); } };
  const reviewRequest = async (item, approve) => {
    resetNotice(); setBusy(true);
    try {
      const batch = writeBatch(db);
      if (approve) {
        const proposedUsername = String(item.proposedUsername || item.currentUsername || "").trim().toLowerCase().replace(/^@+/, "");
        if (!/^[a-z0-9_.]{3,20}$/.test(proposedUsername)) throw new Error("The requested username is not valid.");
        const profileRef = doc(db, "publicProfiles", item.uid);
        const profileSnap = await getDoc(profileRef);
        if (!profileSnap.exists()) throw new Error("This member no longer has a profile to update.");
        const currentProfile = profileSnap.data();
        const fields = { updatedAt: serverTimestamp() };
        const proposedName = String(item.proposedDisplayName || currentProfile.displayName || "").trim();
        if (proposedName) {
          if (proposedName.length > 80) throw new Error("The requested display name is too long.");
          fields.displayName = proposedName;
          fields.displayNameChangedAt = serverTimestamp();
        }
        const changesUsername = proposedUsername !== (currentProfile.username || "");
        if (changesUsername) {
          const usernameRef = doc(db, "usernames", proposedUsername);
          const reservation = await getDoc(usernameRef);
          if (reservation.exists() && reservation.data().uid !== item.uid) throw new Error("Requested username is already taken.");
          if (!reservation.exists()) batch.set(usernameRef, { uid: item.uid, username: proposedUsername, createdAt: serverTimestamp() });
          fields.username = proposedUsername;
          fields.usernameChangedAt = serverTimestamp();
          const oldName = currentProfile.username || item.currentUsername;
          if (oldName && oldName !== proposedUsername) {
            const oldRef = doc(db, "usernames", oldName);
            const oldReservation = await getDoc(oldRef);
            if (oldReservation.exists() && oldReservation.data().uid === item.uid) batch.delete(oldRef);
          }
        }
        batch.update(profileRef, fields);
      }
      batch.update(doc(db, "profileRequests", item.id), { status: approve ? "approved" : "rejected", reviewedBy: user.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await batch.commit();
      await logAction(approve ? "profile_request_approved" : "profile_request_rejected", "profileRequest", item.id, `${approve ? "Approved" : "Rejected"} request from ${item.email || item.uid}`);
      setNotice(approve ? "Change request approved." : "Change request rejected.");
    } catch (e) { setError(e.message || "Could not review the change request."); }
    finally { setBusy(false); }
  };
  const bulkPostAction = async (status) => {
    resetNotice(); if (!selectedPosts.length) { setError("Select at least one post first."); return; }
    setBusy(true);
    try { const batch = writeBatch(db); selectedPosts.forEach((id) => batch.update(doc(db, "posts", id), { status, updatedAt: serverTimestamp(), moderatedBy: user.uid, moderatedAt: serverTimestamp() })); await batch.commit(); await logAction("bulk_posts_moderated", "post", selectedPosts.join(","), `Set ${selectedPosts.length} posts to ${status}`); setSelectedPosts([]); setNotice(`${selectedPosts.length} posts updated to ${status}.`); }
    catch (e) { setError(e.code === "permission-denied" ? "Bulk moderation denied by Firestore rules." : "Bulk post update failed."); }
    finally { setBusy(false); }
  };
  const bulkCommentAction = async (status) => {
    resetNotice(); if (!selectedComments.length) { setError("Select at least one comment first."); return; }
    setBusy(true);
    try { const batch = writeBatch(db); selectedComments.forEach((id) => batch.update(doc(db, "comments", id), { status, moderatedBy: user.uid, moderatedAt: serverTimestamp(), moderationReason: "Bulk action by administrator", updatedAt: serverTimestamp() })); await batch.commit(); await logAction("bulk_comments_moderated", "comment", selectedComments.join(","), `Set ${selectedComments.length} comments to ${status}`); setSelectedComments([]); setNotice(`${selectedComments.length} comments updated to ${status}.`); }
    catch { setError("Bulk comment moderation failed. Ensure selected comments are still available."); }
    finally { setBusy(false); }
  };
  const bulkSocialCommentAction = async (status) => {
    resetNotice(); if (!selectedSocialComments.length) { setError("Select at least one social comment first."); return; }
    setBusy(true);
    try {
      const batch = writeBatch(db);
      selectedSocialComments.forEach((id) => batch.update(doc(db, "postComments", id), { status, moderatedBy: user.uid, moderatedAt: serverTimestamp(), moderationReason: status === "removed" ? "Bulk action by administrator" : "Approved by administrator", updatedAt: serverTimestamp() }));
      await batch.commit();
      await logAction("bulk_social_comments_moderated", "postComment", selectedSocialComments.join(","), `Set ${selectedSocialComments.length} social comments to ${status}`);
      setSelectedSocialComments([]); setNotice(`${selectedSocialComments.length} social comments updated to ${status}.`);
    } catch (e) { setError(e.code === "permission-denied" ? "Social comment moderation was denied by Firestore rules." : "Social comment update failed."); }
    finally { setBusy(false); }
  };
  const moderateGroup = async (group) => { resetNotice(); const next = group.status === "active" ? "suspended" : "active"; try { await updateDoc(doc(db, "communities", group.id), { status: next, updatedAt: serverTimestamp() }); await logAction("community_status_changed", "community", group.id, `Community ${group.title}: ${next}`); setNotice(`Community ${next}.`); } catch { setError("Community could not be updated."); } };
  const createAnnouncement = async (event) => {
    event.preventDefault(); resetNotice(); const title = announcementTitle.trim().slice(0, 120); const body = announcementBody.trim().slice(0, 1000); if (!title || !body) { setError("Add both a title and announcement text."); return; }
    setBusy(true);
    try {
      const ref = await addDoc(collection(db, "adminAnnouncements"), { title, body, active: true, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      // Read preferences before batching so one opted-out member cannot fail the entire batch.
      const userDocs = await getDocs(query(collection(db, "users"), limit(200)));
      const candidates = userDocs.docs.filter((entry) => entry.id !== user.uid);
      const eligible = [];
      for (let index = 0; index < candidates.length; index += 10) {
        const chunkResults = await Promise.all(candidates.slice(index, index + 10).map(async (entry) => {
          try {
            const prefs = await getDoc(doc(db, "users", entry.id, "settings", "preferences"));
            return !prefs.exists() || prefs.data().content !== false ? entry : null;
          } catch { return null; }
        }));
        eligible.push(...chunkResults);
      }
      const recipients = eligible.filter(Boolean);
      let delivered = 0;
      // Rules check each recipient's preference document; batches of 10 stay within
      // Firestore's security-rules document-access limit for atomic writes.
      for (let index = 0; index < recipients.length; index += 10) {
        const batch = writeBatch(db);
        const chunk = recipients.slice(index, index + 10);
        chunk.forEach((entry) => batch.set(doc(collection(db, "users", entry.id, "notifications")), { type: "announcement", title, message: body, link: "/notifications", isRead: false, createdAt: serverTimestamp(), createdByUid: user.uid, announcementId: ref.id }));
        try { await batch.commit(); delivered += chunk.length; } catch { /* Keep the announcement even if one notification chunk fails. */ }
      }
      await logAction("announcement_published", "announcement", ref.id, title); setAnnouncementTitle(""); setAnnouncementBody(""); setNotice(`Announcement saved. In-app notifications delivered to ${delivered} opted-in profiles (maximum 199).`);
    } catch (e) { setError(e.code === "permission-denied" ? "Announcement publish denied; publish the rules first." : (e.message || "Announcement could not be published.")); }
    finally { setBusy(false); }
  };
  const exportCollection = async (collectionName, fileName) => {
    resetNotice(); setBusy(true);
    try { const snap = await getDocs(query(collection(db, collectionName), limit(500))); const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })); downloadCsv(fileName, rows); await logAction("csv_exported", collectionName, "max-500", `Exported ${rows.length} ${collectionName} records`); setNotice(`Exported ${rows.length} ${collectionName} records (maximum 500 per export).`); }
    catch (e) { setError(e.message || `Could not export ${collectionName}.`); }
    finally { setBusy(false); }
  };
  const exportEverything = async () => { for (const name of ["users", "content", "posts", "comments", "postComments", "reports", "communities", "profileRequests", "auditLogs"]) { try { const snap = await getDocs(query(collection(db, name), limit(500))); downloadCsv(`lumora-${name}.csv`, snap.docs.map((d) => ({ id: d.id, ...d.data() }))); } catch { /* continue and make individual collection errors visible in the report */ } } setNotice("Attempted per-collection CSV exports. Browser settings may ask permission for multiple downloads."); };
  const pendingRequests = requests.filter((r) => r.status === "pending");
  const pendingComments = comments.filter((c) => c.status === "pending");
  const draftPosts = posts.filter((p) => p.status === "draft" || p.status === "published");
  const navItems = SECTIONS;

  const content = (() => {
    if (section === "categories") return <><OpsHeader title="Categories & tags" description="Maintain reusable categories and suggested tags for content discovery."/><form className="admin-ops-form" onSubmit={createCategory}><label>Category name<input value={categoryName} onChange={(e)=>setCategoryName(e.target.value)} maxLength={60} required placeholder="Technology"/></label><label>Suggested tags<input value={categoryTags} onChange={(e)=>setCategoryTags(e.target.value)} placeholder="ai, learning, research"/></label><button disabled={busy}>Create category</button></form><div className="admin-ops-table-wrap"><table className="admin-ops-table"><thead><tr><th>Category</th><th>Tags</th><th>Status</th><th>Action</th></tr></thead><tbody>{categories.map((item)=><tr key={item.id}><td>{item.name}</td><td>{(item.tags||[]).map((t)=>`#${t}`).join(" ")||"—"}</td><td><span className={`admin-ops-pill ${item.active===false?"muted":"good"}`}>{item.active===false?"Inactive":"Active"}</span></td><td><button className="admin-ops-small-btn" onClick={()=>toggleCategory(item)}>{item.active===false?"Activate":"Deactivate"}</button></td></tr>)}</tbody></table>{!categories.length&&<Empty text="No categories yet. Create the first one above."/>}</div></>;
    if (section === "requests") return <><OpsHeader title="Profile change approvals" description="Urgent requests can bypass the 90-day display-name and username cooldown only after administrator review."/><div className="admin-ops-table-wrap"><table className="admin-ops-table"><thead><tr><th>Member</th><th>Current → proposed</th><th>Submitted</th><th>Status / action</th></tr></thead><tbody>{requests.map((r)=><tr key={r.id}><td><strong>{r.email||r.uid}</strong></td><td>{r.currentDisplayName||"—"} → <b>{r.proposedDisplayName||"—"}</b><br/><small>@{r.currentUsername||"—"} → @{r.proposedUsername||"—"}</small></td><td>{dateText(r.createdAt)}</td><td>{r.status==="pending"?<div className="admin-ops-button-row"><button className="admin-ops-small-btn primary" disabled={busy} onClick={()=>reviewRequest(r,true)}>Approve</button><button className="admin-ops-small-btn" disabled={busy} onClick={()=>reviewRequest(r,false)}>Reject</button></div>:<span className={`admin-ops-pill ${r.status==="approved"?"good":"muted"}`}>{r.status}</span>}</td></tr>)}</tbody></table>{!requests.length&&<Empty text="No profile change requests have been submitted."/>}</div></>;
    if (section === "bulk") return <><OpsHeader title="Bulk moderation" description="Select posts or pending comments, then apply one controlled moderation action."/><div className="admin-ops-bulk-grid"><section className="admin-ops-card"><h2>Social posts <span>{draftPosts.length}</span></h2><div className="admin-ops-select-list">{draftPosts.map((p)=><label key={p.id}><input type="checkbox" checked={selectedPosts.includes(p.id)} onChange={(e)=>setSelectedPosts((old)=>e.target.checked?[...old,p.id]:old.filter((id)=>id!==p.id))}/><span><strong>{p.displayName||p.username||"Member"}</strong><small>{String(p.body||"").slice(0,90)}</small><em>{p.status} · {dateText(p.createdAt)}</em></span></label>)}</div><div className="admin-ops-button-row"><button className="admin-ops-small-btn primary" disabled={busy} onClick={()=>bulkPostAction("published")}>Publish selected</button><button className="admin-ops-small-btn" disabled={busy} onClick={()=>bulkPostAction("hidden")}>Hide selected</button><button className="admin-ops-small-btn danger" disabled={busy} onClick={()=>bulkPostAction("removed")}>Remove selected</button></div></section><section className="admin-ops-card"><h2>Pending comments <span>{pendingComments.length}</span></h2><div className="admin-ops-select-list">{pendingComments.map((c)=><label key={c.id}><input type="checkbox" checked={selectedComments.includes(c.id)} onChange={(e)=>setSelectedComments((old)=>e.target.checked?[...old,c.id]:old.filter((id)=>id!==c.id))}/><span><strong>{c.displayName||c.uid}</strong><small>{String(c.body||"").slice(0,100)}</small><em>{dateText(c.createdAt)}</em></span></label>)}</div><div className="admin-ops-button-row"><button className="admin-ops-small-btn primary" disabled={busy} onClick={()=>bulkCommentAction("approved")}>Approve selected</button><button className="admin-ops-small-btn danger" disabled={busy} onClick={()=>bulkCommentAction("removed")}>Remove selected</button></div></section><section className="admin-ops-card"><h2>Social post comments <span>{socialComments.length}</span></h2><div className="admin-ops-select-list">{socialComments.map((c)=><label key={c.id}><input type="checkbox" checked={selectedSocialComments.includes(c.id)} onChange={(e)=>setSelectedSocialComments((old)=>e.target.checked?[...old,c.id]:old.filter((id)=>id!==c.id))}/><span><strong>{c.displayName||c.uid||"Member"}</strong><small>{String(c.body||"").slice(0,100)}</small><em>{c.status||"approved"} · {dateText(c.createdAt)}</em></span></label>)}</div><div className="admin-ops-button-row"><button className="admin-ops-small-btn primary" disabled={busy} onClick={()=>bulkSocialCommentAction("approved")}>Approve selected</button><button className="admin-ops-small-btn danger" disabled={busy} onClick={()=>bulkSocialCommentAction("removed")}>Remove selected</button></div></section></div><p className="admin-ops-footnote">Bulk operations are audited. Deleted records are intentionally not bulk-deleted to reduce accidental data loss.</p></>;
    if (section === "communities") return <><OpsHeader title="Community management" description="Review member-created spaces and suspend or restore a community when needed."/><div className="admin-ops-card-list">{groups.map((g)=><article className="admin-ops-list-card" key={g.id}><div><strong>{g.title||"Untitled community"}</strong><p>{g.description||"No description"}</p><small>{g.memberUids?.length||0} members · owner {g.ownerUid} · created {dateText(g.createdAt)}</small></div><div><span className={`admin-ops-pill ${g.status==="active"?"good":"muted"}`}>{g.status||"active"}</span><button className="admin-ops-small-btn" onClick={()=>moderateGroup(g)}>{g.status==="active"?"Suspend":"Restore"}</button></div></article>)}{!groups.length&&<Empty text="Communities will appear here when members create them."/>}</div></>;
    if (section === "announcements") return <><OpsHeader title="Admin announcements" description="Publish an in-app announcement and best-effort notification fan-out to at most 200 profiles (Spark-conscious)."/><form className="admin-ops-form stacked" onSubmit={createAnnouncement}><label>Announcement title<input value={announcementTitle} onChange={(e)=>setAnnouncementTitle(e.target.value)} maxLength={120} required placeholder="A note from the Lumora team"/></label><label>Message<textarea value={announcementBody} onChange={(e)=>setAnnouncementBody(e.target.value)} maxLength={1000} rows={4} required placeholder="Write a short update for your community…"/></label><button disabled={busy}>{busy?"Publishing…":"Publish announcement"}</button></form><div className="admin-ops-card-list">{announcements.map((a)=><article className="admin-ops-list-card" key={a.id}><div><strong>{a.title}</strong><p>{a.body}</p><small>Published {dateText(a.createdAt)}</small></div><span className="admin-ops-pill good">In-app</span></article>)}</div></>;
    if (section === "audit") return <><OpsHeader title="Admin audit log" description="Append-only record of administrative actions recorded by this interface."/><div className="admin-ops-table-wrap"><table className="admin-ops-table"><thead><tr><th>Action</th><th>Target</th><th>Details</th><th>Actor</th><th>Time</th></tr></thead><tbody>{audit.map((a)=><tr key={a.id}><td><strong>{String(a.action||"action").replaceAll("_"," ")}</strong></td><td>{a.targetType||"—"}<br/><small>{a.targetId||""}</small></td><td>{a.details||"—"}</td><td>{a.actorEmail||a.actorUid||"Admin"}</td><td>{dateText(a.createdAt)}</td></tr>)}</tbody></table>{!audit.length&&<Empty text="No admin actions recorded yet."/>}</div></>;
    if (section === "exports") return <><OpsHeader title="Data exports" description="Export up to 500 records per collection as CSV for offline analysis. Keep exported data private."/><div className="admin-ops-export-grid">{["users","content","posts","comments","postComments","reports","communities","profileRequests","auditLogs"].map((name)=><article className="admin-ops-export-card" key={name}><span>CSV</span><strong>{name}</strong><p>Export the first 500 records for this collection.</p><button className="admin-ops-small-btn primary" disabled={busy} onClick={()=>exportCollection(name,`lumora-${name}.csv`)}>Export CSV ↓</button></article>)}</div><button className="admin-ops-secondary-wide" disabled={busy} onClick={exportEverything}>Export all collections (multiple files)</button><p className="admin-ops-footnote">CSV exports can contain personally identifying information, including email addresses. Store and share them carefully.</p></>;
    if (section === "roles") return <><OpsHeader title="Roles & authority" description="Authority is fixed to the designated administrator identity; client-editable roles are not accepted as security credentials."/><div className="admin-ops-role-grid"><article className="admin-ops-card"><span className="admin-ops-role-tag admin">Administrator</span><h2>Designated owner</h2><p><strong>Identity:</strong> furqan@gmail.com plus the pinned Firebase Auth UID.</p><p>Can manage users, moderate content, review reports and profile requests, administer communities, publish announcements, review audit logs and export data.</p></article><article className="admin-ops-card"><span className="admin-ops-role-tag member">Member</span><h2>Authenticated member</h2><p>Can edit their own profile, publish and manage their own posts, connect with other members, message accepted friends, join communities, save content and submit reports.</p><p>Cannot grant themselves admin privileges, change another member's role, read private saved content, or access admin-only records.</p></article></div><div className="admin-ops-notice">For this single-admin Firebase Spark deployment, the role model is intentionally fixed. Multi-admin custom roles require trusted-server custom claims; a role field in a user-editable document would not be safe.</div></>;
    return <><OpsHeader title="Admin operations" description="One workspace for moderation, approvals, communities, announcements, audit and export tools."/><div className="admin-ops-summary-grid">{[["Pending change requests",pendingRequests.length,"/admin/operations/requests"],["Social posts",posts.length,"/admin/operations/bulk"],["Pending comments",pendingComments.length,"/admin/operations/bulk"],["Communities",groups.length,"/admin/operations/communities"],["Admin announcements",announcements.length,"/admin/operations/announcements"],["Audit records",audit.length,"/admin/operations/audit"]].map(([label,value,to])=><NavLink to={to} className="admin-ops-summary" key={label}><span>{label}</span><strong>{value}</strong><small>Open workspace ↗</small></NavLink>)}</div><div className="admin-ops-card"><h2>Release operations checklist</h2><ul><li>Confirm Firestore security rules and indexes are published before enabling new collections.</li><li>Verify friend requests only create chats after acceptance.</li><li>Review pending moderation items before using bulk actions.</li><li>Use CSV exports sparingly to protect member data and stay within the free-plan budget.</li></ul></div></>;
  })();

  return <div className="admin-ops-page"><nav className="admin-ops-tabs" aria-label="Admin operations sections">{navItems.map(([id,label])=><NavLink key={id} to={id==="overview"?"/admin/operations":`/admin/operations/${id}`} end className={({isActive})=>`admin-ops-tab ${((id==="overview"&&routeSection==="overview")||routeSection===id)?"active":""}`}>{label}</NavLink>)}</nav><State error={error} notice={notice}/>{loading?<Empty text="Loading admin records…"/>:content}</div>;
}
