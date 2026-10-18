import React, { useCallback, useEffect, useMemo, useState } from "react";
import { promptDialog } from "../../ui/feedback";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs,
  limit, onSnapshot, query, serverTimestamp, setDoc, where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";

const MAX_CONTENT = 30;

function timeLabel(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Recently published";
}

function prettyName(user) {
  return user?.displayName?.trim() || user?.email?.split("@")[0] || "Lumora member";
}

function PageHeader({ eyebrow, title, description, action }) {
  return <header className="community-heading"><div><p className="community-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="community-description">{description}</p></div>{action && <div className="community-heading-action">{action}</div>}</header>;
}

function Empty({ title, text, action }) {
  return <div className="community-empty"><span className="community-empty-icon">✧</span><h2>{title}</h2><p>{text}</p>{action}</div>;
}

function ErrorNotice({ children }) {
  return children ? <div className="community-error" role="alert">{children}</div> : null;
}

async function sendReport({ user, targetType, targetId, reason }) {
  const text = String(reason || "").trim();
  if (text.length < 3 || text.length > 500) throw new Error("Please enter a report reason between 3 and 500 characters.");
  await addDoc(collection(db, "reports"), {
    reporterUid: user.uid,
    reporterEmail: user.email || "",
    targetType,
    targetId,
    reason: text,
    status: "open",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function toggleLike(contentId, user, wasLiked) {
  const likeRef = doc(db, "content", contentId, "likes", user.uid);
  if (wasLiked) {
    await deleteDoc(likeRef);
  } else {
    await setDoc(likeRef, { uid: user.uid, createdAt: serverTimestamp() });
  }
}

async function toggleSaved(item, user, wasSaved) {
  const favoriteRef = doc(db, "users", user.uid, "favorites", item.id);
  if (wasSaved) {
    await deleteDoc(favoriteRef);
  } else {
    await setDoc(favoriteRef, {
      contentId: item.id,
      title: String(item.title || "Untitled content").slice(0, 140),
      category: String(item.category || "General").slice(0, 60),
      savedAt: serverTimestamp(),
    });
  }
}

export function ExplorePage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [interaction, setInteraction] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const loadContent = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await getDocs(query(collection(db, "content"), where("status", "==", "published"), limit(MAX_CONTENT)));
      const rows = result.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setItems(rows);
      const stateEntries = await Promise.all(rows.slice(0, 30).map(async (item) => {
        try {
          const [liked, saved, count] = await Promise.all([
            getDoc(doc(db, "content", item.id, "likes", user.uid)),
            getDoc(doc(db, "users", user.uid, "favorites", item.id)),
            getCountFromServer(collection(db, "content", item.id, "likes")),
          ]);
          return [item.id, { liked: liked.exists(), saved: saved.exists(), likeCount: count.data().count }];
        } catch {
          return [item.id, { liked: false, saved: false, likeCount: 0 }];
        }
      }));
      setInteraction(Object.fromEntries(stateEntries));
    } catch (loadError) {
      setError(loadError.code === "permission-denied" ? "Firestore denied access. Publish the included Lumora rules and sign in again." : "Content could not be loaded. Check your connection and try again.");
    } finally { setLoading(false); }
  }, [user.uid]);

  useEffect(() => { loadContent(); }, [loadContent]);

  const categories = useMemo(() => ["all", ...new Set(items.map((item) => item.category || "General").filter(Boolean))], [items]);
  const filtered = useMemo(() => items.filter((item) => {
    const haystack = `${item.title || ""} ${item.body || ""} ${item.category || "General"}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase()) && (category === "all" || (item.category || "General") === category);
  }), [items, search, category]);

  const handleLike = async (item) => {
    const current = interaction[item.id] || { liked: false, likeCount: 0, saved: false };
    setBusyId(item.id); setError("");
    try {
      await toggleLike(item.id, user, current.liked);
      setInteraction((state) => ({ ...state, [item.id]: { ...current, liked: !current.liked, likeCount: Math.max(0, current.likeCount + (current.liked ? -1 : 1)) } }));
    } catch (actionError) { setError(actionError.code === "permission-denied" ? "You cannot like this item under the current security rules. Publish the included rules." : "Unable to update your like. Please try again."); }
    finally { setBusyId(""); }
  };

  const handleSave = async (item) => {
    const current = interaction[item.id] || { liked: false, likeCount: 0, saved: false };
    setBusyId(item.id); setError(""); setNotice("");
    try {
      await toggleSaved(item, user, current.saved);
      setInteraction((state) => ({ ...state, [item.id]: { ...current, saved: !current.saved } }));
      setNotice(current.saved ? "Removed from saved content." : "Saved to your collection.");
    } catch { setError("Unable to update saved content. Check the published Firestore rules and try again."); }
    finally { setBusyId(""); }
  };

  const handleReport = async (item) => {
    const reason = await promptDialog("Report content", "", { message: `Why are you reporting “${item.title || "this content"}”?`, placeholder: "Reason for reporting…", multiline: true, required: true, confirmText: "Submit report" });
    if (reason === null) return;
    setError(""); setNotice("");
    try { await sendReport({ user, targetType: "content", targetId: item.id, reason }); setNotice("Report submitted to the moderation queue."); }
    catch (reportError) { setError(reportError.message || "Unable to submit this report."); }
  };

  return <div className="dashboard-page-content community-page">
    <PageHeader eyebrow="LUMORA COMMUNITY" title="Explore" description="Find published ideas, save what matters, and join the conversation." action={<Link to="/saved" className="community-outline-button">Saved content ↗</Link>} />
    <div className="community-controls"><label className="community-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, topics and content…" aria-label="Search published content" /></label><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category" className="community-select">{categories.map((item) => <option value={item} key={item}>{item === "all" ? "All categories" : item}</option>)}</select><button className="community-outline-button" type="button" onClick={loadContent} disabled={loading}>↻ Refresh</button></div>
    <ErrorNotice>{error}</ErrorNotice>{notice && <div className="community-success" role="status">{notice}</div>}
    {loading ? <Empty title="Loading Explore…" text="Fetching published Lumora content." /> : filtered.length === 0 ? <Empty title={items.length ? "No matching results" : "No published content yet"} text={items.length ? "Try another search or category." : "Published content created in the admin console will appear here."} action={items.length ? null : <Link to="/dashboard" className="community-primary-button">Back to overview</Link>} /> : <div className="community-content-grid">{filtered.map((item) => {
      const state = interaction[item.id] || { liked: false, saved: false, likeCount: 0 };
      return <article className="community-content-card" key={item.id}><div className="community-card-meta"><span className="community-category-pill">{item.category || "General"}</span><span>{timeLabel(item.createdAt)}</span></div><h2><Link to={`/content/${item.id}`}>{item.title || "Untitled content"}</Link></h2><p className="community-card-excerpt">{item.body || "No additional description was provided."}</p><div className="community-card-actions"><button type="button" className={`community-action ${state.liked ? "is-active" : ""}`} onClick={() => handleLike(item)} disabled={busyId === item.id} aria-pressed={state.liked}>♥ <span>{state.likeCount} {state.liked ? "Liked" : "Like"}</span></button><button type="button" className={`community-action ${state.saved ? "is-active" : ""}`} onClick={() => handleSave(item)} disabled={busyId === item.id} aria-pressed={state.saved}>{state.saved ? "★" : "☆"} <span>{state.saved ? "Saved" : "Save"}</span></button><button type="button" className="community-action" onClick={() => handleReport(item)}>⚑ <span>Report</span></button><Link className="community-read-link" to={`/content/${item.id}`}>Read & comment ↗</Link></div></article>;
    })}</div>}
    <p className="community-footnote">Showing up to {MAX_CONTENT} recently published items per refresh.</p>
  </div>;
}

export function SavedPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSaved = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const snapshot = await getDocs(query(collection(db, "users", user.uid, "favorites"), limit(MAX_CONTENT)));
      const savedRows = await Promise.all(snapshot.docs.map(async (entry) => {
        const saved = { id: entry.id, ...entry.data() };
        try {
          const contentSnapshot = await getDoc(doc(db, "content", saved.id));
          return contentSnapshot.exists() ? { id: contentSnapshot.id, ...contentSnapshot.data(), savedAt: saved.savedAt } : { ...saved, unavailable: true };
        } catch { return { ...saved, unavailable: true }; }
      }));
      savedRows.sort((a, b) => (b.savedAt?.toMillis?.() || 0) - (a.savedAt?.toMillis?.() || 0));
      setItems(savedRows);
    } catch (loadError) { setError(loadError.code === "permission-denied" ? "Firestore denied access to saved content. Publish the included security rules." : "Saved content could not be loaded."); }
    finally { setLoading(false); }
  }, [user.uid]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const removeSaved = async (item) => {
    try {
      await deleteDoc(doc(db, "users", user.uid, "favorites", item.id));
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setNotice("Removed from your saved content.");
    } catch { setError("Unable to remove this saved item."); }
  };

  return <div className="dashboard-page-content community-page">
    <PageHeader eyebrow="YOUR COLLECTION" title="Saved content" description="A personal collection of items you decided to keep." action={<Link to="/explore" className="community-outline-button">Explore content ↗</Link>} />
    <ErrorNotice>{error}</ErrorNotice>{notice && <div className="community-success" role="status">{notice}</div>}
    {loading ? <Empty title="Loading saved content…" text="Checking your personal collection." /> : items.length === 0 ? <Empty title="Nothing saved yet" text="Use the Save action on any published item to keep it here." action={<Link to="/explore" className="community-primary-button">Explore Lumora</Link>} /> : <div className="community-content-grid">{items.map((item) => <article className="community-content-card" key={item.id}><div className="community-card-meta"><span className="community-category-pill">{item.category || "General"}</span><span>Saved {timeLabel(item.savedAt)}</span></div><h2>{item.unavailable ? item.title || "Saved item" : <Link to={`/content/${item.id}`}>{item.title || "Untitled content"}</Link>}</h2><p className="community-card-excerpt">{item.unavailable ? "This item is no longer publicly available. You can remove it from your saved list." : (item.body || "No additional description was provided.")}</p><div className="community-card-actions">{!item.unavailable && <Link className="community-read-link" to={`/content/${item.id}`}>Open content ↗</Link>}<button type="button" className="community-action" onClick={() => removeSaved(item)}>× <span>Remove</span></button></div></article>)}</div>}
  </div>;
}

function CommentNode({ item, replies, onReply, onReport, currentUid, depth = 0 }) {
  return <article className={`community-comment ${depth > 0 ? "community-comment-reply" : ""}`}><div className="community-comment-avatar">{(item.displayName || "N").charAt(0).toUpperCase()}</div><div className="community-comment-main"><div className="community-comment-head"><strong>{item.displayName || "Lumora member"}</strong><span>{timeLabel(item.createdAt)}</span></div><p>{item.body}</p><div className="community-comment-actions">{depth < 1 && <button type="button" onClick={() => onReply(item)}>Reply</button>}{item.uid !== currentUid && <button type="button" onClick={() => onReport(item)}>Report</button>}</div>{replies?.length > 0 && <div className="community-replies">{replies.map((reply) => <CommentNode key={reply.id} item={reply} replies={[]} onReply={onReply} onReport={onReport} currentUid={currentUid} depth={depth + 1} />)}</div>}</div></article>;
}

export function ContentDetailPage() {
  const { contentId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [content, setContent] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentLoading, setCommentLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "content", contentId), (snapshot) => {
      if (!snapshot.exists() || snapshot.data().status !== "published") {
        setContent(null);
        setError("This content is not available or is no longer published.");
      } else { setContent({ id: snapshot.id, ...snapshot.data() }); setError(""); }
      setLoading(false);
    }, () => { setError("Content could not be loaded. Publish the current Firestore rules and try again."); setLoading(false); });
    return unsubscribe;
  }, [contentId]);

  useEffect(() => {
    setCommentLoading(true);
    const commentsQuery = query(collection(db, "comments"), where("contentId", "==", contentId), where("status", "==", "approved"), limit(100));
    const unsubscribe = onSnapshot(commentsQuery, (snapshot) => {
      const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      rows.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      setComments(rows); setCommentLoading(false);
    }, (loadError) => {
      const rawCode = String(loadError?.code || "unknown");
      const code = rawCode.split("/").pop();
      console.error("[Lumora] Content comments failed to load", { code: rawCode, message: loadError?.message || "", error: loadError });
      setComments([]);
      setCommentLoading(false);
      const detail = code === "failed-precondition" || /requires an index/i.test(String(loadError?.message || ""))
        ? "need a Firestore composite index. Publish the included firestore.indexes.json and wait for the index to become Enabled."
        : code === "permission-denied"
          ? "were denied by Firestore Security Rules. Confirm the correct rules are published to the selected Firebase project."
          : `could not be loaded (Firebase error: ${rawCode}). Open the browser Console for details.`;
      setError((old) => old || `Comments ${detail}`);
    });
    return unsubscribe;
  }, [contentId]);

  const roots = useMemo(() => comments.filter((item) => !item.parentId), [comments]);
  const repliesByParent = useMemo(() => comments.reduce((acc, item) => {
    if (item.parentId) acc[item.parentId] = [...(acc[item.parentId] || []), item];
    return acc;
  }, {}), [comments]);

  const reportComment = async (item) => {
    const reason = await promptDialog("Report comment", "", { message: "Tell the moderation team why this comment should be reviewed.", placeholder: "Reason for reporting…", multiline: true, required: true, confirmText: "Submit report" });
    if (reason === null) return;
    try { await sendReport({ user, targetType: "comment", targetId: item.id, reason }); setNotice("Report submitted. The moderation team can review it now."); }
    catch (reportError) { setError(reportError.message || "Report submission failed."); }
  };

  const submitComment = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || text.length > 3000 || !content) { setError("Enter a comment between 1 and 3000 characters."); return; }
    setSubmitting(true); setError(""); setNotice("");
    try {
      const commentData = {
        contentId,
        contentTitle: content.title || "Untitled content",
        uid: user.uid,
        displayName: prettyName(user),
        body: text,
        parentId: replyTo?.id || null,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const newComment = await addDoc(collection(db, "comments"), commentData);
      if (replyTo?.uid && replyTo.uid !== user.uid) {
        try {
          await addDoc(collection(db, "users", replyTo.uid, "notifications"), {
            type: "reply",
            title: "New reply to your comment",
            message: `${prettyName(user)} replied to your comment on “${content.title || "Lumora content"}”. Your reply is awaiting moderation.`,
            contentId,
            contentTitle: content.title || "Untitled content",
            sourceCommentId: newComment.id,
            parentCommentId: replyTo.id,
            link: `/content/${contentId}`,
            isRead: false,
            createdAt: serverTimestamp(),
          });
        } catch { /* Notification delivery should not undo the successful comment submission. */ }
      }
      setBody(""); setReplyTo(null);
      setNotice("Your comment has been submitted and is awaiting moderation.");
    } catch (submitError) {
      setError(submitError.code === "permission-denied" ? "Comment submission was blocked. Confirm that the current Firestore rules are published and the content is published." : (submitError.message || "Comment could not be submitted."));
    } finally { setSubmitting(false); }
  };

  const reportContent = async () => {
    const reason = await promptDialog("Report content", "", { message: "Tell the moderation team why this content should be reviewed.", placeholder: "Reason for reporting…", multiline: true, required: true, confirmText: "Submit report" });
    if (reason === null) return;
    try { await sendReport({ user, targetType: "content", targetId: contentId, reason }); setNotice("Report submitted for admin review."); }
    catch (reportError) { setError(reportError.message || "Report submission failed."); }
  };

  return <div className="dashboard-page-content community-page">
    <PageHeader eyebrow="CONTENT DETAILS" title={loading ? "Loading content…" : content?.title || "Content unavailable"} description="Read, respond, and help keep Lumora helpful and respectful." action={<button className="community-outline-button" type="button" onClick={() => navigate(-1)}>← Back</button>} />
    <ErrorNotice>{error}</ErrorNotice>{notice && <div className="community-success" role="status">{notice}</div>}
    {loading ? <Empty title="Loading content…" text="Fetching the published item." /> : !content ? <Empty title="Content unavailable" text="This item may have been hidden or removed by an administrator." action={<Link to="/explore" className="community-primary-button">Back to Explore</Link>} /> : <>
      <article className="community-detail-card"><div className="community-card-meta"><span className="community-category-pill">{content.category || "General"}</span><span>{timeLabel(content.createdAt)}</span></div><div className="community-detail-body">{content.body}</div><div className="community-detail-footer"><span>By Lumora editorial team</span><button type="button" className="community-action" onClick={reportContent}>⚑ <span>Report content</span></button></div></article>
      <section className="community-comments-panel"><div className="community-section-heading"><div><p className="community-eyebrow">COMMUNITY DISCUSSION</p><h2>Comments & replies</h2><p>New comments are reviewed before being made public.</p></div><span className="community-comment-count">{comments.length}</span></div>
        <form className="community-comment-form" onSubmit={submitComment}><div className="community-comment-avatar">{prettyName(user).charAt(0).toUpperCase()}</div><div className="community-comment-compose"><label htmlFor="new-comment">{replyTo ? `Replying to ${replyTo.displayName || "Lumora member"}` : "Add your comment"}</label><textarea id="new-comment" value={body} onChange={(event) => setBody(event.target.value)} maxLength={3000} rows={3} placeholder={replyTo ? "Write a thoughtful reply…" : "Share a useful thought…"} required />{replyTo && <button className="community-text-button" type="button" onClick={() => setReplyTo(null)}>Cancel reply</button>}<button className="community-primary-button" type="submit" disabled={submitting}>{submitting ? "Submitting…" : replyTo ? "Submit reply for review" : "Submit comment for review"}</button></div></form>
        {commentLoading ? <Empty title="Loading comments…" text="Getting approved comments." /> : roots.length === 0 ? <Empty title="Start the conversation" text="There are no approved comments yet. You can be the first to contribute." /> : <div className="community-comment-list">{roots.map((item) => <CommentNode key={item.id} item={item} replies={repliesByParent[item.id] || []} onReply={setReplyTo} onReport={reportComment} currentUid={user.uid} />)}</div>}
      </section>
    </>}
  </div>;
}
