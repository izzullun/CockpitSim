# Trainer Dashboard Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make trainer supervision, session review, feedback and duration settings clear and readable.

**Architecture:** Retain the single HTML page, existing hash routes, element IDs and API helper. Move the existing trainee selector into a persistent context strip. Keep live polling and report contracts intact; add presentation state only. Scope all styles to the trainer page.

**Tech Stack:** Static HTML/CSS/JavaScript, local ASP.NET static-file preview, Node syntax checks, installed Edge/Chrome via the design skill's browser inspector.

**Spec:** User's Phase 3 brief and approved seven-step proposal in this chat (2026-10-28).

## Global Constraints

- No backend, telemetry, SimConnect, InfluxDB, grading calculations or API base changes.
- Preserve existing JavaScript-referenced IDs and authentication/logout behavior.
- Do not alter locked design tokens in dashboard/shared/css/main.css.
- Keep current static hosting and no-cache response headers.
- No fake data, CDN dependencies, pushes or PRs.
- Use feature/trainer-phase3 from dev, focused local commits. User approved working in place.

## Review Focus

- Rapid trainee/session switches must not show or save another session's feedback.
- Empty roster, missing reports and failed API calls must stay understandable.
- Failed feedback/duration saves must preserve input and display an error.
- Long names, notes and many sessions must remain readable at narrow widths.
- Every route must start below the callsign header; narrow navigation must not cover content.

## Design decisions

Data-terminal direction, seed 381056746, retaining brand palette/type. Keep labelled navigation because trainers need obvious destinations (overrides dealt icon rail). Use the selected trainee's flight metric/tolerance rows as the product-specific signature. Overview is roster-wide and explicitly labelled; live/review/settings share the selected trainee. Settings guidance is read-only, derived from the existing hover definition. No new session-control API is available: actions navigate to review/settings or refresh existing data.

### Task 1: Trainer frame and overview

**Files:** trainer-dashboard.html, trainer-dashboard.js, trainer-dashboard.css, trainer-review.css.
**Interfaces:** Existing shared shell hash routing and live-trainee-select; selectedTraineeId remains authoritative.

- [x] Capture authenticated baseline at desktop and narrow widths.
- [x] Build visible route heading, labelled sidebar and persistent trainee context below callsign header.
- [x] Render assigned roster with monitor/review actions from actual roster/queue; use compact truthful operational counts.
- [x] Scope trainer CSS and remove conflicting fixed-height review layout.
- [x] Check JS syntax and browser navigation/selection; commit frame and overview.

### Task 2: Live and review workspaces

**Files:** trainer-dashboard.html, trainer-dashboard.js, trainer-review.js, trainer-dashboard.css, trainer-review.css.
**Interfaces:** Existing live DOM IDs, /sessions/{id}/report and /sessions/{id}/feedback.

- [x] Recompose live status, timing, metrics and warnings without changing polling/data extraction.
- [x] Scope session queue to selected trainee; full-size queue/detail views, explicit back/open actions, selected-session summary.
- [x] Show all returned warnings and notes for the selected session; keep score breakdown readable.
- [x] Preserve feedback drafts per session; prevent duplicate submits, stale responses and misleading save states.
- [x] Verify session switching, feedback target, loading/empty/error, JS syntax; commit review workflow.

### Task 3: Settings and final verification

**Files:** trainer-dashboard.html, trainer-dashboard.js, trainer-dashboard.css, trainer-review.css; verification report in docs/superpowers.
**Interfaces:** Existing /trainees and PUT /trainees/{id}/session-duration; current scenario definitions.

- [x] Present selected trainee duration with autosave explanation, 5–60 min in 5-minute steps; restore value on failure.
- [x] Display current hover guidance with explicit read-only scope and no grading modifications.
- [x] Check node --check on each changed JS; run existing frontend Node tests.
- [x] Inspect all routes at 1440, 768, 390; inspect screenshots and correct visible issues; verify cache headers.
- [x] Fresh whole-change review, address important findings; focused final commit and report files/checks/limitations/manual tests.

## Progress / rulings

- Pre-flight: tasks share existing selection, queue and DOM IDs; keep these interfaces throughout.
- Ruling: implement in the requested checkout on a feature branch, following the approved in-place approach. Cost: preview reflects branch edits until switched back.
- Ruling: use browser behavior checks for UI layout; add automated tests only for meaningful selection/feedback failures. Low-impact CSS changes do not need implementation-mirroring tests.
- Ruling: use a new trainer-workspace.css loaded after the legacy trainer styles rather than changing shared styles. Cost: future edits must account for the existing cascade; route-specific overrides are covered by browser geometry checks.
- Ruling: retain CockpitSim's existing dark brand palette and labelled sidebar instead of the dealt icon rail. Cost: less horizontal space at tablet width; session tables become readable cards there.
- Ruling: fix two pre-existing UI response races found during final review (late live rendering and pre-save notes responses). Scope is client selection/cache state only; endpoints, polling rates and backend extraction are unchanged. Cost if wrong: extra client reads on a selection/save; delayed-response browser tests now cover both.
- Task 1 and 2 complete in 9b4ded4; task 3 hardening and final verification recorded in the following commit.
- Final review: fresh read-only reviewer found duration-save A→B→A state loss and mobile 670px table specificity; both reproduced/verified and fixed. Notes scroller minor also fixed; no deferred minors.
- Final verification details: ../verification/2026-10-28-trainer-phase3.md.
