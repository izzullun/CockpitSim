// CockpitSim — Logout confirmation modal (shared)
// Usage on any dashboard page:
//   1. Include shared/css/logout-modal.css and this script AFTER auth.js
//   2. Call initLogoutConfirm() — binds the page's #logout-btn so clicking it
//      opens a themed confirm dialog instead of logging out immediately.
// On confirm: clears the session and returns to the login page.

function initLogoutConfirm(buttonId = 'logout-btn') {
  const trigger = document.getElementById(buttonId);
  if (!trigger) return;

  // Inject the modal markup once per page.
  if (!document.getElementById('logout-confirm-overlay')) {
    const overlay = document.createElement('dialog');
    overlay.id = 'logout-confirm-overlay';
    overlay.className = 'logout-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'logout-confirm-title');
    overlay.innerHTML = `
      <div class="logout-modal" data-cockpit-outline>
        <h2 class="logout-modal-title" id="logout-confirm-title">Log out of CockpitSim?</h2>
        <p class="logout-modal-text">Are you sure you want to log out? Any unsaved progress will be lost.</p>
        <div class="logout-modal-actions">
          <button type="button" class="modal-btn" id="logout-cancel-btn">Cancel</button>
          <button type="button" class="modal-btn modal-btn-danger" id="logout-confirm-btn">Log out</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  const overlay = document.getElementById('logout-confirm-overlay');

  const openModal = () => {
    overlay.showModal();
    document.getElementById('logout-cancel-btn').focus();
  };

  const closeModal = () => overlay.close();

  trigger.addEventListener('click', openModal);

  document.getElementById('logout-cancel-btn').addEventListener('click', closeModal);

  // Clicking the dark backdrop also cancels.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  overlay.addEventListener('close', () => trigger.focus());

  document.getElementById('logout-confirm-btn').addEventListener('click', () => {
    clearSession();
    window.location.href = '../login/login.html';
  });
}
