import React, { useState } from "react";
import { notify } from "../../ui/feedback";
import { Link, useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../../firebase";
import { saveUserProfile } from "../userProfile";
import { isAdminAccount } from "../../adminAccess";
import "./Login.css";

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setLoading(true);
    try {
      const result = await signInWithEmailAndPassword(auth, form.email.value.trim(), form.password.value);
      await saveUserProfile(result.user);
      notify("Welcome back! You are now signed in.", "success");
      navigate(isAdminAccount(result.user) ? "/admin" : "/feed", { replace: true });
    } catch (error) {
      const messages = {
        "auth/invalid-credential": "Incorrect email or password.",
        "auth/user-not-found": "No account found with this email.",
        "auth/wrong-password": "Incorrect password.",
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/too-many-requests": "Too many attempts. Please try again later.",
        "auth/network-request-failed": "Network error. Check your internet connection and try again.",
        "auth/operation-not-allowed": "Email/password sign-in is not enabled in the Firebase project. Open Firebase Console → Authentication → Sign-in method.",
        "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Firebase rejected this API key. Check src/firebase.js against Project settings → Your apps in the Nexora123 project.",
        "auth/invalid-api-key": "Firebase rejected this API key. Copy the Web API key from the correct Firebase project.",
        "auth/requests-from-referer-are-blocked": "This website origin is blocked by the API key restrictions. Allow localhost in Google Cloud Console API key restrictions.",
        "auth/configuration-not-found": "Firebase Authentication configuration was not found for this project. Check the selected Firebase project and Authentication setup.",
        "permission-denied": "Authentication succeeded, but Firestore denied profile access. Check the deployed Lumora security rules.",
      };
      notify(messages[error.code] || `Login failed (${error.code || "unknown error"}). ${error.message || "Check the browser Console/Network response for details."}`, "error");
    } finally { setLoading(false); }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      await saveUserProfile(result.user);
      notify("Google sign-in successful. Welcome to Lumora!", "success");
      navigate(isAdminAccount(result.user) ? "/admin" : "/feed", { replace: true });
    } catch (error) {
      if (error.code !== "auth/popup-closed-by-user") {
        notify(error.code === "auth/unauthorized-domain"
          ? "Authorize this domain in Firebase Authentication settings."
          : error.code === "permission-denied"
            ? "Firestore denied profile access. Check the latest Lumora security rules."
            : "Google login failed. Please try again.", "error");
      }
    } finally { setLoading(false); }
  };

  return (
    <main className="login-page">
      <section className="login-visual">
        <Link to="/" className="login-brand"><span className="login-brand-symbol">✧</span><span><strong>Lumora</strong><small>PEOPLE · IDEAS · STORIES · TOGETHER</small></span></Link>
        <div className="login-visual-caption"><h2>Welcome to your<br /><span>community.</span></h2><p>Great thoughts happen in great communities.</p></div>
      </section>
      <section className="login-panel">
        <Link to="/" className="login-home-link"><span>←</span> Home</Link>
        <div className="login-content">
          <header className="login-heading"><h1>Welcome back</h1><p>Sign in to continue your Lumora journey.</p></header>
          <form className="login-form" onSubmit={handleSubmit}>
            <div className="login-field"><label htmlFor="login-email">Email address</label><div className="login-input-wrap"><span className="login-input-icon">✉</span><input type="email" id="login-email" name="email" placeholder="yourname@gmail.com" autoComplete="email" required /></div></div>
            <div className="login-field"><label htmlFor="login-password">Password</label><div className="login-input-wrap"><span className="login-input-icon">♙</span><input type={showPassword ? "text" : "password"} id="login-password" name="password" placeholder="Enter your password" autoComplete="current-password" required /><button type="button" className="login-show-password" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></div><div className="login-forgot-row"><Link to="/forgot-password">Forgot password?</Link></div></div>
            <button type="submit" className="login-submit" disabled={loading}>{loading ? "Signing in…" : "Login"}</button>
          </form>
          <div className="login-divider"><span>Or continue with</span></div>
          <button type="button" className="login-google-button" onClick={handleGoogleLogin} disabled={loading}>
            <svg viewBox="0 0 48 48" className="login-google-icon" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44z"/><path fill="#FBBC05" d="M12.6 27.7a12 12 0 0 1 0-7.4V15H5.8a20 20 0 0 0 0 17.9l6.8-5.2z"/><path fill="#EA4335" d="M24 12.1c3 0 5.7 1 7.8 3.1l5.8-5.8A19.5 19.5 0 0 0 24 4 20 20 0 0 0 5.8 15l6.8 5.3c1.6-4.8 6.1-8.2 11.4-8.2z"/></svg>
            {loading ? "Please wait…" : "Google"}
          </button>
          <p className="login-register-text">Don't have an account?<Link to="/signup"> Sign up</Link></p>
          <p className="login-terms">By signing in, you agree to our <Link to="/terms">Terms and Conditions</Link></p>
        </div>
      </section>
    </main>
  );
}
