import React, { useEffect, useMemo, useState } from "react";
import { confirmDialog, promptDialog, copyText } from "../../ui/feedback";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs,
  getCountFromServer, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import "./SocialPages.css";

const MAX_ROWS = 50;
const EMPTY_MEMBER_UIDS = [];
const safeText = (value, max = 500) => String(value || "").trim().slice(0, max);
const nameOf = (user) => user?.displayName || user?.email?.split("@")[0] || "Lumora member";
const initialOf = (value) => (String(value || "L").trim()[0] || "L").toUpperCase();
const stamp = (value) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Just now";
};
const sortedPair = (a, b) => [a, b].sort();
const conversationId = (a, b) => sortedPair(a, b).join("__");
const isSafeImageUrl = (value) => {
  if (!value) return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol); } catch { return false; }
};

// Keep Firebase load failures actionable. A Firestore missing-index error is
// failed-precondition (not a network error); log its full server message so the
// Firebase Console's generated index-creation link is available in DevTools.
function describeFirestoreLoadError(scope, error) {
  const rawCode = String(error?.code || "unknown");
  const code = rawCode.split("/").pop();
  const message = String(error?.message || "");
  console.error(`[Lumora] ${scope} failed to load`, { code: rawCode, message, error });

  if (code === "failed-precondition" || /requires an index/i.test(message)) {
    return `${scope} needs a Firestore index. Publish the project's firestore.indexes.json and wait until the required index is Enabled. See the browser Console for the exact index details.`;
  }
  if (code === "permission-denied") {
    return `${scope} was denied by Firestore Security Rules. Confirm the latest rules are published to the same Firebase project and that this account is an active member.`;
  }
  if (code === "unavailable" || code === "deadline-exceeded" || code === "network-request-failed") {
    return `${scope} is temporarily unreachable. Check your connection and Firebase service status, then retry.`;
  }
  if (code === "unauthenticated") {
    return `${scope} requires a valid sign-in. Sign out and sign in again.`;
  }
  return `${scope} could not be loaded (Firebase error: ${rawCode}). Open the browser Console for details.`;
}

// Accept atomically and remove a reciprocal pending request, so old two-way requests
// cannot remain beside an established friendship. Existing friendship records are
// never overwritten because Firestore rules intentionally disallow client updates.
async function decideFriendRequest(request, accept) {
  const requestRef = doc(db, "friendRequests", request.id);
  if (!accept) {
    await updateDoc(requestRef, { status: "rejected", updatedAt: serverTimestamp() });
    return;
  }
  const firstFriendRef = doc(db, "friendships", `${request.senderUid}__${request.recipientUid}`);
  const secondFriendRef = doc(db, "friendships", `${request.recipientUid}__${request.senderUid}`);
  const reciprocalRef = doc(db, "friendRequests", `${request.recipientUid}__${request.senderUid}`);
  const [firstFriend, secondFriend, reciprocal] = await Promise.all([
    getDoc(firstFriendRef), getDoc(secondFriendRef), getDoc(reciprocalRef),
  ]);
  const batch = writeBatch(db);
  batch.update(requestRef, { status: "accepted", updatedAt: serverTimestamp() });
  if (!firstFriend.exists()) batch.set(firstFriendRef, { uid: request.senderUid, friendUid: request.recipientUid, createdAt: serverTimestamp() });
  if (!secondFriend.exists()) batch.set(secondFriendRef, { uid: request.recipientUid, friendUid: request.senderUid, createdAt: serverTimestamp() });
  if (reciprocal.exists() && reciprocal.data().status === "pending") batch.delete(reciprocalRef);
  await batch.commit();
}

async function removeFriendship(currentUid, peerUid) {
  if (!currentUid || !peerUid || currentUid === peerUid) throw new Error("Choose a valid friend to remove.");
  const refs = [
    doc(db, "friendships", `${currentUid}__${peerUid}`),
    doc(db, "friendships", `${peerUid}__${currentUid}`),
    doc(db, "friendRequests", `${currentUid}__${peerUid}`),
    doc(db, "friendRequests", `${peerUid}__${currentUid}`),
  ];
  // Do not batch-delete missing relationship documents: the security rules
  // deliberately validate ownership of existing records, so legacy one-way
  // friendships must be cleaned up only where a record actually exists.
  const snapshots = await Promise.all(refs.map((ref) => getDoc(ref)));
  const existingRefs = refs.filter((_, index) => snapshots[index].exists());
  if (!existingRefs.some((ref) => ref.path.startsWith("friendships/"))) {
    throw new Error("This friendship is no longer active. Refresh your friend list.");
  }
  const batch = writeBatch(db);
  existingRefs.forEach((ref) => batch.delete(ref));
  await batch.commit();
}

async function openDirectConversation(currentUid, peerUid) {
  if (!currentUid || !peerUid || currentUid === peerUid) {
    throw new Error("A conversation requires two different members.");
  }

  // Direct conversations always use the same deterministic UID-pair ID.
  // A per-user deletion marker is a history cutoff, never a reason to create
  // a second conversation visible to the other participant.
  const id = conversationId(currentUid, peerUid);
  const ref = doc(db, "conversations", id);
  const existing = await getDoc(ref);

  if (!existing.exists()) {
    await setDoc(ref, {
      type: "direct",
      memberUids: sortedPair(currentUid, peerUid),
      createdBy: currentUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      mutedBy: [],
      blockedBy: [],
    });
  } else {
    const members = existing.data().memberUids || [];
    if (!members.includes(currentUid) || !members.includes(peerUid)) {
      throw new Error("An older conversation record needs administrator review.");
    }
  }

  return id;
}
function PageHead({ eyebrow, title, description, action }) {
  return <header className="social-page-head"><div><span className="social-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <div className="social-page-head-action">{action}</div>}</header>;
}
function Notice({ error, children }) { return error ? <div className="social-alert" role="alert">{error}</div> : children ? <div className="social-notice" role="status">{children}</div> : null; }
function Avatar({ src, name, size = "md" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img className={`social-avatar social-avatar-${size}`} src={src} alt={`${name || "Member"} avatar`} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className={`social-avatar social-avatar-${size} social-avatar-fallback`}>{initialOf(name)}</span>;
}
function ProfileLink({ profile, uid }) {
  return <Link to={`/people/${uid}`} className="social-member-row"><Avatar src={profile?.avatarURL || profile?.photoURL} name={profile?.displayName || profile?.username} /><span className="social-member-copy"><strong>{profile?.displayName || profile?.username || "Lumora member"}</strong><small>{profile?.username ? `@${profile.username}` : "Community member"}</small></span></Link>;
}

function MemberProfilePreview({ profile, onClose, relationship = "unknown", busy = false, onAddFriend, onUnfriend, onAcceptRequest }) {
  const [actionMessage, setActionMessage] = useState("");
  useEffect(() => setActionMessage(""), [profile?.id]);
  useEffect(() => {
    if (!profile) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [profile?.id, onClose]);
  if (!profile) return null;
  const name = profile.displayName || profile.username || "Lumora member";
  const hasPrivateDetails = profile.profileUnavailable === true || profile.privacy === "private";
  const coverURL = isSafeImageUrl(profile.coverURL) ? profile.coverURL : "";
  const runAction = async (action, message) => {
    if (!action || busy) return;
    setActionMessage("");
    const succeeded = await action();
    if (succeeded) setActionMessage(message);
  };
  return <div className="social-profile-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="social-profile-preview-modal" role="dialog" aria-modal="true" aria-labelledby="social-profile-preview-title" aria-describedby="social-profile-preview-description" tabIndex={-1}>
      <button type="button" className="social-profile-preview-close" onClick={onClose} aria-label="Close profile preview" autoFocus>×</button>
      <div className="social-profile-preview-cover" style={coverURL ? { backgroundImage: `url("${coverURL}")` } : {}} />
      <Avatar src={profile.avatarURL || profile.photoURL} name={name} size="xl" />
      <div className="social-profile-preview-content"><h2 id="social-profile-preview-title">{name}</h2><p className="social-profile-preview-username">@{profile.username || "member"}</p>
        <p id="social-profile-preview-description">{profile.previewLoading ? "Loading profile…" : hasPrivateDetails ? "Some profile details are hidden by this member’s privacy settings." : (profile.bio || "This member has not added a bio yet.")}</p>
        <span className="social-status-pill">{profile.suspended ? "Account suspended" : profile.privacy === "private" ? "Private profile" : "Lumora member"}</span>
        {actionMessage && <p className="social-profile-action-message" role="status">{actionMessage}</p>}
        <div className="social-profile-preview-actions">
          {relationship === "friends" && <button type="button" className="social-danger-button" disabled={busy} onClick={() => runAction(onUnfriend, "Unfriended successfully.")}>Unfriend</button>}
          {relationship === "none" && <button type="button" className="social-primary-button" disabled={busy || profile.previewLoading} onClick={() => runAction(onAddFriend, "Friend request sent successfully.")}>＋ Add friend</button>}
          {relationship === "incoming" && <button type="button" className="social-primary-button" disabled={busy || profile.previewLoading} onClick={() => runAction(onAcceptRequest, "Friend request accepted successfully.")}>Accept request</button>}
          {relationship === "sent" && <span className="social-status-pill">Request sent</span>}
          <button type="button" className="social-quiet-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </section>
  </div>;
}

function MentionTextarea({ value, onChange, profiles = [], placeholder, rows = 3, maxLength = 3000, required = false, ariaLabel, sendOnEnter = false }) {
  const [suggestion, setSuggestion] = useState(null);
  const textareaRef = React.useRef(null);
  const candidates = useMemo(() => {
    const unique = new Map();
    profiles.filter((p) => p && p.id && p.username && p.id !== "").forEach((p) => unique.set(p.id, p));
    return [...unique.values()];
  }, [profiles]);
  const inspect = (nextValue, caret) => {
    const prefix = nextValue.slice(0, caret);
    const match = prefix.match(/(^|\s)@([a-zA-Z0-9_.-]{0,24})$/);
    if (!match) { setSuggestion(null); return; }
    const term = (match[2] || "").toLowerCase();
    const matches = candidates.filter((p) => String(p.username).toLowerCase().startsWith(term)).slice(0, 6);
    setSuggestion(matches.length ? { start: caret - match[2].length - 1, end: caret, matches } : null);
  };
  const choose = (person) => {
    if (!suggestion || !textareaRef.current) return;
    const before = value.slice(0, suggestion.start);
    const after = value.slice(suggestion.end);
    const inserted = `@${person.username} `;
    const next = `${before}${inserted}${after}`;
    onChange(next);
    setSuggestion(null);
    requestAnimationFrame(() => { if (textareaRef.current) { const caret = before.length + inserted.length; textareaRef.current.focus(); textareaRef.current.setSelectionRange(caret, caret); } });
  };
  return <div className="social-mention-field"><textarea ref={textareaRef} rows={rows} value={value} maxLength={maxLength} required={required} aria-label={ariaLabel} placeholder={placeholder} onChange={(event) => { onChange(event.target.value); inspect(event.target.value, event.target.selectionStart); }} onClick={(event) => inspect(value, event.currentTarget.selectionStart)} onKeyUp={(event) => { if (!["Shift", "Control", "Alt", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) inspect(value, event.currentTarget.selectionStart); }} onKeyDown={(event) => { if (!sendOnEnter || event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) return; if (suggestion?.matches?.length) { event.preventDefault(); choose(suggestion.matches[0]); return; } event.preventDefault(); event.currentTarget.form?.requestSubmit(); }} />{suggestion && <div className="social-mention-suggestions" role="listbox" aria-label="Mention a friend">{suggestion.matches.map((person) => <button type="button" role="option" aria-selected={false} key={person.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(person)}><Avatar src={person.avatarURL || person.photoURL} name={person.displayName || person.username} size="sm"/><span><strong>{person.displayName || person.username}</strong><small>@{person.username}</small></span></button>)}</div>}</div>;
}

function renderMentionText(value) {
  return String(value || "").split(/(@[a-zA-Z0-9_.-]{2,25})/g).map((part, index) => /^@[a-zA-Z0-9_.-]{2,25}$/.test(part) ? <span className="social-mention" key={`${part}-${index}`}>{part}</span> : part);
}

const POST_REACTIONS = [
  { type: "like", emoji: "👍", label: "Like" },
  { type: "love", emoji: "❤️", label: "Love" },
  { type: "haha", emoji: "😂", label: "Haha" },
  { type: "wow", emoji: "😮", label: "Wow" },
  { type: "sad", emoji: "😢", label: "Sad" },
];

function ReactionControl({ reaction = "", onReact, disabled = false }) {
  const [open, setOpen] = useState(false);
  const openTimer = React.useRef(null);
  const closeTimer = React.useRef(null);
  const active = POST_REACTIONS.find((item) => item.type === reaction) || POST_REACTIONS[0];
  const cancelTimers = () => { if (openTimer.current) clearTimeout(openTimer.current); if (closeTimer.current) clearTimeout(closeTimer.current); };
  useEffect(() => () => { if (openTimer.current) clearTimeout(openTimer.current); if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const scheduleOpen = () => { if (closeTimer.current) clearTimeout(closeTimer.current); if (!open) openTimer.current = setTimeout(() => setOpen(true), 1000); };
  const scheduleClose = () => { if (openTimer.current) clearTimeout(openTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 250); };
  return <div className="social-reaction-control" onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose} onFocus={scheduleOpen} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose(); }}>
    {open && <div className="social-reaction-picker" role="group" aria-label="Choose a reaction">{POST_REACTIONS.map((item) => <button key={item.type} type="button" title={item.label} aria-label={item.label} onClick={() => { cancelTimers(); setOpen(false); onReact(item.type); }}>{item.emoji}</button>)}</div>}
    <button type="button" className={`social-reaction-trigger ${reaction ? "active" : ""}`} disabled={disabled} aria-pressed={Boolean(reaction)} onClick={() => { cancelTimers(); setOpen(false); onReact(reaction ? "" : "like"); }}><span className="social-reaction-trigger-emoji">{reaction ? active.emoji : "👍"}</span><span>{reaction ? active.label : "Like"}</span></button>
  </div>;
}

async function notifyMentions({ text, senderUid, senderName, link, contextType, conversationId: chatId = "", postId = "", communityId = "" }) {
  const usernames = [...new Set((String(text || "").match(/@([a-z0-9_.-]{2,25})/gi) || []).map((match) => match.slice(1).toLowerCase()))].slice(0, 10);
  for (const username of usernames) {
    try {
      const usernameSnap = await getDoc(doc(db, "usernames", username));
      const targetUid = usernameSnap.exists() ? usernameSnap.data().uid : "";
      if (!targetUid || targetUid === senderUid) continue;
      await addDoc(collection(db, "users", targetUid, "notifications"), {
        type: "mention", title: "You were mentioned", message: `${senderName} mentioned you in ${contextType}.`,
        link, senderUid, ...(chatId ? { conversationId: chatId } : {}), ...(postId ? { postId } : {}), ...(communityId ? { communityId } : {}),
        isRead: false, createdAt: serverTimestamp(),
      });
    } catch { /* Mentions remain visible in the content if a recipient has notifications disabled. */ }
  }
}

export function SocialFeedPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [draftPosts, setDraftPosts] = useState([]);
  const [profile, setProfile] = useState({});
  const [mentionProfiles, setMentionProfiles] = useState([]);
  const [body, setBody] = useState("");
  const [imageURL, setImageURL] = useState("");
  const [tags, setTags] = useState("");
  const [category, setCategory] = useState("General");
  const [sort, setSort] = useState("recent");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState("");
  const setError = (message) => { setErrorState(message); };
  const [notice, setNoticeState] = useState("");
  const setNotice = (message) => { setNoticeState(message); };
  const [interactions, setInteractions] = useState({});
  const [suppressedUids, setSuppressedUids] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "publicProfiles", user.uid), (snapshot) => setProfile(snapshot.exists() ? snapshot.data() : {}), () => setProfile({}));
    return unsubscribe;
  }, [user.uid]);
  useEffect(() => onSnapshot(query(collection(db, "publicProfiles"), where("privacy", "==", "public"), limit(50)), (snap) => setMentionProfiles(snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }))), () => setMentionProfiles([])), []);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [blocked, muted] = await Promise.all([
          getDocs(query(collection(db, "users", user.uid, "blockedUsers"), limit(100))),
          getDocs(query(collection(db, "users", user.uid, "mutedUsers"), limit(100))),
        ]);
        if (active) setSuppressedUids([...new Set([...blocked.docs, ...muted.docs].map((entry) => entry.id))]);
      } catch { if (active) setSuppressedUids([]); }
    })();
    return () => { active = false; };
  }, [user.uid]);
  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, "posts"), where("status", "==", "published"), orderBy("createdAt", "desc"), limit(MAX_ROWS)), (snapshot) => {
      const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setPosts(rows);
    }, (loadError) => setError(describeFirestoreLoadError("Feed", loadError)));
    return unsubscribe;
  }, []);
  useEffect(() => onSnapshot(query(collection(db, "posts"), where("uid", "==", user.uid), where("status", "==", "draft"), orderBy("updatedAt", "desc"), limit(20)), (snapshot) => {
    const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    setDraftPosts(rows);
  }, () => {}), [user.uid]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = {};
      await Promise.all(posts.slice(0, 25).map(async (post) => {
        try {
          const [reaction, saved, counts, comments] = await Promise.all([
            getDoc(doc(db, "posts", post.id, "reactions", user.uid)),
            getDoc(doc(db, "users", user.uid, "savedPosts", post.id)),
            getCountFromServer(collection(db, "posts", post.id, "reactions")),
            getCountFromServer(query(collection(db, "postComments"), where("postId", "==", post.id), where("status", "==", "approved"))),
          ]);
          next[post.id] = { reaction: reaction.exists() ? reaction.data().type || "like" : "", saved: saved.exists(), count: counts.data().count, commentCount: comments.data().count };
        } catch { next[post.id] = { reaction: "", saved: false, count: 0, commentCount: Number(post.commentCount || 0) }; }
      }));
      if (!cancelled) setInteractions(next);
    })();
    return () => { cancelled = true; };
  }, [posts, user.uid]);

  const filtered = useMemo(() => {
    const rows = posts.filter((post) => !suppressedUids.includes(post.uid) && `${post.body || ""} ${post.category || ""} ${(post.tags || []).join(" ")} ${post.displayName || ""}`.toLowerCase().includes(search.toLowerCase().trim()));
    if (sort === "popular") return [...rows].sort((a, b) => Number(interactions[b.id]?.count ?? b.reactionCount ?? 0) - Number(interactions[a.id]?.count ?? a.reactionCount ?? 0));
    return rows;
  }, [posts, search, sort, interactions, suppressedUids]);

  const submitPost = async (event) => {
    event.preventDefault();
    const text = safeText(body, 5000);
    const image = safeText(imageURL, 2000);
    if (!text) { setError("Write something before publishing your post."); return; }
    if (!isSafeImageUrl(image)) { setError("Image URL must be a valid HTTP or HTTPS URL."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const tagsArray = [...new Set(tags.split(/[ ,#]+/).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
      const selectedStatus = event.nativeEvent?.submitter?.value === "draft" ? "draft" : "published";
      const newPost = await addDoc(collection(db, "posts"), {
        uid: user.uid, displayName: profile.displayName || nameOf(user), username: profile.username || "",
        avatarURL: profile.avatarURL || user.photoURL || "", body: text, imageURL: image,
        category: safeText(category, 50) || "General", tags: tagsArray, status: selectedStatus,
        pinned: false, reactionCount: 0, commentCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        editedAt: null, editHistory: [],
      });
      if (selectedStatus === "published") await notifyMentions({ text, senderUid: user.uid, senderName: profile.displayName || nameOf(user), link: `/post/${newPost.id}`, contextType: "a post", postId: newPost.id });
      setBody(""); setImageURL(""); setTags(""); setCategory("General"); setNotice(selectedStatus === "draft" ? "Draft saved. It is visible only to you until you publish it." : "Your post is now live.");
    } catch (saveError) { setError(saveError.code === "permission-denied" ? "Posting was denied. Confirm the Lumora Firestore rules were published." : "Your post could not be published. Please try again."); }
    finally { setBusy(false); }
  };

  const reactToPost = async (post, reactionType) => {
    setError("");
    const current = interactions[post.id] || { reaction: "", saved: false, count: 0 };
    const ref = doc(db, "posts", post.id, "reactions", user.uid);
    try {
      if (!reactionType || current.reaction === reactionType) await deleteDoc(ref);
      else await setDoc(ref, { uid: user.uid, type: reactionType, createdAt: serverTimestamp() });
      const nextReaction = !reactionType || current.reaction === reactionType ? "" : reactionType;
      const countDelta = current.reaction ? (nextReaction ? 0 : -1) : (nextReaction ? 1 : 0);
      setInteractions((old) => ({ ...old, [post.id]: { ...current, reaction: nextReaction, count: Math.max(0, current.count + countDelta) } }));
    } catch { setError("Reaction could not be saved. Please retry after checking your connection."); }
  };
  const savePost = async (post) => {
    const current = interactions[post.id] || { reaction: "", saved: false, count: 0 };
    try {
      const ref = doc(db, "users", user.uid, "savedPosts", post.id);
      if (current.saved) await deleteDoc(ref);
      else await setDoc(ref, { postId: post.id, savedAt: serverTimestamp() });
      setInteractions((old) => ({ ...old, [post.id]: { ...current, saved: !current.saved } }));
      setNotice(current.saved ? "Removed from your saved library." : "Post saved to your private library."); setError("");
    } catch { setError("Unable to update your saved library."); }
  };
  const editPost = async (post) => {
    const nextBody = await promptDialog("Edit your post", post.body || "", { message: "Update the text shown on your post.", placeholder: "Write your post…", multiline: true, required: true, confirmText: "Save changes" });
    if (nextBody === null) return;
    const trimmed = safeText(nextBody, 5000);
    if (!trimmed) { setError("A post cannot be empty."); return; }
    const nextImage = await promptDialog("Edit image URL", post.imageURL || "", { message: "Paste an HTTP or HTTPS image URL, or leave it empty to remove the image.", placeholder: "https://example.com/image.jpg", confirmText: "Save image" });
    if (nextImage === null) return;
    const cleanImage = safeText(nextImage, 2000);
    if (!isSafeImageUrl(cleanImage)) { setError("Image URL must be a valid HTTP or HTTPS URL."); return; }
    try {
      await updateDoc(doc(db, "posts", post.id), { body: trimmed, imageURL: cleanImage, updatedAt: serverTimestamp(), editedAt: serverTimestamp(), editHistory: [...(post.editHistory || []).slice(-9), { body: post.body || "", imageURL: post.imageURL || "", editedAt: new Date().toISOString() }] });
      setNotice("Post text and image URL updated."); setError("");
    } catch { setError("Post could not be edited. Confirm the current Firestore rules allow owners to update their post."); }
  };
  const publishDraft = async (post) => {
    try { await updateDoc(doc(db, "posts", post.id), { status: "published", updatedAt: serverTimestamp() }); setNotice("Draft published to your feed."); setError(""); }
    catch { setError("Draft could not be published. Check the latest Firestore rules."); }
  };
  const removePost = async (post) => {
    if (!await confirmDialog("Delete this post?", "This permanently deletes your post. This action cannot be undone.", { confirmText: "Delete post", danger: true })) return;
    try { await deleteDoc(doc(db, "posts", post.id)); setNotice("Post deleted."); }
    catch { setError("Post could not be deleted."); }
  };
  const sharePost = async (post) => {
    const shareUrl = `${window.location.origin}/feed#post-${post.id}`;
    try { await navigator.clipboard.writeText(shareUrl); setNotice("Post link copied to clipboard."); }
    catch { await copyText(shareUrl, "Copy post link"); }
  };
  const reportPost = async (post) => {
    const reason = await promptDialog("Report this post", "", { message: "Tell the moderation team why this post should be reviewed (3–500 characters).", placeholder: "Reason for reporting…", multiline: true, required: true, confirmText: "Submit report" });
    if (reason === null) return;
    if (safeText(reason, 500).length < 3) { setError("Please provide a reason of at least 3 characters."); return; }
    try { await addDoc(collection(db, "reports"), { reporterUid: user.uid, reporterEmail: user.email || "", targetType: "post", targetId: post.id, reason: safeText(reason, 500), status: "open", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); setNotice("Report sent to the moderation queue."); setError(""); }
    catch { setError("Report could not be submitted."); }
  };
  const pinPost = async (post) => {
    try { await updateDoc(doc(db, "posts", post.id), { pinned: !post.pinned, updatedAt: serverTimestamp() }); }
    catch { setError("Only your own post can be pinned to your profile."); }
  };

  return <div className="dashboard-page-content social-feed-page">
    <PageHead eyebrow="YOUR COMMUNITY" title="Your feed" description="Share a moment, exchange ideas, and keep up with people you care about." action={<Link to="/people" className="social-quiet-button">Find people ↗</Link>} />
    <Notice error={error}>{notice}</Notice>
    <div className="social-feed-grid"><div className="social-feed-main">
      <form className="social-composer" onSubmit={submitPost}><div className="social-compose-top"><Avatar src={profile.avatarURL || user.photoURL} name={profile.displayName || nameOf(user)} /><MentionTextarea ariaLabel="Post text" placeholder={`What's on your mind, ${profile.displayName || nameOf(user).split(" ")[0]}? Use @ to mention someone`} value={body} onChange={setBody} profiles={mentionProfiles} maxLength={5000} required rows={3} /></div>
        {imageURL && isSafeImageUrl(imageURL) && <div className="social-image-preview-wrap"><img src={imageURL} alt="Post preview" className="social-image-preview" onError={(event) => { event.currentTarget.dataset.failed = "true"; }} /><span>Image preview</span></div>}
        <div className="social-compose-fields"><label className="social-field"><span>Image URL</span><input type="url" value={imageURL} onChange={(event) => setImageURL(event.target.value)} placeholder="https://example.com/image.jpg" /></label><label className="social-field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>General</option><option>Ideas</option><option>Technology</option><option>Photography</option><option>Learning</option><option>Lifestyle</option><option>Questions</option></select></label><label className="social-field"><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="#ideas #today" /></label></div>
        {imageURL && !isSafeImageUrl(imageURL) && <p className="social-validation">Enter a valid image URL using http or https.</p>}
        <div className="social-compose-bottom"><span className="social-helper-text">Up to 5,000 characters · Image links only</span><button type="submit" name="postAction" value="draft" className="social-quiet-button" disabled={busy || !body.trim() || !isSafeImageUrl(imageURL)}>{busy ? "Saving…" : "Save draft"}</button><button type="submit" name="postAction" value="published" className="social-primary-button" disabled={busy || !body.trim() || !isSafeImageUrl(imageURL)}>{busy ? "Publishing…" : "Publish post"}</button></div>
      </form>
      {draftPosts.length > 0 && <section className="social-drafts-panel"><div className="social-drafts-heading"><div><span className="social-eyebrow">ONLY YOU CAN SEE THESE</span><h2>Your drafts ({draftPosts.length})</h2></div></div>{draftPosts.map((draftPost) => <article className="social-draft-row" key={draftPost.id}><div><strong>{draftPost.body.slice(0, 90)}{draftPost.body.length > 90 ? "…" : ""}</strong><small>{draftPost.category || "General"} · {stamp(draftPost.updatedAt || draftPost.createdAt)}</small></div><div className="social-inline-actions"><button type="button" className="social-primary-button" onClick={() => publishDraft(draftPost)}>Publish</button><button type="button" className="social-quiet-button" onClick={() => editPost(draftPost)}>Edit</button><button type="button" className="social-quiet-button" onClick={() => removePost(draftPost)}>Delete</button></div></article>)}</section>}
      <div className="social-feed-toolbar"><label className="social-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posts, tags or people" /></label><select aria-label="Sort feed" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Most recent</option><option value="popular">Popular</option></select></div>
      {filtered.length === 0 ? <section className="social-empty"><span>✧</span><h2>Your feed is ready</h2><p>Publish your first post, or visit Explore and find people to connect with.</p><Link to="/people" className="social-primary-button">Discover people</Link></section> : filtered.map((post) => {
        const state = interactions[post.id] || { reaction: "", saved: false, count: 0 };
        return <article className="social-post-card" id={`post-${post.id}`} key={post.id}>
          <div className="social-post-heading"><Avatar src={post.avatarURL} name={post.displayName} /><div className="social-post-author"><Link className="social-profile-author-link" to={`/people/${post.uid}`}><strong>{post.displayName || "Lumora member"}</strong></Link><small>{post.username ? `@${post.username} · ` : ""}{stamp(post.createdAt)}{post.editedAt ? " · edited" : ""}</small></div>{post.pinned && <span className="social-pin-badge">Pinned</span>}{post.uid === user.uid && <div className="social-post-menu"><button type="button" onClick={() => editPost(post)}>Edit</button><button type="button" onClick={() => pinPost(post)}>{post.pinned ? "Unpin" : "Pin"}</button><button type="button" onClick={() => removePost(post)}>Delete</button></div>}</div>
          <p className="social-post-body">{renderMentionText(post.body)}</p>{post.tags?.length > 0 && <div className="social-post-tags">{post.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
          {post.imageURL && isSafeImageUrl(post.imageURL) && <div className="social-post-image-frame"><img src={post.imageURL} alt="Post attachment" loading="lazy" /></div>}
          <div className="social-post-stats"><span>{state.count || 0} reactions</span><Link to={`/post/${post.id}`}>{state.commentCount ?? post.commentCount ?? 0} comments</Link><span className="social-category-pill">{post.category || "General"}</span><div className="social-engagement-ratio" aria-label={`${state.count || 0} reactions compared with ${state.commentCount ?? post.commentCount ?? 0} comments`}><span className="reaction-part" style={{ width: `${Math.max(3, ((state.count || 0) / Math.max(1, (state.count || 0) + (state.commentCount ?? post.commentCount ?? 0))) * 100)}%` }}/><span className="comment-part" style={{ width: `${Math.max(3, ((state.commentCount ?? post.commentCount ?? 0) / Math.max(1, (state.count || 0) + (state.commentCount ?? post.commentCount ?? 0))) * 100)}%` }}/></div></div>
          <div className="social-post-actions"><ReactionControl reaction={state.reaction} onReact={(type) => reactToPost(post, type)} /><Link to={`/post/${post.id}`}>☷ Comment</Link><button className={state.saved ? "active" : ""} onClick={() => savePost(post)} aria-pressed={state.saved}>{state.saved ? "★ Saved" : "☆ Save"}</button><button onClick={() => sharePost(post)}>↗ Share</button>{post.uid !== user.uid && <button onClick={() => reportPost(post)}>⚑ Report</button>}</div>
        </article>;
      })}
    </div><aside className="social-feed-aside"><section className="social-side-card"><span className="social-eyebrow">YOUR LUMORA</span><h2>People. Ideas. Stories.</h2><p>A thoughtful place to share what matters and discover a new perspective.</p><Link to="/profile" className="social-side-link">Make your profile yours ↗</Link></section><section className="social-side-card"><h3>Find your people</h3><p>Meet members, send friend requests, and message friends when they accept.</p><Link to="/people" className="social-side-link">Explore members ↗</Link><Link to="/friends" className="social-side-link">Friend requests ↗</Link></section><section className="social-side-card"><h3>Communities</h3><p>Start a focused space around a shared interest.</p><Link to="/communities" className="social-side-link">Browse communities ↗</Link></section><small className="social-side-footnote">Public posts are discoverable. Your saved library and private account settings stay private.</small></aside></div>
  </div>;
}

export function PeoplePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [people, setPeople] = useState([]);
  const [requests, setRequests] = useState([]);
  const [sent, setSent] = useState([]);
  const [friendIds, setFriendIds] = useState([]);
  const [reciprocalFriendIds, setReciprocalFriendIds] = useState([]);
  const [queryText, setQueryText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [previewPerson, setPreviewPerson] = useState(null);

  useEffect(() => onSnapshot(
    query(collection(db, "publicProfiles"), where("privacy", "==", "public"), limit(100)),
    (snap) => setPeople(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.id !== user.uid)),
    () => setError("Member directory could not be loaded. Publish the latest Firestore rules."),
  ), [user.uid]);
  useEffect(() => onSnapshot(query(collection(db, "friendships"), where("uid", "==", user.uid), limit(100)),
    (snap) => setFriendIds(snap.docs.map((d) => d.data().friendUid).filter(Boolean)),
    () => setError("Friend connections could not be loaded.")), [user.uid]);
  // Include legacy reciprocal records too. Older app versions could leave only one
  // directional friendship document, which otherwise made profiles look unconnected.
  useEffect(() => onSnapshot(query(collection(db, "friendships"), where("friendUid", "==", user.uid), limit(100)),
    (snap) => setReciprocalFriendIds(snap.docs.map((d) => d.data().uid).filter(Boolean)),
    () => setError("Reciprocal friend connections could not be loaded.")), [user.uid]);
  useEffect(() => onSnapshot(query(collection(db, "friendRequests"), where("recipientUid", "==", user.uid), where("status", "==", "pending"), limit(MAX_ROWS)),
    (snap) => setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => setError("Incoming requests could not be loaded. Check the deployed Firestore rules.")), [user.uid]);
  useEffect(() => onSnapshot(query(collection(db, "friendRequests"), where("senderUid", "==", user.uid), where("status", "==", "pending"), limit(MAX_ROWS)),
    (snap) => setSent(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => setError("Outgoing requests could not be loaded. Check the deployed Firestore rules.")), [user.uid]);

  const filtered = people.filter((p) => `${p.displayName || ""} ${p.username || ""} ${p.bio || ""}`.toLowerCase().includes(queryText.toLowerCase().trim()));
  const friendSet = new Set([...friendIds, ...reciprocalFriendIds]);
  const visibleRequests = requests.filter((r) => !friendSet.has(r.senderUid));
  const incomingBySender = new Map(visibleRequests.map((r) => [r.senderUid, r]));
  const outgoingByRecipient = new Map(sent.filter((r) => !friendSet.has(r.recipientUid)).map((r) => [r.recipientUid, r]));

  const addFriend = async (person) => {
    const recipientUid = person.id;
    if (friendSet.has(recipientUid)) { setNotice("You are already friends with this member."); return false; }
    if (incomingBySender.has(recipientUid)) { setNotice("This member already sent you a request. Accept it below."); return false; }
    const id = `${user.uid}__${recipientUid}`;
    let stage = "checking the current relationship";
    setBusy(id); setError(""); setNotice("");
    try {
      const requestRef = doc(db, "friendRequests", id);
      const existing = await getDoc(requestRef);
      if (existing.exists() && existing.data().status !== "rejected") {
        if (existing.data().status === "accepted") setNotice("This member is already connected to you.");
        else setNotice("Your friend request is already pending.");
        return false;
      }
      if (existing.exists()) {
        stage = "resubmitting a previously rejected request";
        await updateDoc(requestRef, {
          senderUid: user.uid, recipientUid, senderName: nameOf(user), senderUsername: "",
          recipientName: person.displayName || person.username || "Lumora member",
          status: "pending", updatedAt: serverTimestamp(),
        });
      } else {
        stage = "creating a new request";
        await setDoc(requestRef, {
          senderUid: user.uid, recipientUid, senderName: nameOf(user), senderUsername: "",
          recipientName: person.displayName || person.username || "Lumora member",
          status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
      }
      try {
        await addDoc(collection(db, "users", recipientUid, "notifications"), {
          type: "friend_request", title: "New friend request", message: `${nameOf(user)} wants to connect with you.`,
          link: "/friends", senderUid: user.uid, isRead: false, createdAt: serverTimestamp(),
        });
      } catch { /* Request is authoritative; notification delivery is optional. */ }
      setNotice("Friend request sent successfully. Messaging unlocks after acceptance.");
      return true;
    } catch (e) {
      console.error(`[Lumora] Friend request failed while ${stage}.`, { code: e.code, message: e.message });
      setError(e.code === "permission-denied"
        ? `Firestore denied ${stage}. Make sure the latest firestore.rules are published to project nexora123-324b0.`
        : `Could not send friend request. ${e.message || "Please retry."}`);
      return false;
    } finally { setBusy(""); }
  };

  const unfriend = async (person) => {
    if (!await confirmDialog("Unfriend this member?", `You and ${person.displayName || person.username || "this member"} will no longer be connected. Your existing messages will remain available.`, { confirmText: "Unfriend", danger: true })) return false;
    setBusy(person.id); setError(""); setNotice("");
    try { await removeFriendship(user.uid, person.id); setNotice(`You are no longer friends with ${person.displayName || person.username || "this member"}.`); return true; }
    catch (e) { setError(e.code === "permission-denied" ? "Firestore denied this action. Publish the latest security rules." : "Could not remove this friendship. Please retry."); return false; }
    finally { setBusy(""); }
  };

  const startChat = async (person) => {
    if (!friendSet.has(person.id)) return;
    setBusy(person.id); setError(""); setNotice("");
    try { const id = await openDirectConversation(user.uid, person.id); navigate(`/messages/${id}`); }
    catch (e) {
      console.error("[Lumora] Directory chat startup failed.", { code: e.code, message: e.message });
      setError(e.code === "permission-denied" ? "Firestore denied starting this chat. Publish the included rules and confirm that both friendship records exist." : (e.message || "Could not start this conversation."));
    } finally { setBusy(""); }
  };

  const respond = async (request, accept) => {
    if (!request) return false;
    setBusy(request.id); setError(""); setNotice("");
    try {
      await decideFriendRequest(request, accept);
      if (accept) {
        try { await addDoc(collection(db, "users", request.senderUid, "notifications"), {
          type: "friend_request_accepted", title: "Friend request accepted",
          message: `${nameOf(user)} accepted your friend request.`, link: "/friends",
          senderUid: user.uid, isRead: false, createdAt: serverTimestamp(),
        }); } catch { /* Friendship remains valid when notifications are disabled. */ }
      }
      setNotice(accept ? "Friend request accepted. You are now friends." : "Friend request declined.");
      return true;
    } catch (e) {
      console.error("[Lumora] Friend-request decision failed.", { code: e.code, message: e.message });
      setError(e.code === "permission-denied" ? "Firestore rejected this action. Confirm the latest rules are published." : "Could not update this friend request. Please retry.");
      return false;
    } finally { setBusy(""); }
  };

  return <div className="dashboard-page-content social-directory-page">
    <PageHead eyebrow="PEOPLE" title="Find your people" description="Discover members, open any profile, and connect without leaving the page." action={<Link to="/friends" className="social-quiet-button">Friend requests ({visibleRequests.length})</Link>} />
    <Notice error={error}>{notice}</Notice>
    <label className="social-search social-directory-search"><span>⌕</span><input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder="Search names, usernames or interests" /></label>
    {visibleRequests.length > 0 && <section className="social-surface-card"><h2>Requests waiting for you</h2><div className="social-member-grid">{visibleRequests.map((r) => <div className="social-person-card" key={r.id}><ProfileLink profile={{ displayName: r.senderName }} uid={r.senderUid} /><small>Wants to connect</small><div className="social-inline-actions"><button className="social-primary-button" onClick={() => respond(r, true)} disabled={!!busy}>Accept</button><button className="social-quiet-button" onClick={() => respond(r, false)} disabled={!!busy}>Decline</button></div></div>)}</div></section>}
    <div className="social-member-grid">{filtered.map((p) => {
      const incoming = incomingBySender.get(p.id);
      const outgoing = outgoingByRecipient.get(p.id);
      return <article className="social-person-card" key={p.id}>
        <div className="social-person-link"><Link to={`/people/${p.id}`} className="social-person-profile-link"><Avatar src={p.avatarURL || p.photoURL} name={p.displayName || p.username} size="lg" /><strong>{p.displayName || p.username || "Lumora member"}</strong><small>@{p.username || "member"}</small><p>{p.bio || "Here to share ideas and connect."}</p></Link><div className="social-inline-actions"><button type="button" className="social-quiet-button" onClick={() => setPreviewPerson(p)}>View</button></div></div>
        {friendSet.has(p.id)
          ? <div className="social-inline-actions"><span className="social-status-pill">✓ Already friends</span><button type="button" className="social-quiet-button" disabled={!!busy} onClick={() => startChat(p)}>Message ↗</button><button type="button" className="social-danger-button" disabled={!!busy} onClick={() => unfriend(p)}>Unfriend</button></div>
          : incoming
            ? <button className="social-primary-button" onClick={() => respond(incoming, true)} disabled={!!busy}>Accept request</button>
            : outgoing
              ? <span className="social-status-pill">Request sent</span>
              : <button className="social-primary-button" onClick={() => addFriend(p)} disabled={!!busy}>＋ Add friend</button>}
      </article>;
    })}</div>
    {filtered.length === 0 && <div className="social-empty"><h2>No members found</h2><p>Try another search. Profiles appear here once members set up a public profile.</p></div>}
    <MemberProfilePreview profile={previewPerson} relationship={!previewPerson ? "unknown" : friendSet.has(previewPerson.id) ? "friends" : incomingBySender.has(previewPerson.id) ? "incoming" : outgoingByRecipient.has(previewPerson.id) ? "sent" : "none"} busy={Boolean(busy)} onAddFriend={() => addFriend(previewPerson)} onUnfriend={() => unfriend(previewPerson)} onAcceptRequest={() => respond(incomingBySender.get(previewPerson?.id), true)} onClose={() => setPreviewPerson(null)} />
  </div>;
}

export function FriendsPage() {
  const { user } = useAuth();
  const [friends, setFriends] = useState([]);
  const [ownFriendIds, setOwnFriendIds] = useState([]);
  const [reciprocalFriendIds, setReciprocalFriendIds] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [previewPerson, setPreviewPerson] = useState(null);

  useEffect(() => onSnapshot(query(collection(db, "friendships"), where("uid", "==", user.uid), limit(100)),
    (snap) => setOwnFriendIds(snap.docs.map((d) => d.data().friendUid).filter(Boolean)),
    (e) => setError(e.code === "permission-denied" ? "Friend list access was denied by Firestore rules." : "Could not load friends.")), [user.uid]);
  useEffect(() => onSnapshot(query(collection(db, "friendships"), where("friendUid", "==", user.uid), limit(100)),
    (snap) => setReciprocalFriendIds(snap.docs.map((d) => d.data().uid).filter(Boolean)),
    () => setError("Reciprocal friend connections could not be loaded.")), [user.uid]);
  useEffect(() => {
    let active = true;
    const ids = [...new Set([...ownFriendIds, ...reciprocalFriendIds].filter((id) => id && id !== user.uid))];
    Promise.all(ids.map(async (id) => {
      try { const profile = await getDoc(doc(db, "publicProfiles", id)); return [id, profile.exists() ? profile.data() : {}]; }
      catch { return [id, { profileUnavailable: true, privacy: "private" }]; }
    })).then((rows) => { if (active) { const byId = Object.fromEntries(rows); setFriends(ids.map((id) => ({ id, ...(byId[id] || {}) }))); } });
    return () => { active = false; };
  }, [user.uid, ownFriendIds, reciprocalFriendIds]);
  useEffect(() => onSnapshot(query(collection(db, "friendRequests"), where("recipientUid", "==", user.uid), where("status", "==", "pending"), limit(50)),
    (snap) => setIncoming(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => setError("Incoming requests could not be loaded. Confirm that Firestore rules are published.")), [user.uid]);
  useEffect(() => onSnapshot(query(collection(db, "friendRequests"), where("senderUid", "==", user.uid), where("status", "==", "pending"), limit(50)),
    (snap) => setOutgoing(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => setError("Outgoing requests could not be loaded. Confirm that Firestore rules are published.")), [user.uid]);

  const openPreview = async (uid, fallback = {}) => {
    setPreviewPerson({ id: uid, ...fallback, previewLoading: true });
    try {
      const snap = await getDoc(doc(db, "publicProfiles", uid));
      setPreviewPerson(snap.exists() ? { id: uid, ...snap.data() } : { id: uid, ...fallback, profileUnavailable: true });
    } catch {
      setPreviewPerson({ id: uid, ...fallback, profileUnavailable: true, privacy: "private" });
    }
  };
  const friendIds = new Set(friends.map((f) => f.id));
  const visibleIncoming = incoming.filter((r) => !friendIds.has(r.senderUid));
  const visibleOutgoing = outgoing.filter((r) => !friendIds.has(r.recipientUid));
  const answer = async (request, accept) => {
    if (!request) return false;
    setBusy(request.id); setError(""); setNotice("");
    try {
      await decideFriendRequest(request, accept);
      if (accept) {
        try { await addDoc(collection(db, "users", request.senderUid, "notifications"), {
          type: "friend_request_accepted", title: "Friend request accepted", message: `${nameOf(user)} accepted your friend request.`,
          link: "/friends", senderUid: user.uid, isRead: false, createdAt: serverTimestamp(),
        }); } catch { /* Do not undo a successful friendship for a failed notification. */ }
      }
      setNotice(accept ? "Friend request accepted. You are now friends and can message each other." : "Friend request declined.");
      return true;
    } catch (e) {
      console.error("[Lumora] Friend request acceptance failed.", { code: e.code, message: e.message });
      setError(e.code === "permission-denied" ? "Firestore denied this request. Confirm that the latest rules are published." : "Request could not be updated. Please retry.");
      return false;
    } finally { setBusy(""); }
  };
  const addFriend = async (person) => {
    if (!person?.id || person.id === user.uid) return false;
    if (friendIds.has(person.id)) { setNotice("You are already friends with this member."); return false; }
    const requestId = `${user.uid}__${person.id}`;
    setBusy(person.id); setError(""); setNotice("");
    try {
      const requestRef = doc(db, "friendRequests", requestId);
      const existing = await getDoc(requestRef);
      if (existing.exists() && existing.data().status !== "rejected") {
        setNotice(existing.data().status === "accepted" ? "You are already connected to this member." : "Your friend request is already pending.");
        return false;
      }
      const requestData = {
        senderUid: user.uid, recipientUid: person.id, senderName: nameOf(user), senderUsername: "",
        recipientName: person.displayName || person.username || "Lumora member", status: "pending", updatedAt: serverTimestamp(),
      };
      if (existing.exists()) await updateDoc(requestRef, requestData);
      else await setDoc(requestRef, { ...requestData, createdAt: serverTimestamp() });
      try { await addDoc(collection(db, "users", person.id, "notifications"), { type: "friend_request", title: "New friend request", message: `${nameOf(user)} wants to connect with you.`, link: "/friends", senderUid: user.uid, isRead: false, createdAt: serverTimestamp() }); } catch { /* The request remains authoritative if notification delivery is unavailable. */ }
      setNotice("Friend request sent successfully.");
      return true;
    } catch (e) {
      setError(e.code === "permission-denied" ? "Firestore denied this request. Confirm the latest rules are published." : "Could not send the friend request. Please retry.");
      return false;
    } finally { setBusy(""); }
  };
  const unfriend = async (friend) => {
    if (!await confirmDialog("Unfriend this member?", `You and ${friend.displayName || friend.username || "this member"} will no longer be connected. Existing messages will remain available.`, { confirmText: "Unfriend", danger: true })) return false;
    setBusy(friend.id); setError(""); setNotice("");
    try { await removeFriendship(user.uid, friend.id); setNotice(`Unfriended ${friend.displayName || friend.username || "member"}.`); return true; }
    catch (e) { setError(e.code === "permission-denied" ? "Firestore denied this action. Publish the latest security rules." : "Could not remove this friendship. Please retry."); return false; }
    finally { setBusy(""); }
  };
  const startChat = async (friend) => {
    setBusy(friend.id); setError("");
    try {
      const id = await openDirectConversation(user.uid, friend.id);
      window.location.assign(`/messages/${id}`);
    } catch (e) {
      console.error("[Lumora] Could not open direct conversation.", { code: e.code, message: e.message });
      setError(e.code === "permission-denied"
        ? "Firestore denied starting the chat. Publish the included rules; they allow safe checks for a not-yet-created conversation and require an active friendship to create it."
        : (e.message || "Could not start a conversation. Confirm that this connection is still active."));
    } finally { setBusy(""); }
  };

  return <div className="dashboard-page-content social-directory-page">
    <PageHead eyebrow="YOUR CIRCLE" title="Friends" description="Manage requests and message people who have accepted your connection." action={<Link to="/people" className="social-quiet-button">Discover people ↗</Link>} />
    <Notice error={error}>{notice}</Notice>
    <section className="social-surface-card"><h2>Friend requests <span className="social-count-pill">{visibleIncoming.length}</span></h2>{visibleIncoming.length ? <div className="social-request-list">{visibleIncoming.map((r) => <div key={r.id} className="social-request-row"><ProfileLink profile={{ displayName: r.senderName }} uid={r.senderUid}/><div><small>Sent you a friend request</small></div><div className="social-inline-actions"><button className="social-quiet-button" onClick={() => openPreview(r.senderUid, { displayName: r.senderName || "Lumora member", username: r.senderUsername || "" })}>View</button><button className="social-primary-button" disabled={!!busy} onClick={() => answer(r, true)}>Accept</button><button className="social-quiet-button" disabled={!!busy} onClick={() => answer(r, false)}>Decline</button></div></div>)}</div> : <p className="social-muted-copy">No pending requests.</p>}</section>
    <section className="social-surface-card"><h2>Your friends <span className="social-count-pill">{friends.length}</span></h2>{friends.length ? <div className="social-friends-list">{friends.map((f) => <div className="social-request-row" key={f.id}><ProfileLink profile={f} uid={f.id}/><span className="social-status-pill">✓ Already friends</span><div className="social-inline-actions"><button type="button" className="social-quiet-button" onClick={() => setPreviewPerson(f)}>View</button><button className="social-primary-button" disabled={!!busy} onClick={() => startChat(f)}>Message ↗</button><button className="social-danger-button" disabled={!!busy} onClick={() => unfriend(f)}>Unfriend</button></div></div>)}</div> : <p className="social-muted-copy">Your friend list is empty. Discover members and send a request to get started.</p>}</section>
    <section className="social-surface-card"><h2>Requests you sent <span className="social-count-pill">{visibleOutgoing.length}</span></h2>{visibleOutgoing.length ? visibleOutgoing.map((r) => <div className="social-request-row" key={r.id}><ProfileLink profile={{ displayName: r.recipientName }} uid={r.recipientUid}/><small>Waiting for a response</small><span className="social-status-pill">Pending</span><button type="button" className="social-quiet-button" onClick={() => openPreview(r.recipientUid, { displayName: r.recipientName || "Lumora member", username: r.recipientUsername || "" })}>View</button></div>) : <p className="social-muted-copy">No outgoing requests.</p>}</section>
    <MemberProfilePreview profile={previewPerson} relationship={!previewPerson ? "unknown" : friendIds.has(previewPerson.id) ? "friends" : visibleIncoming.some((request) => request.senderUid === previewPerson.id) ? "incoming" : visibleOutgoing.some((request) => request.recipientUid === previewPerson.id) ? "sent" : "none"} busy={Boolean(busy)} onAddFriend={() => addFriend(previewPerson)} onUnfriend={() => unfriend(previewPerson)} onAcceptRequest={() => answer(visibleIncoming.find((request) => request.senderUid === previewPerson?.id), true)} onClose={() => setPreviewPerson(null)} />
  </div>;
}

export function MessagesPage() {
  const { user } = useAuth(); const { conversationId: selectedConversation } = useParams(); const navigate = useNavigate();
  const [conversations, setConversations] = useState([]); const [hiddenConversations, setHiddenConversations] = useState({}); const [hiddenConversationsLoaded, setHiddenConversationsLoaded] = useState(false); const [ownFriendIds, setOwnFriendIds] = useState([]); const [reciprocalFriendIds, setReciprocalFriendIds] = useState([]); const [profiles, setProfiles] = useState({});
  const [blockedAccountIds, setBlockedAccountIds] = useState([]); const [mutedAccountIds, setMutedAccountIds] = useState([]); const [messages, setMessages] = useState([]); const [draft, setDraft] = useState(""); const [imageURL, setImageURL] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [queryText, setQueryText] = useState(""); const [showGroupForm, setShowGroupForm] = useState(false); const [groupName, setGroupName] = useState(""); const [friendChoices, setFriendChoices] = useState([]); const [selectedFriends, setSelectedFriends] = useState([]); const [groupInvites, setGroupInvites] = useState([]); const [showChatMenu, setShowChatMenu] = useState(false); const [showImageUrl, setShowImageUrl] = useState(false);
  useEffect(() => onSnapshot(collection(db, "users", user.uid, "hiddenConversations"), (snap) => {
    const values = {};
    snap.docs.forEach((entry) => { values[entry.id] = entry.data({ serverTimestamps: "estimate" }).deletedAt || null; });
    setHiddenConversations(values); setHiddenConversationsLoaded(true);
  }, () => { setHiddenConversations({}); setHiddenConversationsLoaded(true); }), [user.uid]);
  // Keep account-level block/mute lists live in the chat screen. These listeners
  // must live in MessagesPage, where their state setters are declared.
  useEffect(() => onSnapshot(
    query(collection(db, "users", user.uid, "blockedUsers"), limit(100)),
    (snap) => setBlockedAccountIds(snap.docs.map((entry) => entry.id)),
    (error) => { console.error("[Lumora] Could not load blocked accounts.", error); setBlockedAccountIds([]); },
  ), [user.uid]);
  useEffect(() => onSnapshot(
    query(collection(db, "users", user.uid, "mutedUsers"), limit(100)),
    (snap) => setMutedAccountIds(snap.docs.map((entry) => entry.id)),
    (error) => { console.error("[Lumora] Could not load muted accounts.", error); setMutedAccountIds([]); },
  ), [user.uid]);
  useEffect(() => onSnapshot(query(collection(db, "conversations"), where("memberUids", "array-contains", user.uid), orderBy("lastMessageAt", "desc"), limit(MAX_ROWS)), async (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setConversations(rows);
    // Clear a stale list error when Firestore starts delivering valid snapshots again.
    setError("");
    const ids = [...new Set(rows.flatMap((r) => r.memberUids || []).filter((id) => id !== user.uid))];
    const pairs = await Promise.all(ids.map(async (id) => { try { const profile = await getDoc(doc(db, "publicProfiles", id)); return [id, profile.exists() ? profile.data() : {}]; } catch { return [id, {}]; } }));
    setProfiles(Object.fromEntries(pairs));
  }, (e) => setError(describeFirestoreLoadError("Chats", e))), [user.uid]);
  useEffect(() => onSnapshot(query(collection(db, "friendships"), where("uid", "==", user.uid), limit(100)),
    (snap) => setOwnFriendIds(snap.docs.map((d) => d.data().friendUid).filter(Boolean)), () => {}), [user.uid]);
  useEffect(() => onSnapshot(query(collection(db, "friendships"), where("friendUid", "==", user.uid), limit(100)),
    (snap) => setReciprocalFriendIds(snap.docs.map((d) => d.data().uid).filter(Boolean)), () => {}), [user.uid]);
  useEffect(() => {
    let active = true;
    const ids = [...new Set([...ownFriendIds, ...reciprocalFriendIds].filter((id) => id && id !== user.uid))];
    Promise.all(ids.map(async (id) => { try { const p = await getDoc(doc(db, "publicProfiles", id)); return { id, ...(p.exists() ? p.data() : {}) }; } catch { return { id, displayName: "Friend" }; } }))
      .then((rows) => { if (active) setFriendChoices(rows); });
    return () => { active = false; };
  }, [user.uid, ownFriendIds, reciprocalFriendIds]);
  useEffect(() => onSnapshot(query(collection(db, "conversationInvites"), where("recipientUid", "==", user.uid), where("status", "==", "pending"), limit(20)), (snap) => setGroupInvites(snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }))), () => setGroupInvites([])), [user.uid]);
  useEffect(() => {
    // Clear the previous thread immediately while the next route is validated.
    setMessages([]);
    if (!selectedConversation || !hiddenConversationsLoaded) return undefined;

    let cancelled = false;
    let unsubscribeMessages = () => {};
    let unsubscribeConversationRead = () => {};

    const loadConversation = async () => {
      const conversationRef = doc(db, "conversations", selectedConversation);
      const conversationSnap = await getDoc(conversationRef);
      if (!conversationSnap.exists()
        || !(conversationSnap.data().memberUids || []).includes(user.uid)) {
        if (!cancelled) {
          setError("This conversation is unavailable.");
          navigate("/messages", { replace: true });
        }
        return;
      }

      // Redirect legacy random-ID duplicate direct threads to the canonical
      // UID-pair thread whenever that original thread exists.
      const conversationData = conversationSnap.data();
      if (conversationData.type === "direct") {
        const peerId = (conversationData.memberUids || []).find((id) => id !== user.uid);
        const canonicalId = peerId ? conversationId(user.uid, peerId) : null;
        if (canonicalId && canonicalId !== selectedConversation) {
          const canonicalSnap = await getDoc(doc(db, "conversations", canonicalId));
          if (canonicalSnap.exists()) {
            if (!cancelled) navigate(`/messages/${canonicalId}`, { replace: true });
            return;
          }
        }
      }

      const cutoff = hiddenConversations[selectedConversation] || null;
      const lastMessageAt = conversationSnap.data().lastMessageAt;
      const toMillis = (value) => value?.toMillis?.()
        ?? (value instanceof Date ? value.getTime() : (value ? new Date(value).getTime() : 0));

      // This user deleted only their own copy. Hide the thread until a new
      // message exists after the cutoff; the other participant keeps the same thread.
      if (cutoff && toMillis(lastMessageAt) <= toMillis(cutoff)) {
        if (!cancelled) {
          setError("");
          navigate("/messages", { replace: true });
        }
        return;
      }

      // Keep read state synchronized while the chat remains open. A one-time read
      // update is insufficient: a new incoming message can arrive after the route
      // effect has started, so listen for the latest conversation metadata too.
      // This drives bold/unbold previews and the Messages badge independently of
      // the user's in-app chat-notification preference.
      const markLatestAsRead = (latestData) => {
        if (latestData?.lastMessageSenderUid
          && latestData.lastMessageSenderUid !== user.uid
          && !(latestData.lastMessageReadBy || []).includes(user.uid)) {
          updateDoc(conversationRef, { lastMessageReadBy: arrayUnion(user.uid) }).catch(() => {});
        }
      };
      markLatestAsRead(conversationData);
      unsubscribeConversationRead = onSnapshot(conversationRef, (latestSnap) => {
        if (!cancelled && latestSnap.exists()) markLatestAsRead(latestSnap.data());
      }, (readError) => console.warn("[Lumora] Could not sync conversation read state.", readError));

      getDocs(query(
        collection(db, "users", user.uid, "notifications"),
        where("conversationId", "==", selectedConversation),
        where("isRead", "==", false),
        limit(50),
      )).then((snap) => {
        snap.docs.forEach((entry) => updateDoc(entry.ref, {
          isRead: true,
          readAt: serverTimestamp(),
        }).catch(() => {}));
      }).catch(() => {});

      const messageCollection = collection(db, "conversations", selectedConversation, "messages");
      // Firestore Rules cannot reliably prove that a query's client-supplied
      // timestamp bound equals another document's deletedAt value. Read messages
      // for this conversation's members, then enforce the per-user cutoff in UI.
      const messageQuery = query(messageCollection, orderBy("createdAt", "desc"), limit(100));

      unsubscribeMessages = onSnapshot(messageQuery, (snap) => {
        if (cancelled) return;
        const allRows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
        const toMillis = (value) => value?.toMillis?.()
          ?? (value instanceof Date ? value.getTime() : (value ? new Date(value).getTime() : 0));
        const rows = cutoff
          ? allRows.filter((message) => toMillis(message.createdAt) > toMillis(cutoff))
          : allRows;
        setMessages(rows);
        rows.filter((m) => m.senderUid !== user.uid && !m.readBy?.includes(user.uid))
          .slice(-20)
          .forEach((m) => updateDoc(
            doc(db, "conversations", selectedConversation, "messages", m.id),
            { readBy: arrayUnion(user.uid) },
          ).catch(() => {}));
      }, (loadError) => {
        if (!cancelled) setError(describeFirestoreLoadError("Messages", loadError));
      });
    };

    loadConversation().catch((loadError) => {
      if (!cancelled) setError(describeFirestoreLoadError("Messages", loadError));
    });

    return () => {
      cancelled = true;
      unsubscribeMessages();
      unsubscribeConversationRead();
    };
  }, [selectedConversation, user.uid, navigate, hiddenConversations, hiddenConversationsLoaded]);
  const active = conversations.find((c) => c.id === selectedConversation);
  const peerUid = active?.memberUids?.find((id) => id !== user.uid); const peer = profiles[peerUid] || {};
  const send = async (event) => {
    event.preventDefault(); const text = safeText(draft, 3000); const image = safeText(imageURL, 2000);
    if (peerUid && blockedAccountIds.includes(peerUid)) { setError("This account is blocked. Unblock it before sending messages."); return; }
    if (!text && !image) return; if (!isSafeImageUrl(image)) { setError("Image URL must begin with HTTP or HTTPS."); return; }
    setBusy(true); setError("");
    try {
      const ref = collection(db, "conversations", selectedConversation, "messages");
      await addDoc(ref, { senderUid: user.uid, senderName: nameOf(user), text, imageURL: image, createdAt: serverTimestamp(), readBy: [user.uid], editedAt: null });
      await updateDoc(doc(db, "conversations", selectedConversation), {
        lastMessage: text || "Shared an image",
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessageSenderUid: user.uid,
        lastMessageReadBy: [user.uid],
      });
      const recipients = (active?.memberUids || []).filter((id) => id !== user.uid).slice(0, 19);
      for (const recipientUid of recipients) {
        try {
          const preferenceSnap = await getDoc(doc(db, "users", recipientUid, "settings", "preferences"));
          const chatNotificationsEnabled = !preferenceSnap.exists() || preferenceSnap.data().chat !== false;
          if (!chatNotificationsEnabled) continue;
          await addDoc(collection(db, "users", recipientUid, "notifications"), {
            type: "chat", title: "New message", message: `${nameOf(user)} sent you a message.`,
            link: `/messages/${selectedConversation}`, senderUid: user.uid,
            conversationId: selectedConversation, isRead: false, createdAt: serverTimestamp(),
          });
        } catch { /* Message delivery/read state must work even if notification delivery fails. */ }
      }
      if (active?.type === "group" && text) await notifyMentions({ text, senderUid: user.uid, senderName: nameOf(user), link: `/messages/${selectedConversation}`, contextType: "a group chat", conversationId: selectedConversation });
      setDraft(""); setImageURL("");
    } catch (e) { setError(e.code === "permission-denied" ? "This conversation is not available for your account, or the Firestore rules are not deployed." : "Message could not be sent."); }
    finally { setBusy(false); }
  };
  const createGroupChat = async (event) => {
    event.preventDefault(); setError("");
    const invitees = [...new Set(selectedFriends.filter((uid) => friendChoices.some((friend) => friend.id === uid) && uid !== user.uid))];
    if (invitees.length < 1) { setError("Select at least one confirmed friend. They must accept before joining the group."); return; }
    if (invitees.length > 8) { setError("A group can invite at most 8 friends at once (9 people total), keeping Firestore permission checks within safe batch limits."); return; }
    setBusy(true);
    try {
      const ref = doc(collection(db, "conversations"));
      const batch = writeBatch(db);
      const cleanName = safeText(groupName, 80) || "Group conversation";
      batch.set(ref, { type: "group", name: cleanName, memberUids: [user.uid], moderatorUids: [user.uid], createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastMessage: "", lastMessageAt: serverTimestamp(), mutedBy: [], blockedBy: [] });
      invitees.forEach((recipientUid) => {
        const inviteRef = doc(db, "conversationInvites", `${ref.id}__${recipientUid}`);
        batch.set(inviteRef, { conversationId: ref.id, senderUid: user.uid, recipientUid, status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      await batch.commit();
      for (const recipientUid of invitees) {
        try {
          const preferenceSnap = await getDoc(doc(db, "users", recipientUid, "settings", "preferences"));
          const chatNotificationsEnabled = !preferenceSnap.exists() || preferenceSnap.data().chat !== false;
          if (!chatNotificationsEnabled) continue;
          await addDoc(collection(db, "users", recipientUid, "notifications"), {
            type: "group_chat_invite", title: "Group chat invitation",
            message: `${nameOf(user)} invited you to “${cleanName}”.`,
            link: `/messages/${ref.id}`, senderUid: user.uid, conversationId: ref.id,
            isRead: false, createdAt: serverTimestamp(),
          });
        } catch { /* The invite remains authoritative when notifications are disabled/unavailable. */ }
      }
      setShowGroupForm(false); setGroupName(""); setSelectedFriends([]); navigate(`/messages/${ref.id}`);
    } catch (e) { setError(e.code === "permission-denied" ? "Group invite creation was denied. Publish the current Firestore rules and indexes." : "Could not create group chat. Please retry."); }
    finally { setBusy(false); }
  };
  const respondToGroupInvite = async (invite, accept) => {
    setBusy(true); setError("");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "conversationInvites", invite.id), { status: accept ? "accepted" : "rejected", updatedAt: serverTimestamp() });
      if (accept) batch.update(doc(db, "conversations", invite.conversationId), { memberUids: arrayUnion(user.uid), updatedAt: serverTimestamp() });
      await batch.commit();
      if (accept) navigate(`/messages/${invite.conversationId}`);
    } catch (e) { setError(e.code === "permission-denied" ? "This invitation could not be accepted. Check that the latest Firestore rules are published." : "Could not update invitation."); }
    finally { setBusy(false); }
  };
  const reportConversation = async () => { const reason = await promptDialog("Report conversation", "", { message: "Tell the moderation team why this conversation should be reviewed.", placeholder: "Reason for reporting…", multiline: true, required: true, confirmText: "Submit report" }); if (reason === null) return; if (safeText(reason,500).length < 3) { setError("Please provide at least 3 characters."); return; } try { await addDoc(collection(db,"reports"),{reporterUid:user.uid,reporterEmail:user.email||"",targetType:"conversation",targetId:selectedConversation,reason:safeText(reason,500),status:"open",createdAt:serverTimestamp(),updatedAt:serverTimestamp()}); setError("Report submitted for review."); } catch { setError("Could not report this conversation."); } };
  const mute = async (conv) => {
    const targetUid = conv.type === "direct" ? conv.memberUids?.find((id) => id !== user.uid) : "";
    if (!targetUid) { setError("Account-level mute is available for direct conversations. Group notifications can be muted separately later."); return; }
    const alreadyMuted = mutedAccountIds.includes(targetUid);
    try {
      const ref = doc(db, "users", user.uid, "mutedUsers", targetUid);
      if (alreadyMuted) await deleteDoc(ref);
      else await setDoc(ref, { uid: targetUid, createdAt: serverTimestamp() });
      try { await updateDoc(doc(db, "conversations", conv.id), { mutedBy: alreadyMuted ? arrayRemove(user.uid) : arrayUnion(user.uid) }); } catch { /* Account mute is the source of truth; conversation metadata is best effort. */ }
    } catch (e) { setError(e.code === "permission-denied" ? "Firestore denied the mute action. Publish the latest Lumora rules." : "Could not update mute setting."); }
  };
  const block = async (conv) => {
    const targetUid = conv.type === "direct" ? conv.memberUids?.find((id) => id !== user.uid) : "";
    if (!targetUid) { setError("Only direct conversations can be blocked."); return; }
    const alreadyBlocked = blockedAccountIds.includes(targetUid);
    if (!alreadyBlocked && !await confirmDialog("Block this account?", "This will add the account to Settings → Blocked accounts and restrict direct messaging.", { confirmText: "Block account", danger: true })) return;
    try {
      const ref = doc(db, "users", user.uid, "blockedUsers", targetUid);
      if (alreadyBlocked) await deleteDoc(ref);
      else await setDoc(ref, { uid: targetUid, createdAt: serverTimestamp() });
      try { await updateDoc(doc(db, "conversations", conv.id), { blockedBy: alreadyBlocked ? arrayRemove(user.uid) : arrayUnion(user.uid) }); } catch { /* Account-level record remains authoritative. */ }
      if (!alreadyBlocked) setError("Account blocked. It is now listed in Settings → Blocked accounts.");
    } catch (e) { setError(e.code === "permission-denied" ? "Firestore denied the block action. Publish the latest Lumora rules." : "Could not update account blocking."); }
  };
  const removeConversationForMe = async (conv) => {
    const label = conv.type === "group" ? (conv.name || "this group") : "this conversation";
    if (!await confirmDialog(`Delete your copy of ${label}?`, "Messages sent before this deletion will no longer appear in your account, even if you reopen this chat. Other participants keep their copies. New messages sent after deletion can appear normally.", { confirmText: "Delete my copy", danger: true })) return;
    setBusy(true); setError("");
    try {
      const markerRef = doc(db, "users", user.uid, "hiddenConversations", conv.id);
      await setDoc(markerRef, { conversationId: conv.id, deletedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      // Read the committed server timestamp rather than trusting the browser clock.
      const markerSnapshot = await getDoc(markerRef);
      const persistedCutoff = markerSnapshot.exists() ? markerSnapshot.data().deletedAt : null;
      if (!persistedCutoff) throw new Error("The deletion marker was not confirmed by Firestore.");
      setHiddenConversations((old) => ({ ...old, [conv.id]: persistedCutoff }));
      setMessages([]);
      if (selectedConversation === conv.id) navigate("/messages", { replace: true });
      setError("");
    } catch (e) { setError(e.code === "permission-denied" ? "Could not save your deletion preference. Publish the latest Firestore rules." : (e.message || "Your chat copy could not be deleted. Please retry.")); }
    finally { setBusy(false); }
  };
  const conversationIds = new Set(conversations.map((conversation) => conversation.id));
  const filtered = conversations.filter((c) => {
    const cutoff = hiddenConversations[c.id] || null;
    const toMillis = (value) => value?.toMillis?.()
      ?? (value instanceof Date ? value.getTime() : (value ? new Date(value).getTime() : 0));
    const hiddenByCutoff = Boolean(cutoff) && toMillis(c.lastMessageAt) <= toMillis(cutoff);
    const peerId = c.memberUids?.find((x) => x !== user.uid);
    const canonicalId = c.type === "direct" && peerId ? conversationId(user.uid, peerId) : null;
    // Older builds could create a random-ID duplicate after Delete my copy.
    // Prefer the canonical pair conversation when it exists, so recipients see
    // one chat only and all future messages continue in the original thread.
    const duplicateDirectThread = Boolean(canonicalId && conversationIds.has(canonicalId) && c.id !== canonicalId);
    return !hiddenByCutoff && !duplicateDirectThread
      && `${c.name || ""} ${profiles[peerId]?.displayName || ""} ${profiles[peerId]?.username || ""} ${c.lastMessage || ""}`.toLowerCase().includes(queryText.toLowerCase());
  });
  return <div className="dashboard-page-content messages-page"><PageHead eyebrow="REAL-TIME CHAT" title="Messages" description="Private text conversations and small group chats with friends." action={<div className="social-inline-actions"><button className="social-primary-button" onClick={()=>setShowGroupForm((v)=>!v)}>＋ New group chat</button><Link to="/friends" className="social-quiet-button">Find friends ↗</Link></div>} /><Notice error={error}/>{groupInvites.length>0&&<section className="social-surface-card social-group-invites"><h2>Group chat invitations ({groupInvites.length})</h2><p className="social-muted-copy">You join a group only after accepting its invitation.</p>{groupInvites.map((invite)=><article className="social-group-invite-row" key={invite.id}><span><strong>Group conversation</strong><small>Invited by {profiles[invite.senderUid]?.displayName||"a Lumora friend"}</small></span><div className="social-inline-actions"><button className="social-primary-button" disabled={busy} onClick={()=>respondToGroupInvite(invite,true)}>Accept</button><button className="social-quiet-button" disabled={busy} onClick={()=>respondToGroupInvite(invite,false)}>Decline</button></div></article>)}</section>}{showGroupForm&&<section className="social-surface-card"><h2>Create a group chat</h2><form className="social-group-chat-form" onSubmit={createGroupChat}><label className="social-field"><span>Group name</span><input value={groupName} onChange={(e)=>setGroupName(e.target.value)} maxLength={80} placeholder="Project friends"/></label><div className="social-group-friend-picker">{friendChoices.map((friend)=><label key={friend.id}><input type="checkbox" checked={selectedFriends.includes(friend.id)} onChange={(e)=>setSelectedFriends((old)=>e.target.checked?[...old,friend.id]:old.filter((id)=>id!==friend.id))}/><Avatar src={friend.avatarURL} name={friend.displayName||friend.username} size="sm"/><span>{friend.displayName||friend.username||"Friend"}</span></label>)}{friendChoices.length===0&&<p className="social-muted-copy">Add friends first. Only confirmed friends appear here. Invitees must accept before joining. You plus at least 1 friend. Select one or more confirmed friends; each invitee must accept.</p>}</div><button className="social-primary-button" type="submit" disabled={busy}>Create group</button></form></section>}<div className="social-messages-shell"><aside className="social-conversation-list"><label className="social-search"><span>⌕</span><input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder="Search chats"/></label>{filtered.map((conv) => { const id = conv.memberUids?.find((x) => x !== user.uid); const profile = profiles[id] || {}; return <button type="button" key={conv.id} className={`social-conversation-item ${selectedConversation===conv.id?"selected":""} ${conv.lastMessageSenderUid && conv.lastMessageSenderUid !== user.uid && !(conv.lastMessageReadBy || []).includes(user.uid) ? "unread" : ""}`} onClick={() => navigate(`/messages/${conv.id}`)}><Avatar src={profile.avatarURL} name={profile.displayName || profile.username}/><span><strong>{conv.type === "group" ? (conv.name || "Group chat") : (profile.displayName || profile.username || "Friend")}</strong><small>{conv.lastMessage || "Start a conversation"}</small></span>{conv.lastMessageSenderUid && conv.lastMessageSenderUid !== user.uid && !(conv.lastMessageReadBy || []).includes(user.uid) && <b className="social-unread-dot" aria-label="Unread messages"/>}</button>; })}{filtered.length===0 && <p className="social-muted-copy">No chats yet. Accept a friend request first, then start a conversation.</p>}</aside>
      <section className="social-chat-panel">{!selectedConversation ? <div className="social-chat-empty"><span>☏</span><h2>Your conversations</h2><p>Select a friend’s conversation to begin.</p></div> : <><header className="social-chat-header"><Avatar src={active?.type === "direct" ? (peer.avatarURL || peer.photoURL) : ""} name={active?.type === "group" ? (active?.name || "Group conversation") : (peer.displayName || peer.username)}/><span className="social-chat-header-identity">{active?.type === "direct" && peerUid ? <Link className="social-profile-author-link" to={`/people/${peerUid}`}><strong>{peer.displayName || peer.username || "Friend"}</strong></Link> : <strong>{active?.name || "Group conversation"}</strong>}<small className={active?.type === "direct" && (peer.isOnline === true || peer.online === true || peer.presence?.state === "online") ? "social-chat-presence is-online" : "social-chat-presence"}>{active?.type === "group" ? `${active.memberUids?.length || 0} members · group chat` : (peer.isOnline === true || peer.online === true || peer.presence?.state === "online") ? "Active now" : "Private conversation"}</small></span>{active && <div className="social-chat-menu-wrap"><button type="button" className="social-chat-menu-trigger" aria-label="Conversation options" aria-expanded={showChatMenu} onClick={() => setShowChatMenu((v) => !v)}>•••</button>{showChatMenu && <><button type="button" className="social-chat-menu-backdrop" aria-label="Close conversation menu" onClick={() => setShowChatMenu(false)}/><div className="social-chat-menu" role="menu"><button role="menuitem" onClick={() => { setShowChatMenu(false); mute(active); }}>{(active.type === "direct" && mutedAccountIds.includes(peerUid)) || active.mutedBy?.includes(user.uid) ? "Unmute conversation" : "Mute conversation"}</button>{active.type === "direct" && <button role="menuitem" onClick={() => { setShowChatMenu(false); block(active); }}>{blockedAccountIds.includes(peerUid) ? "Unblock person" : "Block person"}</button>}<button role="menuitem" onClick={() => { setShowChatMenu(false); reportConversation(); }}>Report conversation</button><button role="menuitem" className="danger" onClick={() => { setShowChatMenu(false); removeConversationForMe(active); }}>Delete my copy</button></div></>}</div>}</header><div className="social-chat-messages">{messages.map((msg) => <article key={msg.id} className={`social-chat-message ${msg.senderUid===user.uid?"mine":"theirs"}`}><p>{renderMentionText(msg.text)}</p>{msg.imageURL && <img src={msg.imageURL} alt="Message attachment" loading="lazy"/>}<small>{stamp(msg.createdAt)}{msg.readBy?.some((id) => id !== msg.senderUid) ? " · Read" : ""}</small></article>)}</div><form className="social-chat-compose" onSubmit={send}><MentionTextarea value={draft} onChange={setDraft} profiles={(active?.memberUids || []).filter((id) => id !== user.uid).map((id) => ({ id, ...(profiles[id] || {}) }))} maxLength={3000} rows={1} placeholder="Write a message…" ariaLabel="Message text" sendOnEnter/><button type="button" className={`social-attach-toggle ${showImageUrl || imageURL ? "active" : ""}`} aria-label="Add image URL" title="Add image URL" onClick={() => setShowImageUrl((v) => !v)}><svg className="social-attach-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m8.5 12.5 6.8-6.8a4 4 0 0 1 5.7 5.7l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/><path d="m7.1 13.9 8.5-8.5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/></svg></button>{showImageUrl && <input className="social-image-url-input" value={imageURL} onChange={(e) => setImageURL(e.target.value)} placeholder="Paste image URL" aria-label="Image URL" type="url"/>}{imageURL && isSafeImageUrl(imageURL) && <img src={imageURL} alt="Message image preview" loading="lazy"/>}<button className="social-primary-button social-send-button" type="submit" aria-label="Send message" title="Send message" disabled={busy || (!draft.trim() && !imageURL.trim())}>{busy?"…":"➤"}</button></form></>}</section></div></div>;
}

export function CommunitiesPage() {
  const { user } = useAuth(); const [groups, setGroups] = useState([]); const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [search, setSearch] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => onSnapshot(query(collection(db, "communities"), where("status", "==", "active"), orderBy("createdAt", "desc"), limit(100)), (snap) => { setGroups(snap.docs.map((d)=>({id:d.id,...d.data()}))); }, (loadError) => setError(describeFirestoreLoadError("Communities", loadError))), []);
  const createGroup = async (event) => { event.preventDefault(); const cleanTitle=safeText(title,80); const cleanDescription=safeText(description,500); if(!cleanTitle){setError("Add a community name.");return;} try { const ref=await addDoc(collection(db,"communities"),{title:cleanTitle,description:cleanDescription,ownerUid:user.uid,moderatorUids:[user.uid],memberUids:[user.uid],status:"active",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),announcement:"",inviteCode:Math.random().toString(36).slice(2,10)}); setTitle("");setDescription("");setNotice("Community created. You are the owner and first member.");window.location.assign(`/communities/${ref.id}`); } catch {setError("Community could not be created.");} };
  const join = async (group) => { try { await updateDoc(doc(db,"communities",group.id),{memberUids:arrayUnion(user.uid),updatedAt:serverTimestamp()}); setNotice(`Joined ${group.title}.`); } catch { setError("Could not join this community."); } };
  const filtered = groups.filter((g)=>`${g.title} ${g.description}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="dashboard-page-content social-directory-page"><PageHead eyebrow="COMMUNITIES" title="Find your corner" description="Create a space for a topic and grow a community around it."/><Notice error={error}>{notice}</Notice><section className="social-surface-card"><h2>Create a community</h2><form className="social-create-group-form" onSubmit={createGroup}><label className="social-field"><span>Name</span><input value={title} onChange={(e)=>setTitle(e.target.value)} maxLength={80} placeholder="e.g. Design Circle" required/></label><label className="social-field"><span>Description</span><input value={description} onChange={(e)=>setDescription(e.target.value)} maxLength={500} placeholder="What will members discuss?"/></label><button className="social-primary-button">Create community</button></form></section><label className="social-search social-directory-search"><span>⌕</span><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search communities"/></label><div className="social-community-grid">{filtered.map((g)=><article key={g.id} className="social-community-card"><div className="social-community-cover">✧</div><div className="social-community-card-body"><span className="social-status-pill">{g.memberUids?.length||0} members</span><h2>{g.title}</h2><p>{g.description||"A community for shared interests."}</p><div className="social-inline-actions"><Link className="social-primary-button" to={`/communities/${g.id}`}>Open space</Link>{!g.memberUids?.includes(user.uid)&&<button className="social-quiet-button" onClick={()=>join(g)}>Join</button>}</div></div></article>)}</div></div>;
}

function CommunityPostCard({ post, currentUid }) {
  const [reaction, setReaction] = useState("");
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const reactionRef = doc(db, "communityPosts", post.id, "reactions", currentUid);
    const ownUnsub = onSnapshot(reactionRef, (snap) => setReaction(snap.exists() ? snap.data().type || "like" : ""), () => {});
    const allUnsub = onSnapshot(query(collection(db, "communityPosts", post.id, "reactions"), limit(100)), (snap) => setCount(snap.size), () => {});
    return () => { ownUnsub(); allUnsub(); };
  }, [post.id, currentUid]);
  const react = async (type) => {
    const ref = doc(db, "communityPosts", post.id, "reactions", currentUid);
    try { if (!type || type === reaction) await deleteDoc(ref); else await setDoc(ref, { uid: currentUid, type, createdAt: serverTimestamp() }); setError(""); }
    catch { setError("Reaction could not be saved. Check the published Firestore rules."); }
  };
  const edit = async () => {
    const body = await promptDialog("Edit community post", post.body || "", { message: "Update your post text.", placeholder: "Write your post…", multiline: true, required: true, confirmText: "Save changes" });
    if (body === null) return;
    const clean = safeText(body, 3000);
    if (!clean) { setError("A post cannot be empty."); return; }
    const imageURL = await promptDialog("Edit image URL", post.imageURL || "", { message: "Paste an HTTP or HTTPS image URL, or leave it empty to remove the image.", placeholder: "https://example.com/image.jpg", confirmText: "Save image" });
    if (imageURL === null) return;
    if (!isSafeImageUrl(safeText(imageURL, 2000))) { setError("Image URL must be HTTP or HTTPS."); return; }
    try { await updateDoc(doc(db, "communityPosts", post.id), { body: clean, imageURL: safeText(imageURL, 2000) }); setError(""); }
    catch { setError("Could not edit this post. Check Firestore rules."); }
  };
  const remove = async () => { if (!await confirmDialog("Delete community post?", "This action cannot be undone.", { confirmText: "Delete post", danger: true })) return; try { await deleteDoc(doc(db, "communityPosts", post.id)); } catch { setError("Could not delete this post."); } };
  return <article className="social-post-card" key={post.id}><div className="social-post-heading"><Avatar name={post.displayName}/><div className="social-post-author"><Link className="social-profile-author-link" to={`/people/${post.uid}`}><strong>{post.displayName || "Community member"}</strong></Link><small>{stamp(post.createdAt)}</small></div>{post.uid === currentUid && <div className="social-post-menu"><button type="button" onClick={edit}>Edit</button><button type="button" onClick={remove}>Delete</button></div>}</div><p className="social-post-body">{renderMentionText(post.body)}</p>{post.imageURL && isSafeImageUrl(post.imageURL) && <div className="social-post-image-frame"><img src={post.imageURL} alt="Community post" loading="lazy"/></div>}<div className="social-post-stats"><span>{count} reactions</span><span>Community discussion</span></div><div className="social-post-actions"><ReactionControl reaction={reaction} onReact={react}/></div>{error && <p className="social-validation" role="alert">{error}</p>}</article>;
}

export function CommunityDetailPage() {
  const { groupId } = useParams(); const { user } = useAuth(); const [group,setGroup]=useState(null); const [posts,setPosts]=useState([]); const [body,setBody]=useState(""); const [communityImageURL,setCommunityImageURL]=useState(""); const [announcement,setAnnouncement]=useState(""); const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [memberProfiles,setMemberProfiles]=useState({}); const [moderatorCandidate,setModeratorCandidate]=useState(""); const [moderationBusy,setModerationBusy]=useState(false);
  useEffect(()=>onSnapshot(doc(db,"communities",groupId),(snap)=>setGroup(snap.exists()?{id:snap.id,...snap.data()}:null),()=>setError("Community could not be loaded.")),[groupId]);
  useEffect(()=>onSnapshot(query(collection(db,"communityPosts"),where("communityId","==",groupId),orderBy("createdAt","desc"),limit(MAX_ROWS)),(snap)=>{setPosts(snap.docs.map((d)=>({id:d.id,...d.data()})));},(loadError)=>setError(describeFirestoreLoadError("Community posts",loadError))),[groupId]);
  const memberUids = group?.memberUids ?? EMPTY_MEMBER_UIDS;
  useEffect(()=>{let active=true;(async()=>{const ids=memberUids.slice(0,40);const entries=await Promise.all(ids.map(async(uid)=>{try{const snap=await getDoc(doc(db,"publicProfiles",uid));return[uid,snap.exists()?snap.data():{}];}catch{return[uid,{}];}}));if(active)setMemberProfiles(Object.fromEntries(entries));})();return()=>{active=false;};},[group?.id, memberUids]);
  const member=group?.memberUids?.includes(user.uid); const moderator=group?.moderatorUids?.includes(user.uid)||group?.ownerUid===user.uid;
  const join=async()=>{try{await updateDoc(doc(db,"communities",groupId),{memberUids:arrayUnion(user.uid),updatedAt:serverTimestamp()});setNotice("You joined this community.");}catch{setError("Could not join community.");}};
  const post=async(e)=>{e.preventDefault();const text=safeText(body,3000);const image=safeText(communityImageURL,2000);if(!text)return;if(!isSafeImageUrl(image)){setError("Image URL must be HTTP or HTTPS.");return;}try{await addDoc(collection(db,"communityPosts"),{communityId:groupId,uid:user.uid,displayName:nameOf(user),body:text,imageURL:image,createdAt:serverTimestamp(),status:"published"});for (const recipientUid of (group?.memberUids||[]).filter((id)=>id!==user.uid).slice(0,40)) { try { await addDoc(collection(db,"users",recipientUid,"notifications"),{type:"group_activity",title:`New post in ${group.title}`,message:`${nameOf(user)} shared a post in your community.`,link:`/communities/${groupId}`,senderUid:user.uid,communityId:groupId,isRead:false,createdAt:serverTimestamp()}); } catch { /* Best effort, capped to 40 members per post. */ } }await notifyMentions({text,senderUid:user.uid,senderName:nameOf(user),link:`/communities/${groupId}`,contextType:`a post in ${group.title}`,communityId:groupId});setBody("");setCommunityImageURL("");setNotice("Post added to the community.");}catch{setError("Could not create group post.");}};
  const announce=async(e)=>{e.preventDefault();const clean=safeText(announcement,500);if(!clean)return;try{await updateDoc(doc(db,"communities",groupId),{announcement:clean,updatedAt:serverTimestamp()});for(const recipientUid of (group?.memberUids||[]).filter((id)=>id!==user.uid).slice(0,40)){try{await addDoc(collection(db,"users",recipientUid,"notifications"),{type:"group_activity",title:`Announcement in ${group.title}`,message:clean.slice(0,240),link:`/communities/${groupId}`,senderUid:user.uid,communityId:groupId,isRead:false,createdAt:serverTimestamp()});}catch{/* Preferences and per-user rules may suppress this notification. */}}setAnnouncement("");setNotice("Community announcement updated and notifications attempted for up to 40 members.");}catch{setError("Only community moderators can update announcements.");}};
  const manageModerator=async(grant)=>{const uid=moderatorCandidate;if(!uid||(uid===group.ownerUid&&!grant))return;setModerationBusy(true);try{await updateDoc(doc(db,"communities",groupId),{moderatorUids:grant?arrayUnion(uid):arrayRemove(uid),updatedAt:serverTimestamp()});setNotice(`${memberProfiles[uid]?.displayName||memberProfiles[uid]?.username||"Member"} ${grant?"is now a moderator":"is no longer a moderator"}.`);}catch{setError("Moderator permissions could not be changed. Only the community owner can assign moderators, and they must already be members.");}finally{setModerationBusy(false);}};
  const shareInvite=async()=>{const url=`${window.location.origin}/communities/${groupId}?invite=${group?.inviteCode||""}`;try{await navigator.clipboard.writeText(url);setNotice("Invite link copied.");}catch{await copyText(url,"Copy group invite link");}};
  if(!group)return <div className="dashboard-page-content"><PageHead eyebrow="COMMUNITY" title="Community" description="Loading community details…"/><Notice error={error}/></div>;
  return <div className="dashboard-page-content social-directory-page"><PageHead eyebrow="COMMUNITY SPACE" title={group.title} description={group.description||"A place for people with shared interests."} action={<button className="social-quiet-button" onClick={shareInvite}>Invite link ↗</button>}/><Notice error={error}>{notice}</Notice>{group.announcement&&<div className="social-announcement"><strong>📣 Community announcement</strong><p>{group.announcement}</p></div>}{!member&&<section className="social-surface-card"><h2>Join this community</h2><p>Join to publish posts and participate.</p><button className="social-primary-button" onClick={join}>Join community</button></section>}{moderator&&<section className="social-surface-card"><h2>Moderator tools</h2><form className="social-create-group-form" onSubmit={announce}><label className="social-field"><span>Announcement</span><input value={announcement} onChange={(e)=>setAnnouncement(e.target.value)} maxLength={500} placeholder="Share an update with members"/></label><button className="social-primary-button">Publish announcement</button></form><p className="social-muted-copy">Owners and assigned moderators can publish group-wide announcements.</p>{group.ownerUid===user.uid&&<div className="social-moderator-manager"><h3>Member permissions</h3><label className="social-field"><span>Community member</span><select value={moderatorCandidate} onChange={(e)=>setModeratorCandidate(e.target.value)}><option value="">Select a member</option>{(group.memberUids||[]).filter((uid)=>uid!==group.ownerUid).map((uid)=><option key={uid} value={uid}>{memberProfiles[uid]?.displayName||memberProfiles[uid]?.username||uid.slice(0,12)}</option>)}</select></label><div className="social-inline-actions"><button type="button" className="social-primary-button" disabled={moderationBusy||!moderatorCandidate||group.moderatorUids?.includes(moderatorCandidate)} onClick={()=>manageModerator(true)}>Make moderator</button><button type="button" className="social-quiet-button" disabled={moderationBusy||!moderatorCandidate||!group.moderatorUids?.includes(moderatorCandidate)} onClick={()=>manageModerator(false)}>Remove moderator</button></div></div>}</section>}{member&&<section className="social-surface-card"><h2>Share with the group</h2><form className="social-create-group-form social-community-post-form" onSubmit={post}><label className="social-field"><span>Post</span><MentionTextarea rows={3} value={body} onChange={setBody} profiles={Object.entries(memberProfiles).map(([id, profile]) => ({ id, ...profile }))} maxLength={3000} placeholder="Start a discussion… Use @ to mention a member" required ariaLabel="Community post"/></label><label className="social-field"><span>Image URL (optional)</span><input type="url" value={communityImageURL} onChange={(e)=>setCommunityImageURL(e.target.value)} placeholder="https://example.com/image.jpg"/></label><button className="social-primary-button">Publish group post</button></form></section>}<div className="social-group-post-list">{posts.map((p)=><CommunityPostCard key={p.id} post={p} currentUid={user.uid}/>)}{posts.length===0&&<div className="social-empty"><h2>Nothing posted yet</h2><p>Be the first member to start a conversation.</p></div>}</div></div>;
}

export function PersonProfilePage() {
  const { personId } = useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [friendshipState, setFriendshipState] = useState({ direct: null, reciprocal: null });
  const [relationshipChecks, setRelationshipChecks] = useState({ outgoing: false, incoming: false });
  const [outgoingRequest, setOutgoingRequest] = useState(null);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [posts, setPosts] = useState([]);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [profileTab, setProfileTab] = useState("timeline");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => onSnapshot(doc(db, "publicProfiles", personId), (snap) => setProfile(snap.exists() ? { uid: snap.id, ...snap.data() } : null), () => setError("This profile is private or unavailable.")), [personId]);
  useEffect(() => {
    setFriendshipState({ direct: null, reciprocal: null });
    setRelationshipChecks({ outgoing: false, incoming: false });
    const stopFriend = onSnapshot(doc(db, "friendships", `${user.uid}__${personId}`),
      (snap) => setFriendshipState((v) => ({ ...v, direct: snap.exists() })),
      () => setFriendshipState((v) => ({ ...v, direct: false })));
    const stopReciprocalFriend = onSnapshot(doc(db, "friendships", `${personId}__${user.uid}`),
      (snap) => setFriendshipState((v) => ({ ...v, reciprocal: snap.exists() })),
      () => setFriendshipState((v) => ({ ...v, reciprocal: false })));
    const stopOutgoing = onSnapshot(doc(db, "friendRequests", `${user.uid}__${personId}`),
      (snap) => { setOutgoingRequest(snap.exists() ? { id: snap.id, ...snap.data() } : null); setRelationshipChecks((v) => ({ ...v, outgoing: true })); },
      () => { setOutgoingRequest(null); setRelationshipChecks((v) => ({ ...v, outgoing: true })); });
    const stopIncoming = onSnapshot(doc(db, "friendRequests", `${personId}__${user.uid}`),
      (snap) => { setIncomingRequest(snap.exists() ? { id: snap.id, ...snap.data() } : null); setRelationshipChecks((v) => ({ ...v, incoming: true })); },
      () => { setIncomingRequest(null); setRelationshipChecks((v) => ({ ...v, incoming: true })); });
    return () => { stopFriend(); stopReciprocalFriend(); stopOutgoing(); stopIncoming(); };
  }, [user.uid, personId]);
  useEffect(() => onSnapshot(doc(db, "follows", `${user.uid}__${personId}`), (snap) => setIsFollowing(snap.exists()), () => setIsFollowing(false)), [user.uid, personId]);
  useEffect(() => getDoc(doc(db, "users", user.uid, "blockedUsers", personId)).then((snap) => setBlocked(snap.exists())).catch(() => setBlocked(false)), [user.uid, personId]);
  useEffect(() => getDoc(doc(db, "users", user.uid, "mutedUsers", personId)).then((snap) => setMuted(snap.exists())).catch(() => setMuted(false)), [user.uid, personId]);
  useEffect(() => onSnapshot(query(collection(db, "follows"), where("followingUid", "==", personId), limit(500)), (snap) => setFollowers(snap.size), () => {}), [personId]);
  useEffect(() => onSnapshot(query(collection(db, "follows"), where("followerUid", "==", personId), limit(500)), (snap) => setFollowing(snap.size), () => {}), [personId]);
  useEffect(() => onSnapshot(query(collection(db, "posts"), where("uid", "==", personId), where("status", "==", "published"), limit(50)), (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    setPosts(rows);
  }, () => setError("This profile's public posts could not be loaded.")), [personId]);

  const isFriend = friendshipState.direct === true || friendshipState.reciprocal === true;
  const relationshipReady = friendshipState.direct !== null && friendshipState.reciprocal !== null
    && relationshipChecks.outgoing && relationshipChecks.incoming;
  const relationship = personId === user.uid ? "self" : !relationshipReady ? "checking" : isFriend ? "friends"
    : incomingRequest?.status === "pending" ? "incoming"
    : outgoingRequest?.status === "pending" ? "sent" : "none";

  const connect = async () => {
    if (relationship === "friends") { setNotice("You are already friends."); return; }
    if (relationship === "incoming") { setNotice("This member already sent you a request. Accept it below."); return; }
    if (relationship === "sent") { setNotice("Your friend request is already pending."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const requestRef = doc(db, "friendRequests", `${user.uid}__${personId}`);
      const existing = await getDoc(requestRef);
      const requestData = {
        senderUid: user.uid, recipientUid: personId, senderName: nameOf(user), senderUsername: "",
        recipientName: profile?.displayName || profile?.username || "Member", status: "pending", updatedAt: serverTimestamp(),
      };
      if (existing.exists()) {
        if (existing.data().status === "pending") { setNotice("Your request is already pending."); return; }
        if (existing.data().status === "accepted") { setNotice("You are already connected. Refreshing relationship status."); return; }
        await updateDoc(requestRef, requestData);
      } else {
        await setDoc(requestRef, { ...requestData, createdAt: serverTimestamp() });
      }
      setOutgoingRequest({ id: requestRef.id, ...requestData });
      try { await addDoc(collection(db, "users", personId, "notifications"), {
        type: "friend_request", title: "New friend request", message: `${nameOf(user)} wants to connect with you.`,
        link: "/friends", senderUid: user.uid, isRead: false, createdAt: serverTimestamp(),
      }); } catch { /* The request itself succeeds independently from notifications. */ }
      setNotice("Friend request sent.");
    } catch (e) {
      console.error("[Lumora] Profile friend request failed.", { code: e.code, message: e.message });
      setError(e.code === "permission-denied" ? "Firestore denied the request. Confirm the latest Lumora rules are published." : (e.message || "Could not send friend request."));
    } finally { setBusy(false); }
  };
  const acceptIncoming = async () => {
    if (!incomingRequest || incomingRequest.status !== "pending") return;
    setBusy(true); setError(""); setNotice("");
    try {
      await decideFriendRequest(incomingRequest, true);
      try { await addDoc(collection(db, "users", incomingRequest.senderUid, "notifications"), {
        type: "friend_request_accepted", title: "Friend request accepted", message: `${nameOf(user)} accepted your friend request.`,
        link: "/friends", senderUid: user.uid, isRead: false, createdAt: serverTimestamp(),
      }); } catch { /* best effort */ }
      setNotice("Friend request accepted. You are now friends.");
    } catch (e) {
      console.error("[Lumora] Profile friend acceptance failed.", { code: e.code, message: e.message });
      setError(e.code === "permission-denied" ? "Firestore denied acceptance. Confirm the latest rules are published." : (e.message || "Could not accept this request."));
    } finally { setBusy(false); }
  };
  const declineIncoming = async () => {
    if (!incomingRequest || incomingRequest.status !== "pending") return;
    setBusy(true); setError("");
    try { await decideFriendRequest(incomingRequest, false); setNotice("Friend request declined."); }
    catch (e) { setError(e.code === "permission-denied" ? "Firestore denied this action. Confirm the latest rules are published." : "Could not decline this request."); }
    finally { setBusy(false); }
  };
  const toggleFollow = async () => {
    const ref = doc(db, "follows", `${user.uid}__${personId}`);
    try { if (isFollowing) await deleteDoc(ref); else await setDoc(ref, { followerUid: user.uid, followingUid: personId, createdAt: serverTimestamp() }); setIsFollowing(!isFollowing); }
    catch { setError("Could not update your following list."); }
  };
  const doBlock = async () => {
    try { if (blocked) await deleteDoc(doc(db, "users", user.uid, "blockedUsers", personId)); else await setDoc(doc(db, "users", user.uid, "blockedUsers", personId), { uid: personId, createdAt: serverTimestamp() }); setBlocked(!blocked); }
    catch { setError("Could not update block settings."); }
  };
  const doMute = async () => {
    const ref = doc(db, "users", user.uid, "mutedUsers", personId);
    try { if (muted) await deleteDoc(ref); else await setDoc(ref, { uid: personId, createdAt: serverTimestamp() }); setMuted(!muted); setNotice(muted ? "User unmuted." : "User muted. Their posts are hidden from your feed."); }
    catch { setError("Could not update mute settings."); }
  };
  const message = async () => {
    if (!isFriend) { setError("You can message this person after the friend request is accepted."); return; }
    setBusy(true); setError("");
    try { const id = await openDirectConversation(user.uid, personId); window.location.assign(`/messages/${id}`); }
    catch (e) {
      console.error("[Lumora] Could not open profile conversation.", { code: e.code, message: e.message });
      setError(e.code === "permission-denied" ? "Firestore denied starting the chat. Publish the latest rules and confirm both friendship records exist." : (e.message || "Could not start this conversation."));
    } finally { setBusy(false); }
  };
  const report = async () => {
    const reason = await promptDialog("Report profile", "", { message: "Tell the moderation team why this profile should be reviewed.", placeholder: "Reason for reporting…", multiline: true, required: true, confirmText: "Submit report" }); if (reason === null) return;
    try { await addDoc(collection(db, "reports"), { reporterUid: user.uid, reporterEmail: user.email || "", targetType: "user", targetId: personId, reason: safeText(reason, 500), status: "open", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); setNotice("Report submitted for administrator review."); }
    catch { setError("Could not submit this report."); }
  };

  if (!profile) return <div className="dashboard-page-content"><PageHead eyebrow="PROFILE" title="Profile unavailable" description="The member profile could not be shown."/><Notice error={error}/></div>;
  return <div className="dashboard-page-content social-person-profile">
    <Notice error={error}>{notice}</Notice>
    <section className="social-public-profile">
      <div className="social-profile-cover" style={profile.coverURL && isSafeImageUrl(profile.coverURL) ? { backgroundImage: `url("${profile.coverURL}")` } : {}} />
      <div className="social-public-profile-body">
        <Avatar src={profile.avatarURL} name={profile.displayName || profile.username} size="xl" />
        <div className="social-public-profile-meta"><h1>{profile.displayName || profile.username || "Lumora member"}</h1><p>@{profile.username || "member"}</p><p>{profile.bio || "A member of the Lumora community."}</p>
          <div className="social-profile-counts"><Link to={`/people/${personId}/followers`}><strong>{followers}</strong><span>Followers</span></Link><Link to={`/people/${personId}/following`}><strong>{following}</strong><span>Following</span></Link><span><strong>{posts.length}</strong><span>Posts</span></span></div>
        </div>
        {personId !== user.uid && <div className="social-inline-actions social-profile-actions">
          {relationship === "friends" ? <><span className="social-status-pill">✓ Already friends</span><button className="social-primary-button" disabled={busy} onClick={message}>Message ↗</button></>
            : relationship === "incoming" ? <><button className="social-primary-button" disabled={busy} onClick={acceptIncoming}>Accept request</button><button className="social-quiet-button" disabled={busy} onClick={declineIncoming}>Decline</button></>
            : relationship === "sent" ? <button className="social-quiet-button" disabled>Request sent</button>
            : <button className="social-primary-button" disabled={busy || relationship === "checking"} onClick={connect}>＋ Add friend</button>}
          <button className="social-quiet-button" onClick={toggleFollow}>{isFollowing ? "Following ✓" : "＋ Follow"}</button><button className="social-quiet-button" onClick={doMute}>{muted ? "Unmute" : "Mute"}</button><button className="social-quiet-button" onClick={doBlock}>{blocked ? "Unblock" : "Block"}</button><button className="social-quiet-button" onClick={report}>Report</button>
        </div>}
      </div>
    </section>
    <nav className="social-profile-tabs" aria-label="Profile sections">
      <button type="button" className={profileTab === "timeline" ? "active" : ""} onClick={() => setProfileTab("timeline")}>Timeline</button>
      <button type="button" className={profileTab === "about" ? "active" : ""} onClick={() => setProfileTab("about")}>About</button>
    </nav>
    {profileTab === "about" ? <section className="social-surface-card social-profile-about"><h2>About {profile.displayName || profile.username || "this member"}</h2>
      <div className="social-about-row"><span>Display name</span><strong>{profile.displayName || "Not provided"}</strong></div>
      <div className="social-about-row"><span>Username</span><strong>@{profile.username || "member"}</strong></div>
      <div className="social-about-row"><span>Bio</span><strong>{profile.bio || "This member has not added a bio yet."}</strong></div>
      <div className="social-about-row"><span>Member since</span><strong>{profile.createdAt?.toDate ? profile.createdAt.toDate().toLocaleDateString() : "Lumora member"}</strong></div>
      <div className="social-about-row"><span>Profile visibility</span><strong>{profile.privacy === "private" ? "Private" : "Public"}</strong></div>
    </section> : <section className="social-profile-posts"><div className="social-surface-card"><h2>{personId === user.uid ? "Your timeline" : `${profile.displayName || profile.username || "Member"}'s timeline`}</h2>
      {posts.length === 0 ? <div className="social-empty"><h2>No public posts yet</h2><p>{personId === user.uid ? "Your published posts will appear here." : "This member has not shared a public post yet."}</p></div> : posts.map((post) => <article key={post.id} className="social-post-card"><div className="social-post-heading"><Avatar src={post.avatarURL || profile.avatarURL} name={post.displayName || profile.displayName}/><div className="social-post-author"><Link className="social-profile-author-link" to={`/people/${post.uid}`}><strong>{post.displayName || profile.displayName}</strong></Link><small>{stamp(post.createdAt)}{post.pinned ? " · Featured" : ""}</small></div>{post.pinned && <span className="social-pin-badge">Pinned</span>}</div><p className="social-post-body">{renderMentionText(post.body)}</p>{post.imageURL && <div className="social-post-image-frame"><img src={post.imageURL} alt="Post attachment" loading="lazy"/></div>}<div className="social-post-actions"><Link to={`/post/${post.id}`}>Comments & discussion ↗</Link></div></article>)}
    </div></section>}
  </div>;
}

export function PostDetailPage() {
  const { postId } = useParams(); const { user } = useAuth(); const [post,setPost]=useState(null); const [comments,setComments]=useState([]); const [draft,setDraft]=useState(""); const [replyTo,setReplyTo]=useState(null); const [error,setError]=useState("");
  useEffect(()=>onSnapshot(doc(db,"posts",postId),(snap)=>setPost(snap.exists()?{id:snap.id,...snap.data()}:null),()=>setError("Post could not be loaded.")),[postId]);
  useEffect(() => onSnapshot(
    query(collection(db, "postComments"), where("postId", "==", postId), where("status", "==", "approved"), orderBy("createdAt", "asc"), limit(100)),
    (snap) => { setComments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setError(""); },
    (loadError) => setError(describeFirestoreLoadError("Post comments", loadError))
  ), [postId]);
  const addComment=async(e)=>{e.preventDefault();const text=safeText(draft,2000);if(!text)return;try{const commentRef=await addDoc(collection(db,"postComments"),{postId,uid:user.uid,displayName:nameOf(user),body:text,parentId:replyTo?.id||null,status:"approved",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});if(replyTo?.uid&&replyTo.uid!==user.uid){try{await addDoc(collection(db,"users",replyTo.uid,"notifications"),{type:"post_reply",title:"New reply to your comment",message:`${nameOf(user)} replied to your comment on a post.`,link:`/post/${postId}`,senderUid:user.uid,postId,commentId:commentRef.id,isRead:false,createdAt:serverTimestamp()});}catch{}}setDraft("");setReplyTo(null);setError("");}catch{setError("Comment could not be saved. Please check Firestore rules.");}};
  const editComment=async(comment)=>{const next=await promptDialog("Edit comment",comment.body||"",{message:"Update your comment.",placeholder:"Write a comment…",multiline:true,required:true,confirmText:"Save changes"});if(next===null)return;const body=safeText(next,2000);if(!body){setError("A comment cannot be empty.");return;}try{await updateDoc(doc(db,"postComments",comment.id),{body,updatedAt:serverTimestamp()});setError("");}catch{setError("Comment could not be edited. Publish the updated Firestore rules.");}};
  const deleteComment=async(comment)=>{if(!await confirmDialog("Delete comment?","This comment will be permanently deleted.",{confirmText:"Delete comment",danger:true}))return;try{await deleteDoc(doc(db,"postComments",comment.id));setError("");}catch{setError("Comment could not be deleted. Check Firestore rules.");}};
  return <div className="dashboard-page-content social-directory-page"><PageHead eyebrow="POST DISCUSSION" title="Comments" description="Join the discussion and be kind to each other." action={<Link to="/feed" className="social-quiet-button">← Back to feed</Link>}/><Notice error={error}/>{post&&<article className="social-post-card"><div className="social-post-heading"><Avatar src={post.avatarURL} name={post.displayName}/><div className="social-post-author"><Link className="social-profile-author-link" to={`/people/${post.uid}`}><strong>{post.displayName || "Lumora member"}</strong></Link><small>{stamp(post.createdAt)}</small></div></div><p className="social-post-body">{post.body}</p>{post.imageURL&&<div className="social-post-image-frame"><img src={post.imageURL} alt="Post attachment"/></div>}</article>}<section className="social-surface-card"><h2>Leave a comment</h2>{replyTo&&<div className="social-replying-to"><span>Replying to <strong>{replyTo.displayName || "Lumora member"}</strong></span><button className="social-comment-cancel-button" type="button" onClick={()=>{setReplyTo(null);setDraft("");}}>Cancel reply</button></div>}<form className="social-create-group-form social-comment-form" onSubmit={addComment}><textarea rows="3" value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder={replyTo?`Reply to ${replyTo.displayName}…`:"Write a comment…"} maxLength={2000} required/><button className="social-primary-button">{replyTo?"Post reply":"Comment"}</button></form>{comments.filter((c)=>!c.parentId).map((c)=><article className="social-post-comment" key={c.id}><Avatar name={c.displayName}/><div><Link className="social-profile-author-link" to={`/people/${c.uid}`}><strong>{c.displayName || "Lumora member"}</strong></Link><p>{c.body}</p><small>{stamp(c.createdAt)}</small><button type="button" className="social-comment-text-action" onClick={()=>{setReplyTo(c);setDraft("");}}>Reply</button>{c.uid===user.uid&&<span className="social-comment-owner-actions"><button className="social-comment-text-action" type="button" onClick={()=>editComment(c)}>Edit</button><button className="social-comment-text-action social-comment-delete-text-action" type="button" onClick={()=>deleteComment(c)}>Delete</button></span>}{comments.filter((r)=>r.parentId===c.id).map((reply)=><div className="social-post-comment social-comment-nested" key={reply.id}><Avatar name={reply.displayName}/><div><Link className="social-profile-author-link" to={`/people/${reply.uid}`}><strong>{reply.displayName || "Lumora member"}</strong></Link><p>{reply.body}</p><small>{stamp(reply.createdAt)}</small>{reply.uid===user.uid&&<span className="social-comment-owner-actions"><button className="social-comment-text-action" type="button" onClick={()=>editComment(reply)}>Edit</button><button className="social-comment-text-action social-comment-delete-text-action" type="button" onClick={()=>deleteComment(reply)}>Delete</button></span>}</div></div>)}</div></article>)}</section></div>;
}

export function SavedPostsPage() {
  const { user } = useAuth(); const [posts, setPosts] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => onSnapshot(query(collection(db, "users", user.uid, "savedPosts"), limit(MAX_ROWS)), async (snap) => {
    const rows = await Promise.all(snap.docs.map(async (entry) => { try { const postSnap = await getDoc(doc(db, "posts", entry.id)); return postSnap.exists() && postSnap.data().status === "published" ? { id: postSnap.id, ...postSnap.data(), savedAt: entry.data().savedAt } : null; } catch { return null; } }));
    setPosts(rows.filter(Boolean).sort((a,b)=>(b.savedAt?.toMillis?.()||0)-(a.savedAt?.toMillis?.()||0))); setLoading(false);
  }, () => { setError("Saved posts could not be loaded. Verify the Firestore rules."); setLoading(false); }), [user.uid]);
  const remove = async (post) => { try { await deleteDoc(doc(db,"users",user.uid,"savedPosts",post.id)); setPosts((old)=>old.filter((p)=>p.id!==post.id)); } catch { setError("Could not remove this saved post."); } };
  return <div className="dashboard-page-content social-directory-page"><PageHead eyebrow="YOUR LIBRARY" title="Saved posts" description="A private collection of the member posts you want to revisit." action={<Link to="/feed" className="social-quiet-button">Back to feed ↗</Link>}/><Notice error={error}/>{loading?<div className="social-empty">Loading your saved posts…</div>:posts.length===0?<div className="social-empty"><h2>Your library is empty</h2><p>Use Save on a post in your feed to keep it here. Only you can read this library.</p><Link to="/feed" className="social-primary-button">Explore the feed</Link></div>:<div className="social-group-post-list">{posts.map((post)=><article className="social-post-card" key={post.id}><div className="social-post-heading"><Avatar src={post.avatarURL} name={post.displayName}/><div className="social-post-author"><Link className="social-profile-author-link" to={`/people/${post.uid}`}><strong>{post.displayName||"Lumora member"}</strong></Link><small>Saved {stamp(post.savedAt)}</small></div></div><p className="social-post-body">{post.body}</p>{post.imageURL&&<div className="social-post-image-frame"><img src={post.imageURL} alt="Saved post attachment" loading="lazy"/></div>}<div className="social-post-actions"><Link to={`/post/${post.id}`}>Open comments ↗</Link><button onClick={()=>remove(post)}>Remove from saved</button></div></article>)}</div>}</div>;
}

export function FollowListPage() {
  const { personId } = useParams(); const { pathname } = useLocation();
  const [rows,setRows]=useState([]); const [error,setError]=useState(""); const isFollowingList=pathname.endsWith("/following");
  useEffect(()=>onSnapshot(query(collection(db,"follows"),where(isFollowingList?"followerUid":"followingUid","==",personId),limit(100)),async(snap)=>{
    const ids=snap.docs.map((d)=>d.data()[isFollowingList?"followingUid":"followerUid"]); const profiles=await Promise.all(ids.map(async(uid)=>{try{const p=await getDoc(doc(db,"publicProfiles",uid));return{id:uid,...(p.exists()?p.data():{})};}catch{return{id:uid,displayName:"Private profile",privacy:"private"};}})); setRows(profiles);
  },()=>setError("This list could not be loaded.")),[personId,isFollowingList]);
  return <div className="dashboard-page-content social-directory-page"><PageHead eyebrow="CONNECTIONS" title={isFollowingList?"Following":"Followers"} description="People connected through Lumora." action={<Link className="social-quiet-button" to={`/people/${personId}`}>← Back to profile</Link>}/><Notice error={error}/>{rows.length===0?<div className="social-empty"><h2>No connections to show</h2><p>This list is empty or the profiles are private.</p></div>:<div className="social-member-grid">{rows.map((p)=><article className="social-person-card" key={p.id}><ProfileLink profile={p} uid={p.id}/><Link className="social-quiet-button" to={`/people/${p.id}`}>View profile</Link></article>)}</div>}</div>;
}
