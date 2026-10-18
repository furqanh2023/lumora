import React, { useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true); setMessage(""); setError("");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage("If an account exists for this email, a password reset link has been sent.");
    } catch (resetError) {
      const safeMessage = resetError.code === "auth/invalid-email"
        ? "Enter a valid email address."
        : resetError.code === "auth/too-many-requests"
          ? "Too many attempts. Please try again later."
          : "Could not send the reset email. Please check the address and try again.";
      setError(safeMessage);
    } finally { setLoading(false); }
  };

  return (
    <main className="auth-extra-page">
      <Link to="/" className="auth-extra-brand"><span>✧</span><b>Lumora</b></Link>
      <section className="auth-extra-card">
        <span className="auth-extra-symbol">↻</span>
        <p className="auth-extra-eyebrow">ACCOUNT RECOVERY</p>
        <h1>Reset your password</h1>
        <p className="auth-extra-description">Enter the email linked to your account and we’ll send reset instructions.</p>
        <form onSubmit={handleSubmit} className="auth-extra-form">
          <label htmlFor="reset-email">Email address</label>
          <input id="reset-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required />
          {message && <p className="auth-extra-success" role="status">{message}</p>}
          {error && <p className="auth-extra-error" role="alert">{error}</p>}
          <button type="submit" disabled={loading}>{loading ? "Sending…" : "Send reset link"}</button>
        </form>
        <p className="auth-extra-bottom"><Link to="/login">← Back to sign in</Link></p>
      </section>
    </main>
  );
}

export function TermsPage() {
  return (
    <main className="terms-page">
      <header><Link to="/" className="auth-extra-brand"><span>✧</span><b>Lumora</b></Link><Link to="/signup">Create account ↗</Link></header>
      <article className="terms-card">
        <p className="auth-extra-eyebrow">LUMORA · ACCOUNT TERMS</p>
        <h1>Terms and Conditions</h1>
        <p className="terms-updated">Project draft · Last updated October 11, 2026</p>
        <h2>Using Lumora</h2>
        <p>Lumora is a developing web application for account management and a personal digital workspace. By using the app, you agree to provide accurate account details and use the service lawfully.</p>
        <h2>Account security</h2>
        <p>You are responsible for keeping your login credentials safe and for activity performed through your account. Contact the project owner if you believe your account has been accessed without permission.</p>
        <h2>Data and privacy</h2>
        <p>Account authentication is provided by Firebase Authentication. Profile details may be stored in Cloud Firestore. This development draft is not a substitute for a full privacy notice or legal review before public launch.</p>
        <h2>Availability</h2>
        <p>Features may change while Lumora is being developed. Some planned workspace, community and administrative features may not be available yet.</p>
        <h2>Contact</h2>
        <p>For questions about this project, contact the site administrator through the channel provided by the project owner.</p>
        <Link className="terms-back-link" to="/">← Back to Lumora</Link>
      </article>
    </main>
  );
}
