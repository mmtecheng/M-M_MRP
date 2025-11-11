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
  const descriptionInput = document.querySelector('#description-search');
  const inStockCheckbox = document.querySelector('#in-stock-filter');
  const showTenCheckbox = document.querySelector('#show-ten-filter');
  const resultsBody = document.querySelector('[data-part-results]');

  if (!searchInput || !resultsBody) {
    return;
  }

  const COLUMN_COUNT = 7;
  const quantityFormatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  let debounceTimer = 0;
  let activeController = null;
  let selectedRow = null;
  let selectedPartNumber = '';

  const getPartQuery = () => searchInput.value.trim();
  const getDescriptionQuery = () => (descriptionInput ? descriptionInput.value.trim() : '');
  const isInStockOnly = () => Boolean(inStockCheckbox?.checked);
  const showTopTenOnly = () => Boolean(showTenCheckbox?.checked);

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
    cell.colSpan = COLUMN_COUNT;
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

      const quantityValue =
        typeof part.availableQuantity === 'number' && Number.isFinite(part.availableQuantity)
          ? part.availableQuantity
          : 0;

      const cells = [
        part.partNumber,
        part.description,
        part.revision,
        quantityFormatter.format(quantityValue),
        part.location,
        part.stockUom,
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
    const partQuery = getPartQuery();
    const descriptionQuery = getDescriptionQuery();
    const inStockOnly = isInStockOnly();
    const limit = showTopTenOnly() ? 10 : undefined;

    if (!partQuery && !descriptionQuery && !inStockOnly && limit === undefined) {
      showMessage('Enter a part number, description, or enable In Stock to search.');
      return;
    }

    showMessage('Searching…');

    if (activeController && typeof activeController.abort === 'function') {
      activeController.abort();
    }

    activeController = typeof AbortController === 'undefined' ? null : new AbortController();

    try {
      const params = new URLSearchParams();
      const fetchOptions = {};

      if (partQuery) {
        params.set('partNumber', partQuery);
      }

      if (descriptionQuery) {
        params.set('description', descriptionQuery);
      }

      if (inStockOnly) {
        params.set('inStock', 'true');
      }

      if (typeof limit === 'number') {
        params.set('limit', String(limit));
      }

      if (activeController) {
        fetchOptions.signal = activeController.signal;
      }

      const queryString = params.toString();
      const requestUrl = queryString.length > 0 ? `/api/parts?${queryString}` : '/api/parts';
      const response = await fetch(requestUrl, fetchOptions);

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const parts = Array.isArray(payload.data) ? payload.data : [];

      if (parts.length === 0) {
        showMessage('No parts matched your filters.');
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

  const queueSearch = () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void performSearch();
    }, 300);
  };

  searchInput.addEventListener('input', queueSearch);

  if (descriptionInput) {
    descriptionInput.addEventListener('input', queueSearch);
  }

  if (inStockCheckbox) {
    inStockCheckbox.addEventListener('change', () => {
      window.clearTimeout(debounceTimer);
      void performSearch();
    });
  }

  if (showTenCheckbox) {
    showTenCheckbox.addEventListener('change', () => {
      window.clearTimeout(debounceTimer);
      void performSearch();
    });
  }

  showMessage('Adjust the filters to search for parts.');
}

function initBillOfMaterials() {
  const tableBody = document.querySelector('[data-bom-results]');
  const assemblyDetailTarget = document.querySelector('[data-bom-assembly]');
  const availabilityContainer = document.querySelector('[data-bom-availability]');
  const availabilityValue = document.querySelector('[data-bom-available]');
  const calculatorButton = document.querySelector('[data-bom-calculator]');
  const modal = document.querySelector('[data-bom-calculator-modal]');
  const modalTitle = modal?.querySelector('[data-bom-modal-title]');
  const calculatorForm = modal?.querySelector('[data-bom-calculator-form]');
  const quantityInput = modal?.querySelector('[data-bom-quantity-input]');
  const shortageSection = modal?.querySelector('[data-bom-shortage]');
  const shortageBody = modal?.querySelector('[data-bom-shortage-results]');
  const returnButton = modal?.querySelector('[data-bom-return]');

  if (!tableBody) {
    return;
  }

  const COLUMN_COUNT = 7;
  const defaultShortageMessage = 'Enter an assembly quantity to calculate parts short.';
  let activeController = null;
  let currentItems = [];
  let isModalOpen = false;

  const currentAssembly = {
    number: '',
    description: '',
    detailText: '',
  };

  const numberFormatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  const stockFormatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const assemblyCountFormatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  const formatPart = (partNumber, description) => {
    const number = partNumber && partNumber.length > 0 ? partNumber : '—';
    const desc = description && description.length > 0 ? description : '';
    return desc ? `${number} — ${desc}` : number;
  };

  const formatAssemblyDetail = (partNumber, description) => {
    const trimmedNumber = typeof partNumber === 'string' ? partNumber.trim() : '';
    const trimmedDescription = typeof description === 'string' ? description.trim() : '';

    if (!trimmedNumber && !trimmedDescription) {
      return '';
    }

    if (trimmedNumber && trimmedDescription) {
      return `${trimmedNumber} — ${trimmedDescription}`;
    }

    return trimmedNumber || trimmedDescription;
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

  const resetModal = () => {
    if (calculatorForm) {
      calculatorForm.reset();
    }

    if (quantityInput) {
      quantityInput.value = '';
    }

    if (shortageSection) {
      shortageSection.hidden = true;
    }

    if (shortageBody) {
      shortageBody.innerHTML = '';
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.textContent = defaultShortageMessage;
      row.appendChild(cell);
      shortageBody.appendChild(row);
    }
  };

  const closeModal = () => {
    if (!modal || !isModalOpen) {
      return;
    }

    modal.hidden = true;
    isModalOpen = false;
    document.body.classList.remove('is-modal-open');
    document.removeEventListener('keydown', handleModalKeydown);
    resetModal();
  };

  const updateAssemblyDetail = (partNumber, description) => {
    currentAssembly.number = typeof partNumber === 'string' ? partNumber.trim() : '';
    currentAssembly.description = typeof description === 'string' ? description.trim() : '';
    currentAssembly.detailText = formatAssemblyDetail(currentAssembly.number, currentAssembly.description);

    if (!assemblyDetailTarget) {
      return;
    }

    if (currentAssembly.detailText.length > 0) {
      assemblyDetailTarget.textContent = currentAssembly.detailText;
      assemblyDetailTarget.hidden = false;
    } else {
      assemblyDetailTarget.textContent = '';
      assemblyDetailTarget.hidden = true;
    }
  };

  const resetAvailability = () => {
    if (availabilityValue) {
      availabilityValue.textContent = '—';
    }

    if (availabilityContainer) {
      availabilityContainer.hidden = true;
    }

    if (calculatorButton) {
      calculatorButton.disabled = true;
    }
  };

  const computeAssembliesAvailable = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
      return 0;
    }

    let minAssemblies = Infinity;

    items.forEach((item) => {
      const qtyPer = Number(item.quantityPer);

      if (!Number.isFinite(qtyPer) || qtyPer <= 0) {
        minAssemblies = 0;
        return;
      }

      const stock = Number(item.availableQuantity);
      const availableQuantity = Number.isFinite(stock) ? Math.max(stock, 0) : 0;
      const possibleAssemblies = availableQuantity / qtyPer;

      if (!Number.isFinite(possibleAssemblies)) {
        minAssemblies = 0;
        return;
      }

      minAssemblies = Math.min(minAssemblies, possibleAssemblies);
    });

    if (!Number.isFinite(minAssemblies) || minAssemblies === Infinity) {
      return 0;
    }

    const floored = Math.floor(minAssemblies);
    return floored >= 0 ? floored : 0;
  };

  const updateAvailability = (items) => {
    if (!availabilityValue || !availabilityContainer) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      resetAvailability();
      return;
    }

    const availableCount = computeAssembliesAvailable(items);
    availabilityValue.textContent = assemblyCountFormatter.format(availableCount);
    availabilityContainer.hidden = false;

    if (calculatorButton) {
      calculatorButton.disabled = false;
    }
  };

  const getAssemblyTitle = () => {
    if (currentAssembly.detailText) {
      return currentAssembly.detailText;
    }

    if (currentAssembly.number) {
      return currentAssembly.number;
    }

    return 'Selected Assembly';
  };

  const handleModalKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
  };

  const openModal = () => {
    if (!modal || calculatorButton?.disabled) {
      return;
    }

    resetModal();

    if (modalTitle) {
      modalTitle.textContent = `Calculate Parts Short for Assembly '${getAssemblyTitle()}'`;
    }

    modal.hidden = false;
    isModalOpen = true;
    document.body.classList.add('is-modal-open');
    document.addEventListener('keydown', handleModalKeydown);

    window.requestAnimationFrame(() => {
      quantityInput?.focus();
    });
  };

  const renderShortages = (assembliesNeeded) => {
    if (shortageSection) {
      shortageSection.hidden = false;
    }

    if (!shortageBody) {
      return;
    }

    shortageBody.innerHTML = '';

    if (!Array.isArray(currentItems) || currentItems.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.textContent = 'No bill of materials loaded.';
      row.appendChild(cell);
      shortageBody.appendChild(row);
      return;
    }

    const shortages = [];

    currentItems.forEach((item) => {
      const qtyPer = Number(item.quantityPer);

      if (!Number.isFinite(qtyPer) || qtyPer <= 0) {
        return;
      }

      const stock = Number(item.availableQuantity);
      const availableQuantity = Number.isFinite(stock) ? Math.max(stock, 0) : 0;
      const requiredQuantity = qtyPer * assembliesNeeded;
      const shortageValue = Math.max(0, requiredQuantity - availableQuantity);

      if (shortageValue <= 0) {
        return;
      }

      shortages.push({
        component: formatPart(item.component, item.componentDescription),
        quantity: shortageValue,
      });
    });

    if (shortages.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.textContent = 'All components are sufficiently stocked.';
      row.appendChild(cell);
      shortageBody.appendChild(row);
      return;
    }

    shortages.forEach((entry) => {
      const row = document.createElement('tr');

      const componentCell = document.createElement('td');
      componentCell.textContent = entry.component;
      row.appendChild(componentCell);

      const quantityCell = document.createElement('td');
      quantityCell.textContent = numberFormatter.format(entry.quantity);
      row.appendChild(quantityCell);

      shortageBody.appendChild(row);
    });
  };

  const showMessage = (message) => {
    tableBody.innerHTML = '';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = COLUMN_COUNT;
    cell.dataset.bomMessage = '';
    cell.textContent = message;
    row.appendChild(cell);
    tableBody.appendChild(row);

    currentItems = [];
    updateAssemblyDetail('', '');
    resetAvailability();
    closeModal();
  };

  const renderRows = (items) => {
    tableBody.innerHTML = '';

    if (!Array.isArray(items) || items.length === 0) {
      showMessage('No bill of materials records available.');
      return;
    }

    currentItems = items.slice();
    updateAssemblyDetail(items[0].assembly, items[0].assemblyDescription);
    updateAvailability(currentItems);

    currentItems.forEach((item) => {
      const row = document.createElement('tr');

      const cells = [
        formatPart(item.component, item.componentDescription),
        typeof item.availableQuantity === 'number' && Number.isFinite(item.availableQuantity)
          ? stockFormatter.format(item.availableQuantity)
          : '—',
        item.componentLocation && item.componentLocation.length > 0 ? item.componentLocation : '—',
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

  if (calculatorButton) {
    calculatorButton.addEventListener('click', () => {
      openModal();
    });
  }

  if (returnButton) {
    returnButton.addEventListener('click', () => {
      closeModal();
    });
  }

  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }

  if (calculatorForm) {
    calculatorForm.addEventListener('submit', (event) => {
      event.preventDefault();

      if (!calculatorForm.checkValidity()) {
        calculatorForm.reportValidity();
        return;
      }

      const requested = Math.floor(Number(quantityInput?.value ?? 0));

      if (!Number.isFinite(requested) || requested < 1) {
        calculatorForm.reportValidity();
        return;
      }

      if (quantityInput) {
        quantityInput.value = String(requested);
      }

      renderShortages(requested);
    });
  }

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
