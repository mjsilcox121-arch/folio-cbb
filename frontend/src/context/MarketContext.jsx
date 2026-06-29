// src/context/MarketContext.jsx
// Provides the current user's active market (and a list of all their markets)
// to any component in the tree.
//
// Usage:
//   import { useMarket } from "../context/MarketContext";
//   const { market, markets, loading, refresh } = useMarket();
//
// market — the currently selected market object (or null if the user has none)
// markets — all markets the user belongs to
// loading — true while the initial fetch is in flight
// refresh — call this after joining a new market to re-fetch

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { getMyMarkets } from "../lib/supabase";

const MarketContext = createContext(null);

export function MarketProvider({ children }) {
  const { user } = useAuth();
  const [markets, setMarkets] = useState([]);
  const [activeMarketId, setActiveMarketId] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMarkets = useCallback(async () => {
    if (!user) {
      setMarkets([]);
      setActiveMarketId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await getMyMarkets();
      setMarkets(result);
      // Auto-select: prefer the first non-complete market, else the first one
      if (result.length > 0 && !activeMarketId) {
        const preferred = result.find((m) => m.status !== "complete") ?? result[0];
        setActiveMarketId(preferred.id);
      }
    } catch (err) {
      console.error("[MarketContext] fetchMarkets failed:", err.message);
    } finally {
      setLoading(false);
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  const market = markets.find((m) => m.id === activeMarketId) ?? null;

  return (
    <MarketContext.Provider value={{
      market,
      markets,
      activeMarketId,
      setActiveMarketId,
      loading,
      refresh: fetchMarkets,
    }}>
      {children}
    </MarketContext.Provider>
  );
}

export function useMarket() {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error("useMarket must be used within a MarketProvider");
  return ctx;
}
