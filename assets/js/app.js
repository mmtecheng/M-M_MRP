document.addEventListener('DOMContentLoaded', () => {
  const bodyPage = document.body.dataset.page;
  const navLinks = document.querySelectorAll('[data-nav]');

  navLinks.forEach((link) => {
    if (link.dataset.nav === bodyPage) {
      link.classList.add('is-active');
      const sidebarLabel = link.querySelector('.sidebar__nav-label');
      const pageTitle = document.querySelector('[data-page-title]');
      const breadcrumbCurrent = document.querySelector('[data-breadcrumb-current]');

      if (pageTitle && sidebarLabel) {
        pageTitle.textContent = sidebarLabel.textContent.trim();
      }

      if (breadcrumbCurrent && sidebarLabel) {
        breadcrumbCurrent.textContent = sidebarLabel.textContent.trim();
      }
    }
  });

  const yearTarget = document.querySelector('[data-year]');
  if (yearTarget) {
    yearTarget.textContent = new Date().getFullYear();
  }
});
