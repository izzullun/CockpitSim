const TOKEN_STORAGE_KEY = 'cockpitSim.jwt';
const ROLE_CLAIM = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';

function decodeJwtPayload(token) {
  const payloadSegment = token.split('.')[1];

  if (!payloadSegment) {
    throw new Error('Invalid token payload.');
  }

  const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(paddedBase64), (character) => character.charCodeAt(0));

  return JSON.parse(new TextDecoder().decode(bytes));
}

function showError(errorEl, message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

document.getElementById('login-form').addEventListener('submit', async function (e) {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('form-error');

  errorEl.hidden = true;

  if (!username || !password) {
    showError(errorEl, 'Enter both username and password.');
    return;
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      showError(errorEl, data.message || 'Invalid username or password.');
      return;
    }

    if (typeof data.token !== 'string' || !data.token) {
      throw new Error('The server did not return a valid login token.');
    }

    const payload = decodeJwtPayload(data.token);
    const role = String(payload[ROLE_CLAIM] || '').toLowerCase();

    sessionStorage.setItem(TOKEN_STORAGE_KEY, data.token);

    // TODO: role-select is intentionally bypassed here and may be reinserted
    // into the redirect flow later for admin or role-confirmation workflows.
    if (role === 'trainee') {
      window.location.href = '../trainee/pre-session.html';
      return;
    }

    if (role === 'trainer') {
      window.location.href = '../trainer/trainer-dashboard.html';
      return;
    }

    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    showError(errorEl, 'Your account role does not have a dashboard entry point yet.');
  } catch (error) {
    showError(errorEl, error.message || 'Unable to sign in. Please try again.');
  }
});