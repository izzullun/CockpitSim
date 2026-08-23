// CockpitSim — Shared API helper
// All frontend-to-backend calls go through here so the base URL and
// auth header handling stay in one place.

// TODO: move to a config file when the backend gets a fixed deploy URL.
const API_BASE_URL = 'http://localhost:5247/api';

async function apiRequest(path, { method = 'GET', body = null, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = localStorage.getItem('cockpitSim.jwt');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response body — leave data as null.
  }

  return { ok: response.ok, status: response.status, data };
}
