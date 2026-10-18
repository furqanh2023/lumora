import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";

// Lumora frontend using the existing Nexora123 Firebase backend project.
// This client configuration is not a substitute for Firestore Security Rules.
const firebaseConfig = {
  apiKey: "AIzaSyArKI-5SpL-xvOtmxSLeTdvtuWocME5rjU",
  authDomain: "nexora123-324b0.firebaseapp.com",
  projectId: "nexora123-324b0",
  databaseURL: "https://nexora123-324b0-default-rtdb.firebaseio.com",
  storageBucket: "nexora123-324b0.firebasestorage.app",
  messagingSenderId: "640583425457",
  appId: "1:640583425457:web:27f9ce56b9413dd80cb190",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
// Use one canonical Realtime Database instance throughout the app.
export const rtdb = getDatabase(app);
export default app;
