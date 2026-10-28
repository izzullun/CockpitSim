// Review sessions keeps the queue and report at full reading width.
let queueScrollPosition = 0;
function showReviewPane(pane) {
  const previous = document.body.dataset.reviewPane;
  if (previous === 'queue' && pane === 'detail') queueScrollPosition = window.scrollY;
  document.body.dataset.reviewPane = pane;
  document.querySelectorAll('[data-review-pane]').forEach((button) => {
    if (button.tagName !== 'BUTTON') return;
    button.classList.toggle('is-active', button.dataset.reviewPane === pane);
    button.setAttribute('aria-pressed', String(button.dataset.reviewPane === pane));
  });
  if (previous && previous !== pane) window.scrollTo(0, pane === 'queue' ? queueScrollPosition : 0);
}

function updateWorkspaceDescription() {
  const descriptions = {
    overview: 'Your assigned trainees and the work that needs attention.',
    'live-monitor': 'Current session, flight metrics and warnings for the selected trainee.',
    sessions: 'Review a session, read its report and leave feedback.',
    settings: 'Set the selected trainee’s session duration and consult the grading guide.',
  };
  document.getElementById('workspace-description').textContent = descriptions[location.hash.slice(1)] || descriptions.overview;
}

document.addEventListener('DOMContentLoaded', () => {
  showReviewPane('queue');
  updateWorkspaceDescription();
  window.addEventListener('hashchange', updateWorkspaceDescription);
  document.addEventListener('trainer:selection', () => showReviewPane(document.body.dataset.reviewPane || 'queue'));
  document.querySelectorAll('.review-tabs button').forEach((button) => {
    button.addEventListener('click', () => showReviewPane(button.dataset.reviewPane));
  });
  const queue = document.getElementById('session-body');
  queue?.addEventListener('click', (event) => {
    if (event.target.closest('.session-row')) showReviewPane('detail');
  }, true);
  queue?.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('.session-row')) {
      showReviewPane('detail');
    }
  }, true);
});
