// CockpitSim — Login page
// STATUS: UI shell only. No real auth logic yet.
// TODO (Sprint 2+): replace this with a call to the backend API
// (Member 3's ASP.NET Core endpoint, e.g. POST /api/auth/login).
// TODO: decide login -> redirect flow (see open discussion with Adam):
//   Option A (recommended): backend returns role from DB, auto-redirect
//   to trainee-dashboard.html or trainer-dashboard.html directly.
//   Option B: always route through role-select.html first.
// Currently wired to Option B as a placeholder — swap once decided.

document.getElementById('login-form').addEventListener('submit', function (e) {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('form-error');

  errorEl.hidden = true;

  if (!username || !password) {
    errorEl.textContent = 'Enter both username and password.';
    errorEl.hidden = false;
    return;
  }

  // --- Placeholder only: no real validation against dummy or live data yet ---
  console.log('[login.js] Submit captured (shell only):', { username });

  // Placeholder redirect — see TODO above.
  window.location.href = '../role-select/role-select.html';
});
