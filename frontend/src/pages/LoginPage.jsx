// src/pages/LoginPage.jsx
// Combined login / sign-up page.
// - Toggles between "Sign in" and "Create account" modes.
// - On successful login, redirects to the originally requested page (or /market).
// - On successful sign-up, Supabase sends a confirmation email (if email confirm
//   is enabled in the dashboard); otherwise the user is logged in immediately.

import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from?.pathname || "/market";

  const [mode, setMode]         = useState("login"); // "login" | "signup"
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [message, setMessage]   = useState("");
  const [busy, setBusy]         = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);

    try {
      if (mode === "login") {
        await signIn(email, password);
        navigate(from, { replace: true });
      } else {
        const { user } = await signUp(email, password);
        if (user) {
          // Email confirm is OFF — user is logged in immediately
          navigate(from, { replace: true });
        } else {
          // Email confirm is ON — prompt user to check inbox
          setMessage("Account created! Check your email to confirm your address, then sign in.");
          setMode("login");
        }
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg, #0f1117)",
      }}
    >
      <div
        style={{
          background: "var(--surface, #1a1d27)",
          border: "1px solid var(--border, #2a2d3a)",
          borderRadius: "10px",
          padding: "2rem 2.5rem",
          width: "100%",
          maxWidth: "380px",
        }}
      >
        {/* Logo / title */}
        <h1
          style={{
            fontSize: "1.6rem",
            fontWeight: 700,
            marginBottom: "0.25rem",
            color: "var(--text, #f0f0f0)",
            letterSpacing: "-0.5px",
          }}
        >
          Folio
        </h1>
        <p style={{ color: "#888", fontSize: "0.85rem", marginBottom: "1.75rem" }}>
          College basketball fantasy market
        </p>

        {/* Mode toggle */}
        <div
          style={{
            display: "flex",
            background: "var(--bg, #0f1117)",
            borderRadius: "6px",
            padding: "3px",
            marginBottom: "1.5rem",
            gap: "3px",
          }}
        >
          {["login", "signup"].map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); setMessage(""); }}
              style={{
                flex: 1,
                padding: "0.45rem",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: mode === m ? 600 : 400,
                background: mode === m ? "var(--surface, #1a1d27)" : "transparent",
                color: mode === m ? "var(--text, #f0f0f0)" : "#888",
                transition: "all 0.15s",
              }}
            >
              {m === "login" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        {/* Confirmation message (after sign-up with email confirm ON) */}
        {message && (
          <p
            style={{
              background: "#1a2e1a",
              border: "1px solid #2a4a2a",
              color: "#6fcf6f",
              borderRadius: "6px",
              padding: "0.65rem 0.85rem",
              fontSize: "0.85rem",
              marginBottom: "1rem",
            }}
          >
            {message}
          </p>
        )}

        {/* Error message */}
        {error && (
          <p
            style={{
              background: "#2e1a1a",
              border: "1px solid #4a2a2a",
              color: "#cf6f6f",
              borderRadius: "6px",
              padding: "0.65rem 0.85rem",
              fontSize: "0.85rem",
              marginBottom: "1rem",
            }}
          >
            {error}
          </p>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <div>
            <label
              htmlFor="email"
              style={{ display: "block", fontSize: "0.8rem", color: "#aaa", marginBottom: "0.3rem" }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              style={{
                width: "100%",
                padding: "0.55rem 0.75rem",
                borderRadius: "6px",
                border: "1px solid var(--border, #2a2d3a)",
                background: "var(--bg, #0f1117)",
                color: "var(--text, #f0f0f0)",
                fontSize: "0.9rem",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              style={{ display: "block", fontSize: "0.8rem", color: "#aaa", marginBottom: "0.3rem" }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder={mode === "signup" ? "At least 6 characters" : ""}
              style={{
                width: "100%",
                padding: "0.55rem 0.75rem",
                borderRadius: "6px",
                border: "1px solid var(--border, #2a2d3a)",
                background: "var(--bg, #0f1117)",
                color: "var(--text, #f0f0f0)",
                fontSize: "0.9rem",
                boxSizing: "border-box",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            style={{
              marginTop: "0.25rem",
              padding: "0.65rem",
              borderRadius: "6px",
              border: "none",
              background: busy ? "#555" : "#4a7cf7",
              color: "#fff",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
