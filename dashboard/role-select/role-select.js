// CockpitSim — Role Select page
// STATUS: confirmation screen after login. Per team decision, this page is
// mainly for admin accounts / dev-testing convenience — trainee and trainer
// accounts should eventually skip this and go straight to their dashboard
// once login.js reads the role back from the backend (see login.js TODOs).

// TODO: trainee and trainer dashboards will eventually diverge further.
// For now, the trainee path is live and the trainer path goes to the trainer dashboard.
const TRAINEE_DESTINATION = '../trainee/pre-session.html';
const TRAINER_DESTINATION = '../trainer/trainer-dashboard.html';

document.querySelectorAll('.role-card').forEach((card) => {
  card.addEventListener('click', () => {
    const role = card.dataset.role;

    console.log('[role-select.js] Role chosen (shell only):', role);

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
