// Review sessions keeps the queue and report at full reading width.
function showReviewPane(pane) {
  document.body.dataset.reviewPane = pane;
  document.querySelectorAll('[data-review-pane]').forEach((button) => {
    if (button.tagName !== 'BUTTON') return;
    button.classList.toggle('is-active', button.dataset.reviewPane === pane);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  showReviewPane('queue');
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
