# Trainee Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Give trainees a clear mission, flight log, live flight screen, and result experience, while making trainer Review sessions readable at full screen width.

**Architecture:** Keep the existing API calls and session lifecycle. Use the shared Phase 1 shell, page-specific layouts, and a shared report detail panel fed by the stored SessionReport. Keep unavailable scheduling, risk, and prior scores neutral or hidden.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript modules, ASP.NET Core API. No external assets or build step.

**Spec:** `C:/Users/Adam Haikal/OneDrive/Documents/SEM 5/FYP02/References/cockpitsim-ui-redesign-prompt.md`, plus the user's Phase 2 trainer Review sessions width correction in this chat.

## Global Constraints

- Preserve auth, API endpoints, session start/end, and live polling.
- Do not alter backend-owned grading or `dashboard/shared/css/main.css` tokens.
- Do not invent scheduled sessions, scores, risk bands, or trainer notes.
- Work offline in WebView2; respect reduced motion and keyboard focus.
- Main views fit 1366×768 and 1920×1080 with inner panel scrolling as needed.

## Review Focus

- An empty history has a useful state and no false result.
- A completed session with no telemetry does not show a passing score.
- An ungraded report stays calm and can recover when grading finishes.
- A previous attempt comparison uses only the same scenario.
- Review sessions remains readable at 1366px and does not squeeze table columns.

---

### Task 1: Trainee data states and Mission, profile, Flight log

**Files:** `dashboard/trainee/pre-session.html`, `pre-session.css`, `pre-session.js`, `dashboard/trainee/trainee-view-model.js`, `dashboard/trainee/tests/trainee-view-model.test.mjs`

**Interfaces:** Produces `missionFromHistory(profile, sessions)`, `historyEntries(sessions)`, and `profileStats(sessions)` from API data. Mission uses the supported hover scenario until scheduling exists, with no invented assignment.

- [ ] Write tests for empty history, completed versus graded outcomes, and duration totals; run them RED.
- [ ] Implement the data model and wire the page to it; run tests GREEN.
- [ ] Restyle the three hash views as a no-scroll canvas with a mission hero, a compact profile, and an internally scrolling flight list.
- [ ] Verify API call and start behavior, run syntax and model tests.

### Task 2: During-session screen

**Files:** `dashboard/trainee/session-ongoing.html`, `session-ongoing.css`, `session-ongoing.js`, model tests as needed.

**Interfaces:** Consumes unchanged live report payload and timer. Produces visible waiting/live/ended states and an end-session confirmation.

- [ ] Add a failing test for live state mapping, including backend setup warnings mapped to trainee-friendly copy.
- [ ] Implement live state mapping and confirmation; run tests GREEN.
- [ ] Build the large remaining-time view and clear metric status list without exposing UUID or setup commands.
- [ ] Verify polling and end paths remain intact.

### Task 3: Result and shared report detail

**Files:** `dashboard/trainee/post-session.html`, `post-session.css`, `post-session.js`, `dashboard/trainee/report-view-model.js`, `dashboard/trainee/report-panel.js`, associated tests, and the Flight log integration.

**Interfaces:** Consumes stored `SessionReportDto`; produces score/verdict, stars, strongest/weakest callouts, same-scenario comparison, and shared detail tabs. Null score is pending or no telemetry, not a pass.

- [ ] Test scored, ungraded, no-telemetry, and same-scenario previous report states RED.
- [ ] Implement model and detail panel; run tests GREEN.
- [ ] Build a result reveal and four-tab side panel; connect history rows to the same panel.
- [ ] Verify reduced motion, report polling, and backend-only values.

### Task 4: Trainer Review sessions readability

**Files:** `dashboard/shared/css/dashboard-shell.css`, `dashboard/trainer/trainer-dashboard.css`, `trainer-dashboard.html` only if headings need adjustment.

**Interfaces:** Existing session selection and feedback IDs stay intact.

- [ ] Establish a visual failing case at 1366px: narrow list or feedback content.
- [ ] Widen the route's canvas and set a larger review list/detail balance, allowing independent inner scroll.
- [ ] Verify session row selection and feedback controls at desktop and narrow widths.

### Task 5: Visual and integration verification

**Files:** No production files unless a finding requires a fix.

- [ ] Run Node syntax and model tests, `git diff --check`, and the design skill linter.
- [ ] Inspect desktop, tablet, and phone screenshots; fix the worst visible issues and inspect again.
- [ ] Review the full branch against this plan and report backend gaps and manual checks.
