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
    initBillOfMaterials();
    initInventorySnapshot();
    initUnitsOfMeasure();
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
  let selectedRow = null;
  let selectedPartNumber = '';

  const clearSelection = () => {
    const hadSelection = Boolean(selectedRow || selectedPartNumber);

    if (selectedRow) {
      selectedRow.classList.remove('is-selected');
      selectedRow.removeAttribute('aria-selected');
      selectedRow = null;
    }

    selectedPartNumber = '';

    if (hadSelection) {
      document.dispatchEvent(new CustomEvent('inventory:part-cleared'));
    }
  };

  const showMessage = (message) => {
    resultsBody.innerHTML = '';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.dataset.partMessage = '';
    cell.textContent = message;
    row.appendChild(cell);
    resultsBody.appendChild(row);

    clearSelection();
  };

  const renderRows = (parts) => {
    resultsBody.innerHTML = '';
    let foundSelection = false;

    parts.forEach((part) => {
      const row = document.createElement('tr');
      row.dataset.interactive = '';
      row.tabIndex = 0;
      row.setAttribute('role', 'row');

      const handleSelection = () => {
        if (selectedRow && selectedRow !== row) {
          selectedRow.classList.remove('is-selected');
          selectedRow.removeAttribute('aria-selected');
        }

        selectedRow = row;
        selectedPartNumber = part.partNumber;
        row.classList.add('is-selected');
        row.setAttribute('aria-selected', 'true');

        document.dispatchEvent(
          new CustomEvent('inventory:part-selected', {
            detail: {
              partNumber: part.partNumber,
              description: part.description,
            },
          }),
        );
      };

      row.addEventListener('click', handleSelection);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleSelection();
        }
      });

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

      if (selectedPartNumber && part.partNumber === selectedPartNumber) {
        row.classList.add('is-selected');
        row.setAttribute('aria-selected', 'true');
        selectedRow = row;
        foundSelection = true;
      }

      resultsBody.appendChild(row);
    });

    if (selectedPartNumber && !foundSelection) {
      clearSelection();
    }
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

function initBillOfMaterials() {
  const tableBody = document.querySelector('[data-bom-results]');

  if (!tableBody) {
    return;
  }

  let activeController = null;

  const showMessage = (message) => {
    tableBody.innerHTML = '';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.dataset.bomMessage = '';
    cell.textContent = message;
    row.appendChild(cell);
    tableBody.appendChild(row);
  };

  const formatPart = (partNumber, description) => {
    const number = partNumber && partNumber.length > 0 ? partNumber : '—';
    const desc = description && description.length > 0 ? description : '';
    return desc ? `${number} — ${desc}` : number;
  };

  const formatDate = (value) => {
    if (!value) {
      return '—';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  };

  const numberFormatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  const renderRows = (items) => {
    tableBody.innerHTML = '';

    if (!Array.isArray(items) || items.length === 0) {
      showMessage('No bill of materials records available.');
      return;
    }

    items.forEach((item) => {
      const row = document.createElement('tr');

      const cells = [
        formatPart(item.assembly, item.assemblyDescription),
        formatPart(item.component, item.componentDescription),
        item.sequence && item.sequence.length > 0 ? item.sequence : '—',
        typeof item.quantityPer === 'number' && !Number.isNaN(item.quantityPer)
          ? numberFormatter.format(item.quantityPer)
          : '—',
        formatDate(item.effectiveDate),
        formatDate(item.obsoleteDate),
        item.notes && item.notes.length > 0 ? item.notes : '—',
      ];

      cells.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });

      tableBody.appendChild(row);
    });
  };

  const loadData = async (assembly) => {
    const trimmedAssembly = typeof assembly === 'string' ? assembly.trim() : '';

    if (!trimmedAssembly) {
      showMessage('Select a part to view its bill of materials.');
      return;
    }

    showMessage('Loading bill of materials…');

    if (activeController && typeof activeController.abort === 'function') {
      activeController.abort();
    }

    activeController = typeof AbortController === 'undefined' ? null : new AbortController();

    try {
      const fetchOptions = {};

      if (activeController) {
        fetchOptions.signal = activeController.signal;
      }

      const response = await fetch(`/api/bom?assembly=${encodeURIComponent(trimmedAssembly)}`, fetchOptions);

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      renderRows(payload?.data ?? []);
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      console.error('Failed to load bill of materials:', error);
      showMessage('Unable to retrieve bill of materials.');
    }
  };

  document.addEventListener('inventory:part-selected', (event) => {
    const detail = event?.detail ?? {};
    void loadData(detail.partNumber);
  });

  document.addEventListener('inventory:part-cleared', () => {
    showMessage('Select a part to view its bill of materials.');
  });

  showMessage('Select a part to view its bill of materials.');
}

function initInventorySnapshot() {
  const onHandTarget = document.querySelector('[data-placeholder="on-hand"]');
  const allocatedTarget = document.querySelector('[data-placeholder="allocated"]');
  const availableTarget = document.querySelector('[data-placeholder="available"]');
  const lotCountTarget = document.querySelector('[data-placeholder="lot-count"]');
  const lastReceiptTarget = document.querySelector('[data-placeholder="last-receipt"]');

  if (!onHandTarget || !allocatedTarget || !availableTarget) {
    return;
  }

  const numberFormatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const assignText = (node, value) => {
    if (!node) {
      return;
    }

    node.textContent = value;
  };

  const formatDate = (value) => {
    if (!value) {
      return '—';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  };

  const loadSnapshot = async () => {
    assignText(onHandTarget, 'Loading…');
    assignText(allocatedTarget, 'Loading…');
    assignText(availableTarget, 'Loading…');
    assignText(lotCountTarget, 'Loading…');
    assignText(lastReceiptTarget, 'Loading…');

    try {
      const response = await fetch('/api/inventory');

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const snapshot = payload?.data ?? {};

      assignText(
        onHandTarget,
        typeof snapshot.quantityOnHand === 'number'
          ? numberFormatter.format(snapshot.quantityOnHand)
          : '—',
      );

      assignText(
        allocatedTarget,
        typeof snapshot.quantityAllocated === 'number'
          ? numberFormatter.format(snapshot.quantityAllocated)
          : '—',
      );

      assignText(
        availableTarget,
        typeof snapshot.quantityAvailable === 'number'
          ? numberFormatter.format(snapshot.quantityAvailable)
          : '—',
      );

      assignText(
        lotCountTarget,
        typeof snapshot.lotCount === 'number' ? numberFormatter.format(snapshot.lotCount) : '—',
      );

      assignText(lastReceiptTarget, formatDate(snapshot.lastReceiptDate));
    } catch (error) {
      console.error('Failed to load inventory snapshot:', error);
      assignText(onHandTarget, '—');
      assignText(allocatedTarget, '—');
      assignText(availableTarget, '—');
      assignText(lotCountTarget, '—');
      assignText(lastReceiptTarget, '—');
    }
  };

  void loadSnapshot();
}

function initUnitsOfMeasure() {
  const tableBody = document.querySelector('[data-uom-results]');

  if (!tableBody) {
    return;
  }

  const showMessage = (message) => {
    tableBody.innerHTML = '';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.dataset.uomMessage = '';
    cell.textContent = message;
    row.appendChild(cell);
    tableBody.appendChild(row);
  };

  const numberFormatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });

  const renderRows = (items) => {
    tableBody.innerHTML = '';

    if (!Array.isArray(items) || items.length === 0) {
      showMessage('No units of measure configured.');
      return;
    }

    items.forEach((item) => {
      const row = document.createElement('tr');

      const cells = [
        item.code && item.code.length > 0 ? item.code : '—',
        item.description && item.description.length > 0 ? item.description : '—',
        item.type && item.type.length > 0 ? item.type : '—',
        typeof item.conversionFactor === 'number' && !Number.isNaN(item.conversionFactor)
          ? numberFormatter.format(item.conversionFactor)
          : '—',
        item.usage && item.usage.length > 0 ? item.usage : '—',
      ];

      cells.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });

      tableBody.appendChild(row);
    });
  };

  const loadData = async () => {
    showMessage('Loading units of measure…');

    try {
      const response = await fetch('/api/uom');

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      renderRows(payload?.data ?? []);
    } catch (error) {
      console.error('Failed to load units of measure:', error);
      showMessage('Unable to retrieve units of measure.');
    }
  };

  void loadData();
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
