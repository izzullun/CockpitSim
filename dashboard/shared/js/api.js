// CockpitSim — Shared API helper
// All frontend-to-backend calls go through here so the base URL and
// auth header handling stay in one place.

// TODO: move to a config file when the backend gets a fixed deploy URL.
const API_BASE_URL = 'http://localhost:5247/api';

// Backend timestamps are stored in UTC, but SQLite returns them WITHOUT a
// timezone suffix, so JS would render them as local wall-clock values (8h off
// for UTC+8 users). Append 'Z' when no offset is present before parsing.
function parseDbDate(value) {
  if (!value) return null;
  const hasOffset = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(String(value));
  return new Date(hasOffset ? value : `${value}Z`);
}

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
