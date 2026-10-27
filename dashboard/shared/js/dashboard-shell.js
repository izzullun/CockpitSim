// Shared dashboard hash navigation. The route only changes which existing
// content region is visible; API calls and their lifecycle remain page-owned.
const APP_ROUTE_FALLBACK = document.body.dataset.defaultRoute || "overview";

function currentAppRoute() {
  const requested = window.location.hash.slice(1);
  return document.querySelector(`.app-nav-link[href="#${CSS.escape(requested)}"]`)
    ? requested
    : APP_ROUTE_FALLBACK;
}

function renderAppRoute() {
  const route = currentAppRoute();
  const activeLink = document.querySelector(`.app-nav-link[href="#${CSS.escape(route)}"]`);
  const title = document.querySelector(".app-page-title");
  document.body.dataset.activeRoute = route;
  if (title && activeLink) title.textContent = activeLink.querySelector(".app-nav-label")?.textContent || activeLink.title;

  document.querySelectorAll(".app-nav-link").forEach((link) => {
    if (link.getAttribute("href") === `#${route}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  document.querySelectorAll("[data-shell-view]").forEach((view) => {
    view.hidden = view.dataset.shellView !== route;
  });
}

function initialiseDashboardShell() {
  localStorage.removeItem("cockpitSim.audioMuted");
  renderAppRoute();
  window.addEventListener("hashchange", renderAppRoute);

  let name = document.body.dataset.userName;
  if (!name) {
    try { name = JSON.parse(localStorage.getItem("cockpitSim.session") || "{}").fullName; }
    catch { name = ""; }
  }
  const account = document.querySelector("[data-shell-account]");
  if (name && account) account.textContent = name;
}

initialiseDashboardShell();
