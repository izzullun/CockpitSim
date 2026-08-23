// CockpitSim — Role Select page
// Post-login confirmation screen for ADMIN accounts and dev-testing only.
// Trainee/trainer accounts never see this page — login.js routes them
// straight to their dashboard using the role from the backend.

// Guard: admins only. Everyone else bounces to login.
const session = requireRole(['admin']);

const TRAINEE_DESTINATION = '../trainee/pre-session.html';
const TRAINER_DESTINATION = '../trainer/trainer-dashboard.html';

if (session) {
  document.getElementById('welcome-text').textContent =
    `Logged in as ${session.fullName} — choose which dashboard to enter`;

  document.querySelectorAll('.role-card').forEach((card) => {
    card.addEventListener('click', () => {
      const role = card.dataset.role;

      if (role === 'trainee') {
        window.location.href = TRAINEE_DESTINATION;
        return;
      }

      if (role === 'trainer') {
        window.location.href = TRAINER_DESTINATION;
        return;
      }

      alert('Unknown role selected.');
    });
  });
}
