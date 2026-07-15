// CockpitSim — Role Select page
// STATUS: confirmation screen after login. Per team decision, this page is
// mainly for admin accounts / dev-testing convenience — trainee and trainer
// accounts should eventually skip this and go straight to their dashboard
// once login.js reads the role back from the backend (see login.js TODOs).

// TODO: dashboard pages below are not built yet (still open items).
// Paths assume the confirmed page list: trainee-dashboard.html, trainer-dashboard.html.
const ROLE_DESTINATIONS = {
  trainee: '../trainee/trainee-dashboard.html',
  trainer: '../trainer/trainer-dashboard.html',
};

document.querySelectorAll('.role-card').forEach((card) => {
  card.addEventListener('click', () => {
    const role = card.dataset.role;
    const destination = ROLE_DESTINATIONS[role];

    console.log('[role-select.js] Role chosen (shell only):', role);

    // TODO: once dashboard pages exist, uncomment this redirect.
    // window.location.href = destination;

    // Placeholder feedback until the target pages are built.
    alert(`"${role}" dashboard page isn't built yet.\nWould navigate to: ${destination}`);
  });
});
