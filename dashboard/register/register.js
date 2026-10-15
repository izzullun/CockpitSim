// CockpitSim — Trainer registration page (SPIKE, throwaway)
// POSTs /api/auth/register-trainer; on success redirects to login.

// Always-visible show/hide password toggle (same as login page).
(function () {
  const EYE = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  const input = document.getElementById('password');
  const btn = document.getElementById('toggle-password');
  btn.innerHTML = EYE_OFF;
  btn.addEventListener('click', function () {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE : EYE_OFF;
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
})();

document.getElementById('register-form').addEventListener('submit', async function (e) {
  e.preventDefault();

  const fullName = document.getElementById('fullName').value.trim();
  const email = document.getElementById('email').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const registrationCode = document.getElementById('registrationCode').value.trim();
  const errorEl = document.getElementById('form-error');
  const successEl = document.getElementById('form-success');

  errorEl.hidden = true;
  successEl.hidden = true;

  if (!fullName || !email || !username || !password || !registrationCode) {
    errorEl.textContent = 'Fill in all fields.';
    errorEl.hidden = false;
    return;
  }

  try {
    const { ok, data } = await apiRequest('/auth/register-trainer', {
      method: 'POST',
      body: { fullName, email, username, password, registrationCode },
    });

    if (!ok) {
      errorEl.textContent = (data && data.message) || 'Registration failed.';
      errorEl.hidden = false;
      return;
    }

    // Spike decision: redirect to login rather than auto-login.
    successEl.textContent = 'Registered successfully — redirecting to login…';
    successEl.hidden = false;
    setTimeout(function () {
      window.location.href = '../login/login.html';
    }, 1200);
  } catch (err) {
    console.error('[register.js] Registration request failed:', err);
    errorEl.textContent = 'Cannot reach the server. Is the backend running?';
    errorEl.hidden = false;
  }
});
