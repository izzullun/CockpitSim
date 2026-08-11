(function (global) {
  const TOKEN_STORAGE_KEY = 'cockpitSim.jwt';

  function getToken() {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  }

  function withAuthorization(options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getToken();

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return { ...options, headers };
  }

  function fetchProtected(input, options) {
    return fetch(input, withAuthorization(options));
  }

  global.CockpitSimApi = Object.freeze({
    getToken,
    withAuthorization,
    fetchProtected,
  });
})(window);