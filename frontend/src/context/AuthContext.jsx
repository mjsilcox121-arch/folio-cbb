// src/context/AuthContext.jsx
// Provides auth state (user, loading) and auth actions (signIn, signUp, signOut)
// to the entire app via React context.
//
// Usage:
//   import { useAuth } from "../context/AuthContext";
//   const { user, signIn, signOut } = useAuth();
//
// The users table row is written automatically by the DB trigger
// (on_auth_user_created) defined in day3_schema_migration.sql.

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true); // true until first session check resolves
  const [isAdmin, setIsAdmin] = useState(false);
  const [ticker, setTickerState] = useState(null);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setIsAdmin(false); setTickerState(null); return; }
    const { data } = await supabase
      .from("profiles")
      .select("is_admin, ticker")
      .eq("id", userId)
      .maybeSingle();
    setIsAdmin(data?.is_admin === true);
    setTickerState(data?.ticker ?? null);
  }, []);

  useEffect(() => {
    // Get the current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      loadProfile(session?.user?.id ?? null);
      setLoading(false);
    });

    // Listen for future auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      loadProfile(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    // The DB trigger (on_auth_user_created) auto-inserts a row into public.users
    // with is_admin = false. No additional client-side write needed.
    return data;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function updateTicker(newTicker) {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) throw new Error("Not authenticated");
    const val = newTicker?.trim().toUpperCase() || null;
    const { error } = await supabase
      .from("profiles")
      .update({ ticker: val })
      .eq("id", currentUser.id);
    if (error) throw new Error("Failed to save ticker: " + error.message);
    setTickerState(val);
  }

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, ticker, signIn, signUp, signOut, updateTicker }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
