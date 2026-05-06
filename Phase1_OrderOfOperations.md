# Folio — Phase 1: Multi-User Capability
### Order of Operations Checklist

> **Goal:** Beta-ready multi-user market by end of July 2026.
> Check off items as you go. Each "Day" is a logical unit of work — stretch or compress based on your pace.

---

## 🏗️ WEEK 1 — Foundation (Days 1–5)
*No features yet. Just the infrastructure everything else depends on.*

### Day 1 — Decisions & Project Setup
- [x] Confirm backend platform: **Supabase** (create a free project at supabase.com)
- [x] Confirm frontend host: **Vercel** (will replace GitHub Pages)
- [x] Confirm data sources (see Reference table below): **Bart Torvik** for efficiency ratings, **Sports Reference** for schedules and game results, **ESPN unofficial API** as a secondary/fallback
- [ ] Create a new Git branch: `phase1-multi-user`
- [x] Install Supabase JS client in the frontend: `npm install @supabase/supabase-js`
- [x] Add React Router: `npm install react-router-dom`
- [x] Create a `src/lib/supabase.js` file with the Supabase client initialized (use env vars for the URL and anon key)

### Day 2 — Data Source Architecture
*Define the abstraction layer before writing the schema. The app should never care which source the data came from.*

- [x] Define the **data provider interface** — a standard shape every source adapter must return:
  ```
  team: { name, conference, efficiency_rating, record, shares_total, share_price, data_source, last_updated }
  schedule: { team_name, games: [{ opponent, result, score, location, week }] }
  game_result: { team_name, opponent, result, score, date }
  ```
- [x] Create a `src/lib/providers/` folder with one file per source:
  - `torvik.js` — fetches T-Rank efficiency ratings (efficiency_rating field)
  - `sportsref.js` — fetches schedules and game results
  - `espn.js` — fallback for schedules/scores if Sports Reference is unavailable
- [x] Each provider exports the same function signatures — the rest of the app calls the interface, not the provider directly
- [x] Create a `src/lib/dataProvider.js` router that reads the active config and delegates to the correct adapter
- [x] Write a simple test for each adapter against a known team (e.g., fetch Duke's current rating, confirm it returns a number)

### Day 3 — Database Schema
*Design this carefully — it is the hardest thing to change later.*
- [x] Create the following tables in Supabase:
  - [x] `users` — id, email, is_admin, created_at *(extends Supabase Auth)*
  - [x] `markets` — id, name, created_by, max_players (6–15), status (draft/active/complete)
  - [x] `market_members` — market_id, user_id, joined_at
  - [x] `teams` — id, name, conference, efficiency_rating, record, shares_total, share_price, data_source, season, updated_at
    - `efficiency_rating` replaces the old `adj_em` column — same number, source-agnostic name
    - `data_source` stores which provider populated this row (e.g., `"torvik"`, `"net"`)
  - [x] `settings` — key, value, updated_at *(admin-editable config)*
    - Seed with: `efficiency_source = "torvik"`, `schedule_source = "sportsref"`, `results_source = "sportsref"`
  - [x] `portfolios` — id, market_id, user_id, cash, locked (bool), updated_at
  - [x] `portfolio_holdings` — portfolio_id, team_id, shares_owned
  - [x] `queue_requests` — id, portfolio_id, week, action (buy/sell), team_id, status (pending/executed/failed), failure_reason, created_at, executed_at
  - [x] `execution_log` — id, market_id, week, executed_at, total_requests, total_succeeded, total_failed
  - [x] `draft_state` — market_id, current_turn_user_id, draft_order (json array), status (waiting/active/complete)
- [x] Write Row Level Security (RLS) policies:
  - [x] Users can only read/write their own portfolio
  - [x] Users can only see queue_requests for their own portfolio
  - [x] Users can see execution_log for their market
  - [x] Users can only see market_members for their own market
- [ ] Seed team data using the **Torvik adapter** (not the existing KenPom-derived static JS files) — pull current T-Rank ratings for all D-I teams and write to `teams`

### Day 4 — Frontend Restructure
*Break up App.jsx before adding any new features. This is necessary, not optional.*
- [x] Add React Router and define basic routes:
  - `/` → redirect to `/market` if logged in, otherwise `/login`
  - `/login`
  - `/market` → main market view (was the default view in App.jsx)
  - `/portfolio` → portfolio view
  - `/log` → transaction log (new)
  - `/draft` → draft day (new)
  - `/admin` → admin panel (new, protected)
- [x] Extract these components from App.jsx into separate files:
  - [x] `PieChart.jsx`
  - [x] `LineChart.jsx`
  - [x] `TeamModal.jsx` (the team detail + buy/sell panel — `ModalActions` + detail view)
  - [x] `SettingsModal.jsx`
  - [x] `MarketTable.jsx` (the main team table)
  - [x] `PortfolioView.jsx`
- [x] Update `src/lib/supabase.js` data access layer to call `dataProvider.js` for team data rather than importing static JS files
- [x] Confirm the app still works locally after the refactor before moving on

### Day 5 — Authentication
- [ ] Enable Supabase Auth (email/password) in the Supabase dashboard
- [ ] Build a `/login` page with email + password form
- [ ] Build a `/signup` page (or combine with login)
- [ ] Add auth state to a React context (`AuthContext`) so all components can access the current user
- [ ] Protect all routes — redirect to `/login` if not authenticated
- [ ] Add a logout button
- [ ] On first sign-up, write a row to the `users` table with `is_admin = false` (set your account to `is_admin = true` manually in Supabase)
- [ ] Test: sign up, log in, log out, protected route redirect

### 🧪 Manual Test Checkpoint — After Day 5
*Run before starting Day 6. Auth gates everything — if this is broken, nothing downstream works.*
- [ ] Sign up a new account — confirm a row appears in the `users` table with `is_admin = false`
- [ ] Log in — confirm you land on `/market`
- [ ] Log out — confirm you're redirected to `/login`
- [ ] Visit `/market` without being logged in — confirm redirect to `/login`
- [ ] Visit `/portfolio`, `/log`, `/draft` without being logged in — all should redirect to `/login`
- [ ] Confirm your own account has `is_admin = true` set in Supabase

### Day 6 — Hosting Migration
- [ ] Deploy the frontend to **Vercel** (connect your GitHub repo, set build command `npm run build`, output directory `frontend/dist`)
- [ ] Set Supabase URL and anon key as environment variables in Vercel
- [ ] Update Supabase's "allowed redirect URLs" and CORS settings to include the new Vercel domain
- [ ] Confirm the deployed app loads, auth works, and data fetches correctly
- [ ] Update the GitHub Actions deploy workflow (or disable it) — GitHub Pages is no longer the target

### 🧪 Manual Test Checkpoint — After Day 6
*Run against the live Vercel URL, not localhost. Production env is different.*
- [ ] App loads at the Vercel URL without console errors
- [ ] Log in with a real account — confirm Supabase auth works in production
- [ ] Navigate between `/market` and `/portfolio` — confirm no blank screens or fetch errors
- [ ] Check browser network tab — confirm Supabase requests are hitting the right project URL (not localhost)

---

## 👥 WEEK 2 — Markets & Portfolio Persistence (Days 7–10)

### Day 7 — Market Management
- [ ] Admin can create a new market (name, max players) from `/admin`
- [ ] Admin can generate an invite link or add users by email to a market
- [ ] When a user joins a market, create a `portfolios` row for them with `cash = 100.00`
- [ ] Users can see which market they belong to
- [ ] If a user belongs to multiple markets, show a market selector (for now, just handle one market per beta)
- [ ] Market status transitions: `waiting` → `draft` → `active` → `complete`

### Day 8–9 — Portfolio Persistence
*The biggest change to existing behavior — moving from React useState to the database.*
- [ ] Replace all in-memory portfolio state (`portfolio`, `cash`, `tradeLog`, `portfolioHistory`) with Supabase queries
- [ ] Portfolio page now fetches from `portfolio_holdings` and `portfolios` tables
- [ ] `calcShares()` and `sharePrice()` logic stays the same — just pulling `efficiency_rating` from the DB instead of static JS (rename any internal references from `adjEM` to `efficiencyRating` for consistency)
- [ ] Portfolio history (the line chart) — decide: store weekly snapshots in a `portfolio_snapshots` table, or compute from the execution log. Snapshots are simpler.
- [ ] Add a `portfolio_snapshots` table: portfolio_id, week, total_value, cash, created_at
- [ ] Dividend log — store in a `dividend_events` table: portfolio_id, team_id, week, rule_key, payout, created_at
- [ ] Verify the portfolio view renders correctly with live DB data for a single user before moving on

### 🧪 Manual Test Checkpoint — After Days 8–9
*Biggest behavioral change in the project — in-memory state replaced with DB. Don't move on until this is solid.*
- [ ] Buy a share, then hard-refresh the page — confirm the holding persists (it's in the DB, not React state)
- [ ] Advance a week — confirm portfolio value recalculates correctly from DB data
- [ ] Check the `portfolio_holdings` and `portfolios` tables in Supabase — confirm values match what the UI shows
- [ ] Log in as a second test account — confirm you cannot see the first account's portfolio holdings or queue (RLS enforced)
- [ ] Confirm the portfolio line chart renders from `portfolio_snapshots` data, not in-memory history

### Day 10 — Leaderboard / Market View
- [ ] Add a simple leaderboard to the market view: all players in the market, ranked by portfolio value
- [ ] Each player's portfolio value = sum of (shares_owned × share_price) + cash
- [ ] Other players' holdings are visible (just the portfolio value total, not their individual positions)
- [ ] Your own holdings remain fully visible on your portfolio page
- [ ] Confirm RLS is enforced: a user cannot query another user's queue or private data

---

## 📋 WEEK 3 — Queue System (Days 11–14)

### Day 11 — Queue Submission UI
*Replace the instant buy/sell in `ModalActions` with a queue request.*
- [ ] Change `ModalActions` (now inside `TeamModal.jsx`): "Buy" and "Sell" buttons add a request to the queue instead of immediately executing
- [ ] Show the user their current pending queue (private — only visible to them)
- [ ] Display request count (e.g., "3 of 10 requests used this week")
- [ ] Prevent more than 10 requests per week — disable the add button and show a message
- [ ] Each request: 1 share max (buy 1 or sell 1 — already how the current app works)
- [ ] Allow users to cancel a pending request before the queue executes
- [ ] Show queue status: Pending / Executed / Failed

### Day 12 — Queue Validation Logic
*Server-side — this cannot live only in the UI.*
- [ ] When a request is added, validate immediately:
  - [ ] Does the user have enough cash (accounting for other pending buy requests)?
  - [ ] Are shares available for this team (accounting for other pending buy requests in the same market)?
- [ ] If invalid at submission time, reject with a clear reason rather than letting it sit as pending
- [ ] Write a Supabase Edge Function (or a server-side function) to handle queue submission — do not trust client-side validation alone

### Day 13 — Execute Queue Logic
*The core game mechanic for weekly play.*
- [ ] Write the Execute Queue function (Supabase Edge Function or server-side):
  1. Get all portfolios in the market, sort by total value ascending (lowest first)
  2. For each portfolio in order: attempt to execute their **first** pending request
  3. Then loop again — each portfolio's **second** request, and so on
  4. Continue until all requests have been processed
  5. For each request: re-validate funds and share availability at execution time (not submission time)
  6. On failure: mark status = `failed`, store failure_reason (`not_enough_funds` or `shares_unavailable`), do not apply any change
  7. On success: update `portfolio_holdings`, update `cash`, mark status = `executed`
  8. Write an `execution_log` record when complete
- [ ] Add **Execute Queue** button to the simulation controls in the admin view (next to "Advance Week")
- [ ] Advance Week should still work as before, but queue execution should happen before week advances

### 🧪 Manual Test Checkpoint — After Day 13
*The core game mechanic. Use two test accounts in two browser windows.*
- [ ] Account A and Account B each submit buy requests for the same team
- [ ] Run Execute Queue — confirm only one succeeds if shares run out, and the failure reason is recorded
- [ ] Account A submits a buy request with insufficient cash — confirm it fails with `not_enough_funds`
- [ ] Click Execute Queue twice for the same week — confirm it's idempotent (second run does nothing)
- [ ] Confirm Account A cannot see Account B's pending queue before execution
- [ ] After execution, confirm both accounts can see the results in the transaction log

### Day 14 — Transaction Log Page
- [ ] Build the `/log` page — visible to all players in the market
- [ ] Organized by week (most recent first)
- [ ] Each week shows every request that was executed, in execution order:
  - Player name, action (buy/sell), team, result (✅ success / ❌ failed), failure reason if failed
- [ ] Player's own queue before execution remains private (not shown here until after Execute Queue runs)
- [ ] Test with at least two user accounts to confirm privacy rules hold

---

## 🎲 WEEK 4–5 — Draft Day (Days 15–21)
*The most complex piece. Build this last so the simpler foundations are solid.*

### Day 15 — Draft Infrastructure
- [ ] Add a `draft_picks` table: market_id, user_id, team_id, pick_number, created_at
- [ ] When admin sets market status to `draft`, initialize `draft_state`:
  - Randomize the draft order (array of user_ids)
  - Set `current_turn_user_id` to first in order
  - Set available shares: all teams start with their full `shares_total`
- [ ] Shares picked during draft reduce availability in real time
- [ ] Once all players lock in or run out of funds → set market status to `active`, lock all portfolios, zero out `draftMode`

### Day 16–17 — Draft UI
- [ ] Build the `/draft` page
- [ ] Show whose turn it is prominently
- [ ] Show all available teams and their share prices (same market table view)
- [ ] If it is your turn: clicking a team adds it to your draft picks (one per turn, then turn passes)
- [ ] Show each player's current picks as they accumulate (visible to all — draft is public)
- [ ] "Lock In" button — ends your draft, passes turn permanently, but you remain able to spend until broke
- [ ] Show remaining budget for each player
- [ ] Show when a player is done (locked or out of funds)
- [ ] Real-time updates using Supabase Realtime subscriptions — all players see picks as they happen without refreshing

### Day 18 — Draft Real-Time Sync
*The hardest technical piece — concurrent access and turn enforcement.*
- [ ] Use Supabase Realtime to subscribe to `draft_state` changes — when `current_turn_user_id` changes, the UI updates for all players instantly
- [ ] Enforce turn order server-side: a pick submission is rejected if it is not the submitting user's turn
- [ ] Handle race conditions: if two players somehow submit simultaneously, use a database transaction to ensure only one succeeds
- [ ] Test with two browser windows (two different logged-in users) — picks should appear in real time
- [ ] When all players are done, `draft_state.status` transitions to `complete` automatically (triggered by a DB function or Edge Function)

### 🧪 Manual Test Checkpoint — After Days 17–18
*Real-time sync is the hardest piece. Test interactively with two browser windows, two accounts.*
- [ ] Open two browsers logged in as different users — confirm both see the draft board
- [ ] Account A makes a pick — confirm it appears in Account B's browser within ~2 seconds without a refresh
- [ ] Try to pick out of turn as Account B — confirm the server rejects it
- [ ] Simulate a slow network: submit two picks simultaneously from both accounts — confirm only one succeeds and the other gets a clean error
- [ ] Complete the draft — confirm `draft_state.status` transitions to `complete` and all players are redirected to `/market`

### Day 19 — Draft Completion & Portfolio Lock
- [ ] When draft is complete: write all draft picks to `portfolio_holdings`
- [ ] Set `portfolios.locked = true` for all players (portfolios locked for week 1)
- [ ] Set `market.status = active`
- [ ] Redirect all players from `/draft` to `/market`
- [ ] "Advance Week" should unlock portfolios and open the first queue window
- [ ] Snapshot portfolio values at the end of draft day (week 0 baseline)

---

## 🔒 WEEK 6 — Admin, Security & Polish (Days 20–22)

### Day 20 — Admin Panel
- [ ] Build `/admin` page (protected: only accessible if `is_admin = true`)
  - [ ] Create market (name, max players)
  - [ ] Add/remove users from market
  - [ ] Set market status (waiting → draft → active)
  - [ ] Trigger draft start
  - [ ] Execute Queue button
  - [ ] Advance Week button
  - [ ] View all queues (admin can see all player queues — note in rules if this is desired)
- [ ] Settings (dividend multiplier, overrides) should only be accessible to admin

### Day 21 — Security Hardening
- [ ] Audit all RLS policies — test as a non-admin user and confirm you cannot access other players' queues, other markets' data
- [ ] Move all game-logic mutations (Execute Queue, draft pick enforcement) to server-side Supabase Edge Functions or DB triggers — never trust client-only execution for anything that changes game state
- [ ] Confirm the 10-request/week cap and 1-share/request limit are enforced server-side
- [ ] Store Supabase service key in environment variables only — never in frontend code
- [ ] Review that no sensitive data is returned in API responses users should not see

### Day 22 — Final Polish & Beta Prep
- [ ] Error states: what happens if Supabase is unreachable? Show a graceful message.
- [ ] Loading states on all data fetches (no blank screens)
- [ ] Confirm the simulation (Advance Week) still correctly calculates dividends and updates team values
- [ ] Write a short "How to Play" guide for beta users
- [ ] Create accounts for your beta group in Supabase Auth
- [ ] Walk through the full flow yourself end-to-end: sign up → draft → week 1 queue → execute → advance week

### 🧪 Manual Test Checkpoint — Day 22 (Full End-to-End)
*Do this yourself before inviting anyone. One uninterrupted run-through of the complete game loop.*
- [ ] Create a fresh market as admin
- [ ] Sign up two test accounts and join the market
- [ ] Run the draft with both accounts — confirm picks persist and portfolios are locked after
- [ ] Submit queue requests as both accounts for week 1
- [ ] Execute the queue as admin — confirm results are correct and visible in the log
- [ ] Advance the week — confirm dividends calculate correctly and portfolio values update
- [ ] Confirm error states: disconnect from the internet and reload — confirm a graceful message appears, not a blank screen

---

## 🧪 WEEK 7–8 — Beta Testing (Days 24+)

### Beta Launch
- [ ] Email Bart Torvik to confirm non-commercial use of T-Rank data — keep KenPom scripts around as a local reference only, do not build new features against them
- [ ] Invite beta group to the market
- [ ] Run a live draft with real users
- [ ] Execute first weekly queue
- [ ] Collect feedback on Draft Day experience (most likely rough edge here)
- [ ] Collect feedback on queue submission UX
- [ ] Fix bugs as they surface — prioritize anything that corrupts game state

### Known Edge Cases to Test
- [ ] What happens if a player never logs in during the draft? (Skip their turn after a timeout?)
- [ ] What happens if Execute Queue runs and a team's price has changed since the request was submitted?
- [ ] What happens if a player tries to sell a share they no longer own (edge case in queue ordering)?
- [ ] Two players try to buy the last share of the same team — only one should succeed
- [ ] Admin accidentally clicks Execute Queue twice — should be idempotent for the current week

---

## 🤖 Post-Beta — Playwright Automated Tests

*Add these after the beta is stable. The manual checkpoints above catch launch-blocking bugs; Playwright catches regressions as the game grows. Focus automation on paths where bugs corrupt game state irreversibly.*

### Setup
- [ ] Install Playwright: `npm install -D @playwright/test` in the frontend directory
- [ ] Add a `playwright.config.ts` pointing at the Vercel preview URL (or localhost for CI)
- [ ] Create a test Supabase project (separate from production) seeded with known data for deterministic assertions
- [ ] Add `npm run test:e2e` script and wire it into CI so tests run on every pull request

### Auth Flow
- [ ] Sign up → confirm redirect to `/market` and `users` row created
- [ ] Log in with valid credentials → lands on `/market`
- [ ] Log in with wrong password → error message shown, no redirect
- [ ] Visit protected route while logged out → redirected to `/login`
- [ ] Log out → redirected to `/login`, back button does not restore session

### Queue Submission & Execution
- [ ] Submit a valid buy request → appears in pending queue with status `pending`
- [ ] Submit an 11th request in a week → button disabled, warning message shown
- [ ] Cancel a pending request → disappears from queue
- [ ] Execute Queue with two accounts competing for the last share of a team → exactly one succeeds, one fails with `shares_unavailable`
- [ ] Execute Queue twice for the same week → second execution changes nothing (idempotent)
- [ ] After execution, both accounts can see results in `/log`; pending queues are no longer visible

### Draft Flow
- [ ] Admin starts draft → both players see the draft board
- [ ] Player A picks a team → Player B's view updates within 3 seconds without refresh
- [ ] Player B attempts to pick out of turn → request rejected, no state change
- [ ] All players complete draft → `draft_state.status` becomes `complete`, players redirected to `/market`
- [ ] Portfolio holdings match draft picks after draft completes

### Portfolio Persistence
- [ ] Buy a share, hard-refresh → holding still present (confirming DB persistence, not React state)
- [ ] Advance a week → portfolio value updates correctly in both UI and `portfolio_snapshots` table
- [ ] RLS: logged in as Player A, attempt to fetch Player B's `queue_requests` → returns empty, not an error

---

## 📌 Reference: Key Decisions Already Made
| Decision | Choice |
|---|---|
| Backend | Supabase (Postgres + Auth + Realtime) |
| Frontend Host | Vercel |
| Efficiency rating source | Bart Torvik T-Rank (primary) |
| Schedule & game result source | Sports Reference (primary), ESPN unofficial API (fallback) |
| KenPom | Local reference only — not used in data pipeline |
| DB column name | `efficiency_rating` (not `adj_em` — source-agnostic) |
| Data source config | `settings` table in Supabase (admin-editable) |
| Queue execution order | Lowest portfolio value executes first |
| Draft order | Random |
| Max queue requests/week | 10 |
| Max shares per request | 1 |
| Admin | Max only (`is_admin = true`) |
| Queue privacy | Private until executed, then public in the log |
