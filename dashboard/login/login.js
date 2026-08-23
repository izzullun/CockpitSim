// CockpitSim — Login page
// Calls POST /api/auth/login and routes by the role the backend returns:
//   - trainee  -> pre-session
//   - trainer  -> trainer dashboard
//   - admin    -> role-select (dev/testing convenience)
// Role-select is NOT part of the normal trainee/trainer flow.

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
