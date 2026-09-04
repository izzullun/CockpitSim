// CockpitSim — Shared auth helpers
// Client-side session handling + page guards.
//
// IMPORTANT (per AGENTS.md): this is a UX gate only. The real security
// guard is [Authorize(Roles = "...")] on the backend — anyone can edit
// localStorage in the browser, so never treat these checks as security.

const SESSION_KEY = 'cockpitSim.session';

// Persist the logged-in user profile returned by POST /api/auth/login.
function saveSession(authResponse) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: authResponse.userId,
    username: authResponse.username,
    fullName: authResponse.fullName,
    role: authResponse.role.toLowerCase(),
    assignedTrainerId: authResponse.assignedTrainerId ?? null,
  }));
}

function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    clearSession();
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem('cockpitSim.jwt');
}

// Page guard: call at top of each protected page's script.
// requiredRoles: array of allowed roles, e.g. ['trainer', 'admin'].
function requireRole(requiredRoles) {
  const session = getSession();
  if (!session || !requiredRoles.includes(session.role)) {
    window.location.replace('../login/login.html');
    return null;
  }

  // Browsers restore pages from the back/forward cache (bfcache) WITHOUT
  // re-running scripts, so pressing "Back" after logout would show a stale
  // dashboard. Re-validate the session whenever the page is revived.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;

    const revived = getSession();
    if (!revived || !requiredRoles.includes(revived.role)) {
      window.location.replace('../login/login.html');
    }
  });

  return session;
}
