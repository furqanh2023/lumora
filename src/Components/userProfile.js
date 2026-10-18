import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";

const cleanUsernamePart = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9_.]/g, "")
  .replace(/^[._]+|[._]+$/g, "");

/** Create a basic public profile for every account without overwriting a customized profile. */
async function ensurePublicProfile(user) {
  const profileRef = doc(db, "publicProfiles", user.uid);
  const currentProfile = await getDoc(profileRef);
  if (currentProfile.exists()) return currentProfile.data();

  const localPart = cleanUsernamePart(user.email?.split("@")[0]) || "member";
  const uidPart = cleanUsernamePart(user.uid) || "member";
  const candidates = [...new Set([
    `${localPart.slice(0, 11)}_${uidPart.slice(-8)}`,
    `${localPart.slice(0, 9)}_${uidPart.slice(-10)}`,
    uidPart.slice(-20),
  ].map((value) => value.slice(0, 20)).filter((value) => /^[a-z0-9_.]{3,20}$/.test(value)))];

  let username = "";
  let usernameRef = null;
  let existingReservation = false;
  for (const candidate of candidates) {
    const candidateRef = doc(db, "usernames", candidate);
    const reservation = await getDoc(candidateRef);
    if (!reservation.exists()) {
      username = candidate;
      usernameRef = candidateRef;
      existingReservation = false;
      break;
    }
    if (reservation.data()?.uid === user.uid && reservation.data()?.username === candidate) {
      username = candidate;
      usernameRef = candidateRef;
      existingReservation = true;
      break;
    }
  }
  if (!username || !usernameRef) {
    throw new Error("Could not reserve an available username for your public profile. Open Profile settings and choose a username.");
  }

  const cleanDisplayName = String(user.displayName || localPart || "Lumora member").trim().slice(0, 80) || "Lumora member";
  const batch = writeBatch(db);
  if (!existingReservation) {
    batch.set(usernameRef, { uid: user.uid, username, createdAt: serverTimestamp() });
  }
  batch.set(profileRef, {
    uid: user.uid,
    displayName: cleanDisplayName,
    username,
    bio: "",
    avatarURL: user.photoURL || "",
    coverURL: "",
    privacy: "public",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return { uid: user.uid, displayName: cleanDisplayName, username, bio: "", avatarURL: user.photoURL || "", coverURL: "", privacy: "public" };
}

/** Create/refresh the private account document and ensure every account has a public profile. */
export async function saveUserProfile(user) {
  if (!user?.uid) {
    throw new Error("A signed-in user is required to save a profile.");
  }

  const profileRef = doc(db, "users", user.uid);
  const existingSnapshot = await getDoc(profileRef);
  const existingProfile = existingSnapshot.exists() ? existingSnapshot.data() : null;

  // Suspended accounts can reach the app's access-gate without refreshing profile data.
  if (existingProfile?.suspended === true) return existingProfile;

  const providerIds = (user.providerData || []).map((item) => item.providerId);
  const provider = existingProfile?.provider || (providerIds.includes("google.com") ? "google.com" : "password");
  const profile = {
    uid: user.uid,
    displayName: String(user.displayName || user.email?.split("@")[0] || "Lumora member").trim().slice(0, 80),
    email: user.email || "",
    photoURL: user.photoURL || null,
    provider,
    updatedAt: serverTimestamp(),
  };
  if (!existingProfile) profile.createdAt = serverTimestamp();
  await setDoc(profileRef, profile, { merge: true });

  // Best-effort bootstrap keeps login available if an older deployed ruleset is still active.
  // Once current rules are published, the generated username and public profile are written atomically.
  try {
    await ensurePublicProfile(user);
  } catch (error) {
    console.warn("[Lumora] Basic public profile could not be initialized.", {
      code: error?.code,
      message: error?.message,
    });
  }
  return profile;
}
