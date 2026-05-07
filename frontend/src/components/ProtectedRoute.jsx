// src/components/ProtectedRoute.jsx
// Wraps routes that require authentication.
// - Shows a loading indicator while the initial session check is in flight.
// - Redirects to /login (preserving the intended destination) if not authenticated.
// - Renders children once the user is confirmed authenticated.
//
// Usage in App.jsx:
//   <Route path="/market" element={<ProtectedRoute><GameLayout /></ProtectedRoute>} />

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <p style={{ color: "#888", fontSize: "0.95rem" }}>Loading…</p>
      </div>
    );
  }

  if (!user) {
    // Preserve the path the user was trying to reach so we can redirect back after login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
