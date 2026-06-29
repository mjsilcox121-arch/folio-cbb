// src/pages/JoinPage.jsx
// Handles invite link acceptance at /join/:token
//
// Flow:
//   1. User arrives at /join/<uuid>
//   2. If not logged in → redirect to /login?next=/join/<uuid>
//   3. Look up the market by invite_token
//   4. If found and user is not already a member → call joinMarket()
//   5. Redirect to /market

import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useMarket } from "../context/MarketContext";
import { getMarketByInviteToken, joinMarket, isMarketMember } from "../lib/supabase";

export default function JoinPage() {
  const { token } = useParams();
  const navigate   = useNavigate();
  const location   = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { refresh } = useMarket();

  const [status, setStatus] = useState("loading"); // loading | joining | already | error | done
  const [message, setMessage] = useState("");
  const [marketName, setMarketName] = useState("");

  useEffect(() => {
    if (authLoading) return;

    // Redirect to login if not authenticated, preserving the return URL
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
      return;
    }

    async function handleJoin() {
      try {
        setStatus("loading");

        // Look up the market
        const market = await getMarketByInviteToken(token);
        setMarketName(market.name);

        // Check if already a member
        const already = await isMarketMember(market.id);
        if (already) {
          setStatus("already");
          setTimeout(() => navigate("/market", { replace: true }), 2000);
          return;
        }

        setStatus("joining");
        await joinMarket(market.id);
        await refresh(); // update MarketContext
        setStatus("done");
        setTimeout(() => navigate("/market", { replace: true }), 1500);
      } catch (err) {
        console.error("[JoinPage]", err.message);
        setMessage(err.message);
        setStatus("error");
      }
    }

    handleJoin();
  }, [token, user, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const containerStyle = {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", minHeight: "60vh", gap: 12,
    fontFamily: "Arial, sans-serif", color: "#0d1b2a",
  };

  if (authLoading || status === "loading") {
    return (
      <div className="container">
        <div style={containerStyle}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Folio</div>
          <div style={{ color: "#888", fontSize: 14 }}>Looking up your invite…</div>
        </div>
      </div>
    );
  }

  if (status === "joining") {
    return (
      <div className="container">
        <div style={containerStyle}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Joining {marketName || "market"}…</div>
          <div style={{ color: "#888", fontSize: 14 }}>Setting up your portfolio. One moment.</div>
        </div>
      </div>
    );
  }

  if (status === "already") {
    return (
      <div className="container">
        <div style={containerStyle}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Already a member</div>
          <div style={{ color: "#888", fontSize: 14 }}>You're already in {marketName}. Redirecting to Market…</div>
        </div>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="container">
        <div style={containerStyle}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1D9E75" }}>You're in!</div>
          <div style={{ color: "#555", fontSize: 14 }}>Welcome to {marketName}. Your portfolio has been created with $100.00. Redirecting…</div>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="container">
      <div style={containerStyle}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#993C1D" }}>Invite not found</div>
        <div style={{ color: "#666", fontSize: 14, maxWidth: 360, textAlign: "center" }}>
          {message || "This invite link is invalid or has expired. Ask the admin to generate a new one."}
        </div>
        <button
          onClick={() => navigate("/market")}
          style={{
            marginTop: 8, fontSize: 13, fontWeight: 600, fontFamily: "Arial, sans-serif",
            padding: "8px 20px", borderRadius: 8, background: "#0d1b2a", color: "#fff",
            border: "none", cursor: "pointer",
          }}
        >
          Go to Market
        </button>
      </div>
    </div>
  );
}
