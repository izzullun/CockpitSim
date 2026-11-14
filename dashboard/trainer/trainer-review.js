function updateReviewHeading() {
  const route = document.body.dataset.activeRoute || 'overview';
  const detail = document.body.dataset.reviewPane === 'detail';
  const title = document.querySelector('.app-page-title');
  const descriptions = {
    overview: 'Your assigned trainees',
    'live-monitor': document.getElementById('live-trainee-meta').textContent,
    sessions: detail ? document.getElementById('feedback-target').textContent.replace(/^Selected: /, '')
      : 'Choose a flight to review and give feedback.',
    settings: 'Session duration and the current grading guide.',
  };
  if (route === 'sessions') title.textContent = detail ? 'Report & Feedback' : 'Review Sessions';
  document.getElementById('workspace-description').textContent = descriptions[route];
}

function showReviewPane(pane) {
  document.body.dataset.reviewPane = pane;
  updateReviewHeading();
}

document.addEventListener('DOMContentLoaded', () => {
  showReviewPane('queue');
  window.addEventListener('hashchange', updateReviewHeading);
  document.addEventListener('trainer:selection', updateReviewHeading);
  const live = document.getElementById('live-trainee-meta');
  new MutationObserver(() => {
    if (document.body.dataset.activeRoute === 'live-monitor') updateReviewHeading();
  }).observe(live, { childList: true });
  const toolbar = document.querySelector('.review-toolbar');
  toolbar.querySelector('[data-review-pane="queue"]').addEventListener('click', () => {
    showReviewPane('queue');
    document.querySelector('.session-table-wrap').focus();
  });
  document.getElementById('session-body').addEventListener('click', (event) => {
    if (!event.target.closest('.session-row')) return;
    showReviewPane('detail');
    toolbar.querySelector('button').focus();
  }, true);
});
