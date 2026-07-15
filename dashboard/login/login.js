// CockpitSim — Login page
// STATUS: UI shell only. No real auth logic yet.
// TODO (Sprint 2+): replace this with a call to the backend API
// (Member 3's ASP.NET Core endpoint, e.g. POST /api/auth/login).
//
// DECIDED FLOW (confirmed with Adam):
//   Role Select is a post-login confirmation screen, mainly for admin
//   accounts and dev/demo convenience.
//   - trainee / trainer accounts should eventually SKIP role-select and
//     redirect straight to their dashboard, using the `role` field the
//     backend returns from the users table.
//   - admin accounts (or any account during dev/testing) land on
//     role-select.html to manually choose which dashboard to preview.
// Until the backend exists, we can't tell accounts apart, so everyone
// is routed through role-select.html for now. Replace the redirect below
// with role-based branching once Member 3's auth endpoint is ready, e.g.:
//   if (data.role === 'trainee') location.href = '../trainee/trainee-dashboard.html';
//   else if (data.role === 'trainer') location.href = '../trainer/trainer-dashboard.html';
//   else location.href = '../role-select/role-select.html';

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
  window.location.href = 'C:\Users\Adam Haikal\Documents\CockpitSim\dashboard\role-select\role-select.html';
});
