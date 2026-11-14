// CockpitSim — Login page
// Calls POST /api/auth/login and routes by the role the backend returns:
//   - trainee  -> pre-session
//   - trainer  -> trainer dashboard
//   - admin    -> role-select (dev/testing convenience)
// Role-select is NOT part of the normal trainee/trainer flow.

// Always-visible show/hide password toggle (native WebView2 eye is hidden in CSS).
(function () {
  const EYE = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  const input = document.getElementById('password');
  const btn = document.getElementById('toggle-password');
  btn.innerHTML = EYE_OFF; // password starts hidden — icon shows current state
  btn.addEventListener('click', function () {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE : EYE_OFF;
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
})();

// Shows a live "Try again in M:SS" countdown and disables the form while the
// account is locked (backend returns retryAfterSeconds on lockout).
function startLockoutCountdown(seconds, errorEl) {
  const form = document.getElementById('login-form');
  const submitBtn = form.querySelector('button[type="submit"]');
  const usernameEl = document.getElementById('username');
  const passwordEl = document.getElementById('password');

  submitBtn.disabled = true;
  usernameEl.disabled = true;
  passwordEl.disabled = true;

  let remaining = seconds;
  const render = function () {
    const m = Math.floor(remaining / 60);
    const s = String(remaining % 60).padStart(2, '0');
    errorEl.textContent = `Account locked. Try again in ${m}:${s}.`;
    errorEl.hidden = false;
  };
  render();

  const timer = setInterval(function () {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      errorEl.textContent = 'You can try logging in again.';
      submitBtn.disabled = false;
      usernameEl.disabled = false;
      passwordEl.disabled = false;
      return;
    }
    render();
  }, 1000);
}

document.getElementById('login-form').addEventListener('submit', async function (e) {
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

  try {
    const { ok, data } = await apiRequest('/auth/login', {
      method: 'POST',
      body: { username, password },
    });

    if (!ok) {
      if (data && typeof data.retryAfterSeconds === 'number') {
        startLockoutCountdown(data.retryAfterSeconds, errorEl);
        return;
      }
      errorEl.textContent = (data && data.message) || 'Invalid username or password.';
      errorEl.hidden = false;
      return;
    }

    localStorage.setItem('cockpitSim.jwt', data.token);
    saveSession(data);

    // Role-based branching (decided flow — see AGENTS.md).
    if (data.role === 'trainee') {
      window.location.href = '../trainee/pre-session.html';
    } else if (data.role === 'trainer') {
      window.location.href = '../trainer/trainer-dashboard.html';
    } else {
      window.location.href = '../role-select/role-select.html';
    }
  } catch (err) {
    console.error('[login.js] Login request failed:', err);
    errorEl.textContent = 'Cannot reach the server. Is the backend running?';
    errorEl.hidden = false;
  }
});
