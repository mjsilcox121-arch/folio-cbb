// src/pages/AdminPage.jsx
// Placeholder — built out in Day 20 (Admin Panel).
// Protected route: only accessible if the logged-in user has is_admin = true.
// Will include: create market, manage users, set market status, execute queue, advance week.

export default function AdminPage() {
  return (
    <div className="container">
      <div className="topbar">
        <div className="topbar-left">
          <h1 className="app-title">Admin</h1>
        </div>
      </div>
      <div style={{ padding: "2rem", color: "#888", textAlign: "center" }}>
        Admin panel coming in Day 20. This route will be protected (admin only).
      </div>
    </div>
  );
}
