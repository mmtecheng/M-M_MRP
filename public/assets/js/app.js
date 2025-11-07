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

  if (bodyPage === 'inventory') {
    initInventorySearch();
  }

  if (bodyPage === 'dashboard') {
    initDashboardAdminTools();
  }
});

function initInventorySearch() {
  const searchInput = document.querySelector('#part-search');
  const resultsBody = document.querySelector('[data-part-results]');

  if (!searchInput || !resultsBody) {
    return;
  }

  let debounceTimer = 0;
  let activeController = null;

  const showMessage = (message) => {
    resultsBody.innerHTML = '';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.dataset.partMessage = '';
    cell.textContent = message;
    row.appendChild(cell);
    resultsBody.appendChild(row);
  };

  const renderRows = (parts) => {
    resultsBody.innerHTML = '';
    parts.forEach((part) => {
      const row = document.createElement('tr');
      const cells = [
        part.partNumber,
        part.description,
        part.revision,
        part.stockUom,
        part.commodityCode,
        part.abcCode,
        part.status,
      ];

      cells.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value && value.length > 0 ? value : '—';
        row.appendChild(cell);
      });

      resultsBody.appendChild(row);
    });
  };

  const performSearch = async () => {
    const query = searchInput.value.trim();

    if (query.length === 0) {
      showMessage('Enter a part number to search.');
      return;
    }

    showMessage('Searching…');

    if (activeController && typeof activeController.abort === 'function') {
      activeController.abort();
    }

    activeController = typeof AbortController === 'undefined' ? null : new AbortController();

    try {
      const fetchOptions = {};

      if (activeController) {
        fetchOptions.signal = activeController.signal;
      }

      const response = await fetch(`/api/parts?search=${encodeURIComponent(query)}`, fetchOptions);

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const parts = Array.isArray(payload.data) ? payload.data : [];

      if (parts.length === 0) {
        showMessage('No parts matched your search.');
        return;
      }

      renderRows(parts);
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      console.error('Part search failed:', error);
      showMessage('Unable to retrieve parts. Please try again.');
    }
  };

  searchInput.addEventListener('input', () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(performSearch, 300);
  });

  showMessage('Enter a part number to search.');
}

function initDashboardAdminTools() {
  const syncButton = document.querySelector('[data-action="prisma-sync"]');
  const statusMessage = document.querySelector('[data-prisma-sync-status]');

  if (!syncButton || !statusMessage) {
    return;
  }

  const setStatus = (message, state) => {
    statusMessage.textContent = message;
    statusMessage.classList.remove('is-info', 'is-success', 'is-error');

    if (state) {
      statusMessage.classList.add(`is-${state}`);
    }
  };

  setStatus('', null);

  syncButton.addEventListener('click', async () => {
    if (syncButton.disabled) {
      return;
    }

    setStatus('Synchronizing schema…', 'info');
    syncButton.disabled = true;
    syncButton.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch('/api/prisma/sync', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = payload && typeof payload.error === 'string' ? payload.error : 'Prisma synchronization failed.';
        throw new Error(message);
      }

      const message = payload && typeof payload.message === 'string' ? payload.message : 'Prisma schema synchronized.';
      setStatus(message, 'success');
    } catch (error) {
      console.error('Prisma schema sync failed:', error);
      const fallback = error instanceof Error ? error.message : 'Unable to synchronize Prisma schema.';
      setStatus(fallback, 'error');
    } finally {
      syncButton.disabled = false;
      syncButton.removeAttribute('aria-busy');
    }
  });
}
