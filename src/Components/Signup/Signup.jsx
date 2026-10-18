import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../../firebase";
import { saveUserProfile } from "../userProfile";
import { isAdminAccount } from "../../adminAccess";
import "./Signup.css";

export default function Signup() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fullName = form.fullName.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;
    if (password !== confirmPassword) { return; }
    if (fullName.length > 80) { return; }
    setLoading(true);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(result.user, { displayName: fullName });
      await saveUserProfile(result.user);
      navigate(isAdminAccount(result.user) ? "/admin" : "/feed", { replace: true });
    } catch (error) {
      console.error("Signup failed:", error.code, error.message);
    } finally { setLoading(false); }
  };

  const handleGoogleSignup = async () => {
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      await saveUserProfile(result.user);
      navigate(isAdminAccount(result.user) ? "/admin" : "/feed", { replace: true });
    } catch (error) {
      if (error.code !== "auth/popup-closed-by-user") {
        console.error("Google signup failed:", error.code, error.message);
      }
    } finally { setLoading(false); }
  };

  return (
    <main className="signup-page">
      <section className="signup-visual">
        <Link to="/" className="signup-brand"><span className="signup-brand-symbol">✧</span><span><strong>Lumora</strong><small>PEOPLE · IDEAS · STORIES · TOGETHER</small></span></Link>
        <div className="signup-visual-caption"><h2>Meet new people.<br /><span>Find new ideas.</span></h2><p>A better conversation can start anywhere.</p></div>
      </section>
      <section className="signup-panel">
        <Link to="/" className="signup-home-link"><span>←</span> Home</Link>
        <div className="signup-content">
          <header className="signup-heading"><h1>Create your account</h1><p>Join Lumora and be part of our community.</p></header>
          <form className="signup-form" onSubmit={handleSubmit}>
            <div className="signup-field"><label htmlFor="signup-name">Full name</label><div className="signup-input-wrap"><span className="signup-input-icon">♙</span><input type="text" id="signup-name" name="fullName" placeholder="Your full name" autoComplete="name" maxLength={80} required /></div></div>
            <div className="signup-field"><label htmlFor="signup-email">Email address</label><div className="signup-input-wrap"><span className="signup-input-icon">✉</span><input type="email" id="signup-email" name="email" placeholder="yourname@gmail.com" autoComplete="email" required /></div></div>
            <div className="signup-field"><label htmlFor="signup-password">Password</label><div className="signup-input-wrap"><span className="signup-input-icon">♙</span><input type={showPassword ? "text" : "password"} id="signup-password" name="password" placeholder="Create a password" autoComplete="new-password" minLength={8} required /><button type="button" className="signup-show-password" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></div></div>
            <div className="signup-field"><label htmlFor="signup-confirm-password">Confirm password</label><div className="signup-input-wrap"><span className="signup-input-icon">♙</span><input type={showConfirmPassword ? "text" : "password"} id="signup-confirm-password" name="confirmPassword" placeholder="Re-enter your password" autoComplete="new-password" minLength={8} required /><button type="button" className="signup-show-password" onClick={() => setShowConfirmPassword((value) => !value)}>{showConfirmPassword ? "Hide" : "Show"}</button></div></div>
            <label className="signup-terms-checkbox"><input type="checkbox" name="terms" required /><span>I agree to the <Link to="/terms">Terms and Conditions</Link></span></label>
            <button type="submit" className="signup-submit" disabled={loading}>{loading ? "Creating account…" : "Create Account"}</button>
          </form>
          <div className="signup-divider"><span>Or continue with</span></div>
          <button type="button" className="signup-google-button" onClick={handleGoogleSignup} disabled={loading}>
            <svg viewBox="0 0 48 48" className="signup-google-icon" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44z"/><path fill="#FBBC05" d="M12.6 27.7a12 12 0 0 1 0-7.4V15H5.8a20 20 0 0 0 0 17.9l6.8-5.2z"/><path fill="#EA4335" d="M24 12.1c3 0 5.7 1 7.8 3.1l5.8-5.8A19.5 19.5 0 0 0 24 4 20 20 0 0 0 5.8 15l6.8 5.3c1.6-4.8 6.1-8.2 11.4-8.2z"/></svg>
            {loading ? "Please wait…" : "Google"}
          </button>
          <p className="signup-login-text">Already have an account?<Link to="/login"> Sign in</Link></p>
          <p className="signup-terms-note">By registering, you agree to our <Link to="/terms">Terms and Conditions</Link></p>
        </div>
      </section>
    </main>
  );
}
