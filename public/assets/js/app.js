const LOCATION_LIMIT = 5000;

const referenceCache = {
  locations: [],
  locationsLoaded: false,
  locationsPromise: null,
};

const normalizeCode = (value) => String(value ?? '').trim();

const toLocationKey = (roomCode, locationCode) => {
  const safeRoom = normalizeCode(roomCode).toLowerCase();
  const safeLocation = normalizeCode(locationCode).toLowerCase();
  return `${safeRoom}::${safeLocation}`;
};

async function loadLocationsReference(limit = LOCATION_LIMIT) {
  if (referenceCache.locationsLoaded && Array.isArray(referenceCache.locations) && referenceCache.locations.length > 0) {
    return referenceCache.locations;
  }

  if (referenceCache.locationsPromise) {
    return referenceCache.locationsPromise;
  }

  referenceCache.locationsPromise = (async () => {
    const response = await fetch(`/api/locations?limit=${limit}`);

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const locations = Array.isArray(payload?.data) ? payload.data : [];
    referenceCache.locations = locations;
    referenceCache.locationsLoaded = true;
    return locations;
  })()
    .catch((error) => {
      console.error('Failed to load locations', error);
      referenceCache.locationsLoaded = false;
      referenceCache.locations = [];
      throw error;
    })
    .finally(() => {
      referenceCache.locationsPromise = null;
    });

  return referenceCache.locationsPromise;
}

const getCachedLocations = () => referenceCache.locations;

const buildLocationLookups = (locations = []) => {
  const byRoom = new Map();
  const byRoomAndLocation = new Map();

  locations.forEach((entry) => {
    const roomCode = normalizeCode(entry?.roomCode);
    const locationCode = normalizeCode(entry?.locationCode);

    if (roomCode && !byRoom.has(roomCode)) {
      byRoom.set(roomCode, entry);
    }

    if (locationCode) {
      const locationKey = toLocationKey(roomCode, locationCode);
      byRoomAndLocation.set(locationKey, entry);
      if (!roomCode) {
        byRoomAndLocation.set(toLocationKey('', locationCode), entry);
      }
    }
  });

  return { byRoom, byRoomAndLocation };
};

const applyLocationDisplays = (parts = [], locations = []) => {
  const { byRoom, byRoomAndLocation } = buildLocationLookups(locations);

  return parts.map((part) => {
    const roomCode = normalizeCode(part?.roomCode);
    const locationCode = normalizeCode(part?.locationCode);
    const roomLookup = byRoom.get(roomCode);
    const locationLookup =
      byRoomAndLocation.get(toLocationKey(roomCode, locationCode)) ||
      byRoomAndLocation.get(toLocationKey('', locationCode));

    const roomDisplay = roomLookup?.roomDisplay || (roomLookup?.roomCode ?? '') || part.room || roomCode;
    const locationDisplay =
      locationLookup?.locationDisplay || locationLookup?.locationCode || part.location || locationCode;

    return {
      ...part,
      room: roomDisplay,
      roomCode: roomCode || part.roomCode || '',
      location: locationDisplay,
      locationCode: locationCode || part.locationCode || '',
    };
  });
};

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
    initPartEditor();
  }

  if (bodyPage === 'dashboard') {
    initDashboardAdminTools();
  }
});

function initInventorySearch() {
  const searchInput = document.querySelector('#part-search');
  const descriptionInput = document.querySelector('#description-search');
  const inStockCheckbox = document.querySelector('#in-stock-filter');
  const limitCheckbox = document.querySelector('#limit-results');
  const resultsBody = document.querySelector('[data-part-results]');
  const controlContainers = document.querySelectorAll('[data-part-controls]');
  const totalTargets = document.querySelectorAll('[data-part-total]');
  const pageStatusTargets = document.querySelectorAll('[data-part-page-status]');
  const firstButtons = document.querySelectorAll('[data-page-action="first"]');
  const previousButtons = document.querySelectorAll('[data-page-action="previous"]');
  const nextButtons = document.querySelectorAll('[data-page-action="next"]');
  const lastButtons = document.querySelectorAll('[data-page-action="last"]');

  if (!searchInput || !resultsBody) {
    return;
  }

  const PAGE_SIZE = 25;
  const COLUMN_COUNT = 7;
  const quantityFormatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  let debounceTimer = 0;
  let activeController = null;
  let selectedRow = null;
  let selectedPartNumber = '';
  let lastParts = [];
  let currentPageIndex = 0;

  const getPartQuery = () => searchInput.value.trim();
  const getDescriptionQuery = () => (descriptionInput ? descriptionInput.value.trim() : '');
  const isInStockOnly = () => Boolean(inStockCheckbox?.checked);
  const shouldLimitResults = () => (limitCheckbox ? limitCheckbox.checked : true);
  const getTotalPages = () => (lastParts.length === 0 ? 0 : Math.ceil(lastParts.length / PAGE_SIZE));

  const resetControls = () => {
    currentPageIndex = 0;

    controlContainers.forEach((container) => {
      container.hidden = true;
    });

    totalTargets.forEach((target) => {
      target.hidden = true;
      target.textContent = '';
    });

    pageStatusTargets.forEach((target) => {
      target.hidden = true;
      target.textContent = '';
    });

    const allButtons = [...firstButtons, ...previousButtons, ...nextButtons, ...lastButtons];
    allButtons.forEach((button) => {
      button.disabled = true;
    });
  };

  const updateControls = () => {
    const totalParts = lastParts.length;

    if (totalParts === 0) {
      resetControls();
      return;
    }

    const totalPages = Math.max(1, getTotalPages());
    currentPageIndex = Math.min(Math.max(currentPageIndex, 0), totalPages - 1);
    const startIndex = currentPageIndex * PAGE_SIZE + 1;
    const endIndex = Math.min((currentPageIndex + 1) * PAGE_SIZE, totalParts);
    const isFirstPage = currentPageIndex === 0;
    const isLastPage = currentPageIndex === totalPages - 1;

    controlContainers.forEach((container) => {
      container.hidden = false;
    });

    totalTargets.forEach((target) => {
      target.hidden = false;
      target.textContent = `Showing ${startIndex}-${endIndex} of ${totalParts} parts`;
    });

    pageStatusTargets.forEach((target) => {
      target.hidden = false;
      target.textContent = `${currentPageIndex + 1} of ${totalPages}`;
    });

    const enableButtonState = (buttons, disabled) => {
      buttons.forEach((button) => {
        button.disabled = disabled;
      });
    };

    enableButtonState(firstButtons, isFirstPage);
    enableButtonState(previousButtons, isFirstPage);
    enableButtonState(nextButtons, isLastPage);
    enableButtonState(lastButtons, isLastPage);
  };

  const showPage = (pageIndex) => {
    const totalPages = getTotalPages();

    if (totalPages === 0) {
      resetControls();
      return;
    }

    currentPageIndex = Math.min(Math.max(pageIndex, 0), totalPages - 1);
    const start = currentPageIndex * PAGE_SIZE;
    const pageParts = lastParts.slice(start, start + PAGE_SIZE);
    renderRows(pageParts);
    updateControls();
  };

  firstButtons.forEach((button) => {
    button.addEventListener('click', () => {
      showPage(0);
    });
  });

  previousButtons.forEach((button) => {
    button.addEventListener('click', () => {
      showPage(currentPageIndex - 1);
    });
  });

  nextButtons.forEach((button) => {
    button.addEventListener('click', () => {
      showPage(currentPageIndex + 1);
    });
  });

  lastButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const totalPages = getTotalPages();
      if (totalPages > 0) {
        showPage(totalPages - 1);
      }
    });
  });

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
    resetControls();
    resultsBody.innerHTML = '';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = COLUMN_COUNT;
    cell.dataset.partMessage = '';
    cell.textContent = message;
    row.appendChild(cell);
    resultsBody.appendChild(row);

    lastParts = [];
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
              room: part.room,
              roomCode: part.roomCode,
              location: part.location,
              locationCode: part.locationCode,
              stockUom: part.stockUom,
              hasBom: Boolean(part.hasBom),
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
        quantityFormatter.format(quantityValue),
        part.stockUom,
        part.room,
        part.location,
        part.notes,
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

    if (!partQuery && !descriptionQuery && !inStockOnly) {
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

      if (!shouldLimitResults()) {
        params.set('limit', '5000');
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
      let parts = Array.isArray(payload.data) ? payload.data : [];

      try {
        const locations = await loadLocationsReference();
        parts = applyLocationDisplays(parts, locations);
      } catch (error) {
        console.error('Unable to align room and location data', error);
      }

      if (parts.length === 0) {
        showMessage('No parts matched your filters.');
        return;
      }

      lastParts = parts;
      showPage(0);
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

  if (limitCheckbox) {
    limitCheckbox.addEventListener('change', () => {
      window.clearTimeout(debounceTimer);
      void performSearch();
    });
  }

  document.addEventListener('inventory:part-changed', () => {
    window.clearTimeout(debounceTimer);
    void performSearch();
  });

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

function initPartEditor() {
  const addButton = document.querySelector('[data-part-add]');
  const modal = document.querySelector('[data-part-modal]');
  const modalTitle = modal?.querySelector('[data-part-modal-title]');
  const modalSubtitle = modal?.querySelector('[data-part-modal-subtitle]');
  const form = modal?.querySelector('[data-part-form]');
  const feedback = modal?.querySelector('[data-part-feedback]');
  const partNumberInput = modal?.querySelector('[data-part-number]');
  const descriptionInput = modal?.querySelector('[data-part-description]');
  const roomSelect = modal?.querySelector('[data-part-room]');
  const locationSelect = modal?.querySelector('[data-part-location]');
  const stockUomSelect = modal?.querySelector('[data-part-stockuom]');
  const partTypeSelect = modal?.querySelector('[data-part-type]');
  const attributeSection = modal?.querySelector('[data-part-attribute-section]');
  const attributeContainer = modal?.querySelector('[data-part-attributes]');
  const viewActions = modal?.querySelector('[data-part-view-actions]');
  const editActions = modal?.querySelector('[data-part-edit-actions]');
  const editButton = modal?.querySelector('[data-part-edit]');
  const closeButton = modal?.querySelector('[data-part-close]');
  const saveButton = modal?.querySelector('[data-part-save]');
  const cancelButton = modal?.querySelector('[data-part-cancel]');
  const typeWarning = modal?.querySelector('[data-part-type-warning]');

  if (
    !modal ||
    !form ||
    !feedback ||
    !partNumberInput ||
    !descriptionInput ||
    !roomSelect ||
    !locationSelect ||
    !stockUomSelect ||
    !partTypeSelect ||
    !attributeSection ||
    !attributeContainer ||
    !viewActions ||
    !editActions ||
    !editButton ||
    !closeButton ||
    !saveButton ||
    !cancelButton
  ) {
    return;
  }

  partTypeSelect.required = true;
  descriptionInput.readOnly = true;
  descriptionInput.setAttribute('aria-readonly', 'true');

  const state = {
    partTypes: [],
    partTypesLoaded: false,
    locations: [],
    locationsLoaded: false,
    uoms: [],
    uomsLoaded: false,
    currentPart: null,
    mode: 'view',
    attributeValues: new Map(),
  };

  const setFeedback = (message, tone = 'info') => {
    feedback.textContent = message || '';
    feedback.dataset.tone = tone;
  };

  const toggleModal = (visible) => {
    modal.hidden = !visible;
    document.body.classList.toggle('is-modal-open', visible);
  };

  const toNumber = (value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const normalizeAttributeCode = (code) => String(code ?? '').toLowerCase().replace(/_\d+$/, '');

  const toTitleCase = (value) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

  const formatAttributeLabel = (attribute) => {
    if (!attribute) return 'Attribute';
    const baseLabel = attribute.code ?? `Attribute ${attribute.attributeId}`;
    const normalizedCode = normalizeAttributeCode(baseLabel);
    const labelWithSpaces = (normalizedCode === 'subtype' ? baseLabel.replace(/_\d+$/, '') : baseLabel)
      .replace(/_/g, ' ')
      .trim();

    return toTitleCase(labelWithSpaces || `Attribute ${attribute.attributeId}`);
  };

  const parseAttributeDataType = (dataType) => {
    if (!dataType) {
      return { kind: 'text', options: [] };
    }

    const enumMatch = dataType.match(/^enum\s*\((.*)\)$/i);
    if (enumMatch) {
      const options = Array.from(enumMatch[1].matchAll(/'([^']+)'/g))
        .map((match) => match[1]?.trim())
        .filter(Boolean);
      return { kind: 'enum', options };
    }

    if (/^int\b/i.test(dataType)) {
      return { kind: 'int', options: [] };
    }

    if (/^double\b/i.test(dataType)) {
      return { kind: 'double', options: [] };
    }

    return { kind: 'text', options: [] };
  };

  const resolveRequirementState = (requiredRule, subtypeValue) => {
    const normalizedRule = typeof requiredRule === 'string' ? requiredRule.trim().toLowerCase() : '';
    if (!normalizedRule) {
      return { required: false, visible: true };
    }

    if (normalizedRule === 'yes') {
      return { required: true, visible: true };
    }

    if (normalizedRule === 'no') {
      return { required: false, visible: true };
    }

    const matches = Array.from(normalizedRule.matchAll(/'([^']+)'/g)).map((match) => match[1]?.trim().toLowerCase());
    const normalizedSubtype = (subtypeValue ?? '').trim().toLowerCase();

    if (matches.length > 0 && normalizedSubtype) {
      const matchFound = matches.some((entry) => entry === normalizedSubtype);
      return { required: matchFound, visible: matchFound };
    }

    return { required: false, visible: true };
  };

  const isSubtypeAttribute = (attribute) => normalizeAttributeCode(attribute?.code) === 'subtype';

  const isSubtypeComplete = (attribute, value) => {
    if (!attribute) return true;
    const trimmed = (value ?? '').trim();
    if (!trimmed) return false;

    const { kind, options } = parseAttributeDataType(attribute.dataType);
    if (kind === 'enum') {
      return options.length === 0 || options.some((option) => option.toLowerCase() === trimmed.toLowerCase());
    }

    if (kind === 'int') {
      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isNaN(parsed)) return false;
      if (typeof attribute.minValue === 'number' && parsed < attribute.minValue) return false;
      if (typeof attribute.maxValue === 'number' && parsed > attribute.maxValue) return false;
      return true;
    }

    if (kind === 'double') {
      const parsed = Number.parseFloat(trimmed);
      if (Number.isNaN(parsed)) return false;
      if (typeof attribute.minValue === 'number' && parsed < attribute.minValue) return false;
      if (typeof attribute.maxValue === 'number' && parsed > attribute.maxValue) return false;
      return true;
    }

    return true;
  };

  const prioritizeMountingStyleOptions = (options = []) => {
    const prioritized = [];
    const seen = new Set();
    const preferred = ['Surface Mount', 'Through-Hole'];

    preferred.forEach((label) => {
      const match = options.find((option) => String(option ?? '').toLowerCase() === label.toLowerCase());
      const valueToUse = match ?? label;
      const key = String(valueToUse).toLowerCase();
      if (!seen.has(key)) {
        prioritized.push(valueToUse);
        seen.add(key);
      }
    });

    options.forEach((option) => {
      const key = String(option ?? '').toLowerCase();
      if (!option || seen.has(key)) return;
      prioritized.push(option);
      seen.add(key);
    });

    return prioritized;
  };

  const prioritizeUomOptions = (options = []) => {
    const preferredCode = 'EA';
    const remaining = [];
    let preferred = null;

    options.forEach((entry) => {
      const code = String(entry?.code ?? '').trim();
      if (!preferred && code.toUpperCase() === preferredCode) {
        preferred = entry;
        return;
      }

      remaining.push(entry);
    });

    return preferred ? [preferred, ...remaining] : remaining;
  };

  const getAttributeWeight = (attribute) => {
    const code = normalizeAttributeCode(attribute?.code);
    if (code === 'alternate') return 2;
    if (code === 'notes') return 3;
    return 1;
  };

  const sortAttributesForDisplay = (attributes, indexLookup) => {
    const indexed = attributes.map((attribute) => ({
      attribute,
      order: indexLookup.get(attribute.attributeId) ?? 0,
      weight: getAttributeWeight(attribute),
    }));

    indexed.sort((a, b) => {
      if (a.weight !== b.weight) {
        return a.weight - b.weight;
      }

      return a.order - b.order;
    });

    return indexed.map((entry) => entry.attribute);
  };

  const getPackageOptionsForPartType = (partType) =>
    Array.isArray(partType?.packageOptions) ? partType.packageOptions : [];

  const loadPartTypes = async () => {
    if (state.partTypesLoaded) {
      return;
    }

    try {
      const response = await fetch('/api/part-types');

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      state.partTypes = Array.isArray(payload?.data) ? payload.data : [];
      state.partTypesLoaded = true;
    } catch (error) {
      console.error('Failed to load part types', error);
      setFeedback('Unable to load Part Types. Please try again.', 'error');
      state.partTypes = [];
    }
  };

  const renderPartTypeOptions = (selectedId) => {
    partTypeSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select Part Type';
    partTypeSelect.appendChild(placeholder);

    state.partTypes.forEach((entry) => {
      const option = document.createElement('option');
      option.value = String(entry.id);
      option.textContent = entry.sheetName || entry.code;
      option.selected = typeof selectedId === 'number' && entry.id === selectedId;
      partTypeSelect.appendChild(option);
    });
  };

  const loadLocations = async () => {
    if (state.locationsLoaded && state.locations.length > 0) {
      return;
    }

    try {
      const locations = await loadLocationsReference();
      state.locations = Array.isArray(locations) ? locations : [];
      state.locationsLoaded = true;
    } catch (error) {
      console.error('Failed to load locations', error);
      setFeedback('Unable to load Locations. Please try again.', 'error');
      state.locations = [];
      state.locationsLoaded = false;
    }
  };

  const getRooms = () => {
    const rooms = [];
    const seen = new Set();

    state.locations.forEach((entry) => {
      const key = String(entry?.roomCode ?? '').toLowerCase();
      if (!entry?.roomCode || seen.has(key)) return;
      rooms.push(entry);
      seen.add(key);
    });

    return rooms;
  };

  const renderRoomOptions = (selectedCode = '') => {
    roomSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select Room';
    roomSelect.appendChild(placeholder);

    const rooms = getRooms();
    let foundSelection = false;

    rooms.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.roomCode ?? '';
      option.textContent = entry.roomDisplay || entry.roomCode;
      if (typeof selectedCode === 'string' && selectedCode.toLowerCase() === entry.roomCode?.toLowerCase()) {
        option.selected = true;
        foundSelection = true;
      }
      roomSelect.appendChild(option);
    });

    if (selectedCode && !foundSelection) {
      const fallback = document.createElement('option');
      fallback.value = selectedCode;
      fallback.textContent = selectedCode;
      fallback.selected = true;
      roomSelect.appendChild(fallback);
    }
  };

  const renderLocationOptions = (roomCode = '', selectedCode = '') => {
    locationSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = roomCode ? 'Select Location' : 'Select Room First';
    locationSelect.appendChild(placeholder);

    const normalizedRoom = roomCode.toLowerCase();
    const filtered = roomCode
      ? state.locations.filter(
          (entry) =>
            normalizeCode(entry.roomCode).toLowerCase() === normalizedRoom && normalizeCode(entry.locationCode).length > 0,
        )
      : [];
    let foundSelection = false;

    filtered.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.locationCode ?? '';
      option.textContent = entry.locationDisplay || entry.locationCode;
      option.dataset.roomCode = entry.roomCode ?? '';
      if (typeof selectedCode === 'string' && selectedCode.toLowerCase() === entry.locationCode?.toLowerCase()) {
        option.selected = true;
        foundSelection = true;
      }
      locationSelect.appendChild(option);
    });

    if (selectedCode && !foundSelection) {
      const fallback = document.createElement('option');
      fallback.value = selectedCode;
      fallback.textContent = selectedCode;
      fallback.selected = true;
      locationSelect.appendChild(fallback);
    }

    const hasRoom = typeof roomCode === 'string' && roomCode.trim().length > 0;
    const hasLocations = filtered.length > 0 || Boolean(selectedCode);
    locationSelect.disabled = !hasRoom || !hasLocations;
  };

  const loadUoms = async () => {
    if (state.uomsLoaded) {
      return;
    }

    try {
      const response = await fetch('/api/uom?limit=5000');

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      state.uoms = Array.isArray(payload?.data) ? payload.data : [];
      state.uomsLoaded = true;
    } catch (error) {
      console.error('Failed to load units of measure', error);
      setFeedback('Unable to load Units of Measure. Please try again.', 'error');
      state.uoms = [];
    }
  };

  const renderUomOptions = (selectedCode = '') => {
    stockUomSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select Stock UOM';
    stockUomSelect.appendChild(placeholder);

    const options = prioritizeUomOptions(state.uoms);
    let foundSelection = false;

    options.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.code ?? '';
      option.textContent = entry.description ? `${entry.code} — ${entry.description}` : entry.code ?? '';
      option.selected = typeof selectedCode === 'string' && selectedCode === entry.code;
      if (option.selected) {
        foundSelection = true;
      }
      stockUomSelect.appendChild(option);
    });

    if (selectedCode && !foundSelection) {
      const fallback = document.createElement('option');
      fallback.value = selectedCode;
      fallback.textContent = selectedCode;
      fallback.selected = true;
      stockUomSelect.appendChild(fallback);
    }
  };

  const loadReferenceData = async () => {
    await Promise.all([loadPartTypes(), loadLocations(), loadUoms()]);
  };

  const shouldIncludeInDescription = (attribute) => {
    const code = normalizeAttributeCode(attribute?.code);
    return code !== 'alternate' && code !== 'notes';
  };

  const formatAttributeValue = (attribute, value) => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return '';
    const unit = typeof attribute?.unit === 'string' ? attribute.unit.trim() : '';
    return unit ? `${trimmed} ${unit}` : trimmed;
  };

  const computeDescriptionFromAttributes = (partTypeId, values) => {
    const partType = state.partTypes.find((entry) => entry.id === partTypeId);

    if (!partType || !Array.isArray(partType.attributes) || partType.attributes.length === 0) {
      return '';
    }

    const attributeValues = values instanceof Map ? values : new Map();
    const attributeIndexLookup = new Map(partType.attributes.map((attribute, index) => [attribute.attributeId, index]));
    const subtypeAttribute = partType.attributes.find((attribute) => isSubtypeAttribute(attribute));
    const subtypeValue = subtypeAttribute ? (attributeValues.get(subtypeAttribute.attributeId) ?? '').trim() : '';
    const descriptionParts = [];

    const partTypeLabel = partType.sheetName || partType.code || '';
    if (partTypeLabel) {
      descriptionParts.push(partTypeLabel);
    }

    if (subtypeAttribute) {
      const value = attributeValues.get(subtypeAttribute.attributeId) ?? '';
      const formatted = formatAttributeValue(subtypeAttribute, value);
      if (formatted) {
        descriptionParts.push(formatted);
      }
    }

    const sortedAttributes = sortAttributesForDisplay(
      partType.attributes.filter((attribute) => !subtypeAttribute || attribute.attributeId !== subtypeAttribute.attributeId),
      attributeIndexLookup,
    );

    sortedAttributes.forEach((attribute) => {
      if (!shouldIncludeInDescription(attribute)) {
        return;
      }

      const { visible } = resolveRequirementState(attribute.requiredRule, subtypeValue);
      if (!visible) {
        return;
      }

      const value = attributeValues.get(attribute.attributeId) ?? '';
      const formatted = formatAttributeValue(attribute, value);
      if (formatted) {
        descriptionParts.push(formatted);
      }
    });

    return descriptionParts.join(' ').replace(/\s+/g, ' ').trim();
  };

  const updateDescriptionFromAttributes = () => {
    const partTypeId = toNumber(partTypeSelect.value);
    const computed = computeDescriptionFromAttributes(partTypeId, state.attributeValues);
    const fallback = state.currentPart?.description ?? '';
    const nextDescription = computed || fallback;
    descriptionInput.value = nextDescription;
    descriptionInput.title = nextDescription;
    if (modalSubtitle) {
      modalSubtitle.textContent = nextDescription;
    }
  };

  const renderAttributes = (partTypeId, values = state.attributeValues) => {
    attributeContainer.innerHTML = '';
    const partType = state.partTypes.find((entry) => entry.id === partTypeId);

    if (!partType || !Array.isArray(partType.attributes) || partType.attributes.length === 0) {
      state.attributeValues = new Map();
      attributeSection.hidden = true;
      updateDescriptionFromAttributes();
      return;
    }

    attributeSection.hidden = false;

    const attributeValues = values instanceof Map ? new Map(values) : new Map();
    state.attributeValues = attributeValues;
    const attributeIndexLookup = new Map(partType.attributes.map((attribute, index) => [attribute.attributeId, index]));

    const buildAttributeField = (attribute, required) => {
      const field = document.createElement('div');
      field.className = 'modal__field';
      const label = document.createElement('label');
      label.className = 'modal__label';
      const labelId = `attribute-${attribute.attributeId}`;
      label.htmlFor = labelId;
      const labelText = formatAttributeLabel(attribute);
      label.textContent = labelText;

      if (required) {
        const requiredMark = document.createElement('span');
        requiredMark.className = 'field-required';
        requiredMark.textContent = ' *';
        label.appendChild(requiredMark);
      }

      const { kind, options } = parseAttributeDataType(attribute.dataType);
      const attributeCode = normalizeAttributeCode(attribute.code);
      const isPackageAttribute = attributeCode === 'package';
      let control;

      if (isPackageAttribute) {
        control = document.createElement('select');
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = `Select ${labelText}`;
        control.appendChild(placeholder);

        const packageOptions = getPackageOptionsForPartType(partType);
        packageOptions.forEach((entry) => {
          const opt = document.createElement('option');
          opt.value = entry.name;
          opt.textContent = entry.name;
          control.appendChild(opt);
        });

        control.value = attributeValues.get(attribute.attributeId) ?? '';
      } else if (kind === 'enum') {
        control = document.createElement('select');
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = `Select ${labelText}`;
        control.appendChild(placeholder);
        const optionList = attributeCode === 'mounting_style' ? prioritizeMountingStyleOptions(options) : options;
        optionList.forEach((option) => {
          const opt = document.createElement('option');
          opt.value = option;
          opt.textContent = option;
          control.appendChild(opt);
        });
        control.value = attributeValues.get(attribute.attributeId) ?? '';
      } else {
        control = document.createElement('input');
        control.type = kind === 'int' || kind === 'double' ? 'number' : 'text';
        control.inputMode = kind === 'int' ? 'numeric' : kind === 'double' ? 'decimal' : 'text';
        if (kind === 'int') {
          control.step = '1';
        } else if (kind === 'double') {
          control.step = 'any';
        }
        if (typeof attribute.minValue === 'number') {
          control.min = String(attribute.minValue);
        }
        if (typeof attribute.maxValue === 'number') {
          control.max = String(attribute.maxValue);
        }
        control.value = attributeValues.get(attribute.attributeId) ?? '';
      }

      control.id = labelId;
      control.dataset.attributeId = String(attribute.attributeId);
      control.dataset.partAttributeInput = 'true';
      control.required = Boolean(required);

      const handleChange = () => {
        attributeValues.set(attribute.attributeId, control.value.trim());
        state.attributeValues = attributeValues;
        if (isSubtypeAttribute(attribute)) {
          renderAttributes(partTypeId, attributeValues);
          return;
        }
        updateDescriptionFromAttributes();
      };

      control.addEventListener('input', handleChange);
      control.addEventListener('change', handleChange);

      field.appendChild(label);

      if ((kind === 'int' || kind === 'double') && attribute.unit) {
        const inputRow = document.createElement('div');
        inputRow.className = 'modal__input-with-unit';
        inputRow.appendChild(control);

        const unitLabel = document.createElement('span');
        unitLabel.className = 'modal__unit-label';
        unitLabel.textContent = attribute.unit;
        inputRow.appendChild(unitLabel);
        field.appendChild(inputRow);
      } else {
        field.appendChild(control);
      }

      attributeContainer.appendChild(field);
    };

    const subtypeAttribute = partType.attributes.find((attribute) => isSubtypeAttribute(attribute));
    const subtypeValue = subtypeAttribute ? attributeValues.get(subtypeAttribute.attributeId) ?? '' : '';
    const subtypeReady = isSubtypeComplete(subtypeAttribute, subtypeValue);

    if (subtypeAttribute) {
      buildAttributeField(subtypeAttribute, true);
    }

    if (!subtypeReady && subtypeAttribute) {
      attributeSection.hidden = false;
      updateDescriptionFromAttributes();
      return;
    }

    const sortedAttributes = sortAttributesForDisplay(
      partType.attributes.filter((attribute) => !subtypeAttribute || attribute.attributeId !== subtypeAttribute.attributeId),
      attributeIndexLookup,
    );

    sortedAttributes.forEach((attribute) => {
      const { required, visible } = resolveRequirementState(attribute.requiredRule, subtypeValue);
      if (!visible) {
        return;
      }
      buildAttributeField(attribute, required);
    });

    attributeSection.hidden = attributeContainer.children.length === 0;
    updateDescriptionFromAttributes();
  };

  const syncRoomAndLocationState = (isEditMode) => {
    const inEditMode = typeof isEditMode === 'boolean' ? isEditMode : state.mode !== 'view';
    const roomSelected = (roomSelect.value ?? '').trim().length > 0;
    const hasLocations = locationSelect.options.length > 1;

    roomSelect.disabled = !inEditMode;
    locationSelect.disabled = !inEditMode || !roomSelected || !hasLocations;
  };

  const setMode = (mode) => {
    state.mode = mode;
    const isEdit = mode !== 'view';
    const isCreate = mode === 'create';

    partNumberInput.disabled = !isCreate;
    descriptionInput.disabled = false;
    stockUomSelect.disabled = !isEdit;
    partTypeSelect.disabled = !isEdit;
    syncRoomAndLocationState(isEdit);

    const attributeInputs = attributeContainer.querySelectorAll('[data-part-attribute-input]');
    attributeInputs.forEach((input) => {
      input.disabled = !isEdit;
    });

    viewActions.hidden = isEdit;
    editActions.hidden = !isEdit;
    saveButton.textContent = isCreate ? 'Add' : 'Apply';
  };

  const resetForm = () => {
    form.reset();
    setFeedback('');
    state.currentPart = null;
    state.mode = 'create';
    state.attributeValues = new Map();
    renderPartTypeOptions();
    renderRoomOptions();
    renderLocationOptions();
    renderUomOptions();
    renderAttributes(null);
    updateDescriptionFromAttributes();
    if (modalTitle) {
      modalTitle.textContent = 'Add Part';
    }
    if (modalSubtitle) {
      modalSubtitle.textContent = '';
    }
    if (typeWarning) {
      typeWarning.hidden = true;
    }
    setMode('create');
  };

  const getAttributeValues = () => {
    const values = [];
    const inputs = attributeContainer.querySelectorAll('[data-part-attribute-input]');

    inputs.forEach((input) => {
      const attributeId = toNumber(input.dataset.attributeId);
      if (attributeId !== null) {
        values.push({ attributeId, value: input.value.trim() });
      }
    });

    return values;
  };

  const populateForm = (detail) => {
    const attributeMap = new Map();

    if (Array.isArray(detail?.attributes)) {
      detail.attributes.forEach((entry) => {
        attributeMap.set(entry.attributeId, (entry.value ?? '').trim());
      });
    }

    state.attributeValues = attributeMap;
    const roomCode = detail?.roomCode ?? '';
    const locationCode = detail?.locationCode ?? '';

    partNumberInput.value = detail?.partNumber ?? '';
    renderRoomOptions(roomCode);
    renderLocationOptions(roomCode, locationCode);
    renderUomOptions(detail?.stockUom ?? '');
    renderPartTypeOptions(detail?.partTypeId ?? null);
    renderAttributes(detail?.partTypeId ?? null, attributeMap);
    state.currentPart = detail ?? null;
    updateDescriptionFromAttributes();

    if (modalTitle) {
      modalTitle.textContent = detail?.partNumber ? `Part ${detail.partNumber}` : 'Part Details';
    }

    if (modalSubtitle) {
      modalSubtitle.textContent = descriptionInput.value;
    }

    const hasPartType = Boolean(detail?.partTypeId);

    if (typeWarning) {
      typeWarning.hidden = hasPartType;
    }

    if (hasPartType) {
      setMode('view');
      setFeedback('');
    } else {
      setMode('edit');
      setFeedback('A Part Type is required. Please select one to continue.', 'warning');
      window.requestAnimationFrame(() => {
        partTypeSelect.focus();
      });
    }
  };

  const closeModal = () => {
    toggleModal(false);
    setMode('view');
  };

  const openForCreate = async () => {
    await loadReferenceData();
    resetForm();
    toggleModal(true);
  };

  const openForPart = async (partNumber, overview = null) => {
    await loadReferenceData();

    if (!partNumber || partNumber.length === 0) {
      return;
    }

    form.reset();
    const initialRoomCode = overview?.roomCode ?? '';
    const initialLocationCode = overview?.locationCode ?? '';
    const initialStockUom = overview?.stockUom ?? '';
    const initialDescription = (overview?.description ?? '').trim();
    const initialPartNumber = (overview?.partNumber ?? partNumber).trim();
    state.currentPart = overview ?? null;
    partNumberInput.value = initialPartNumber;
    renderPartTypeOptions();
    renderRoomOptions(initialRoomCode);
    renderLocationOptions(initialRoomCode, initialLocationCode);
    renderUomOptions(initialStockUom);
    renderAttributes(null, new Map());
    if (initialDescription) {
      descriptionInput.value = initialDescription;
      descriptionInput.title = initialDescription;
      if (modalSubtitle) {
        modalSubtitle.textContent = initialDescription;
      }
    } else {
      updateDescriptionFromAttributes();
    }

    if (modalTitle) {
      modalTitle.textContent = initialPartNumber ? `Part ${initialPartNumber}` : 'Part Details';
    }

    setMode('view');
    setFeedback('Loading part details…');
    toggleModal(true);

    try {
      const response = await fetch(`/api/parts/${encodeURIComponent(partNumber)}`);

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      populateForm(payload?.data ?? null);
      setFeedback('');
    } catch (error) {
      console.error('Failed to load part detail', error);
      setFeedback('Unable to load part details.');
    }
  };

  const saveChanges = async () => {
    const partNumber = partNumberInput.value.trim();
    const description = descriptionInput.value.trim();
    const room = roomSelect.value.trim();
    const location = locationSelect.value.trim();
    const stockUom = stockUomSelect.value.trim();
    const revision = (state.currentPart?.revision ?? '').trim();
    const status = (state.currentPart?.status ?? '').trim();
    const partTypeId = toNumber(partTypeSelect.value);
    const attributes = getAttributeValues();

    if (!partNumber) {
      setFeedback('Part Number is required.', 'error');
      partNumberInput.focus();
      return;
    }

    if (partTypeId === null) {
      setFeedback('Part Type is required.', 'error');
      partTypeSelect.focus();
      return;
    }

    setFeedback('Saving…');

    const isCreate = state.mode === 'create';
    const endpoint = isCreate
      ? '/api/parts'
      : `/api/parts/${encodeURIComponent(state.currentPart?.partNumber ?? partNumber)}`;

    try {
      const response = await fetch(endpoint, {
        method: isCreate ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partNumber,
          description,
          room,
          location,
          revision,
          stockUom,
          status,
          partTypeId,
          attributes,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : 'Unable to save part.';
        throw new Error(message);
      }

      setFeedback(isCreate ? 'Part added.' : 'Changes applied.', 'success');
      populateForm(payload?.data ?? null);
      setMode('view');
      document.dispatchEvent(new CustomEvent('inventory:part-changed'));
    } catch (error) {
      console.error('Failed to save part', error);
      const message = error instanceof Error ? error.message : 'Unable to save part.';
      setFeedback(message, 'error');
    }
  };

  addButton?.addEventListener('click', () => {
    void openForCreate();
  });

  roomSelect.addEventListener('change', () => {
    const selectedRoom = roomSelect.value;
    renderLocationOptions(selectedRoom, '');
    syncRoomAndLocationState(state.mode !== 'view');
  });

  partTypeSelect.addEventListener('change', () => {
    const selectedId = toNumber(partTypeSelect.value);
    state.attributeValues = new Map();
    renderAttributes(selectedId, state.attributeValues);
    updateDescriptionFromAttributes();

    if (typeWarning) {
      typeWarning.hidden = selectedId !== null;
    }

    if (selectedId !== null) {
      setFeedback('');
    }
  });

  editButton.addEventListener('click', () => {
    setMode('edit');
  });

  saveButton.addEventListener('click', () => {
    void saveChanges();
  });

  closeButton.addEventListener('click', () => {
    closeModal();
  });

  cancelButton.addEventListener('click', () => {
    if (state.currentPart) {
      populateForm(state.currentPart);
      setMode('view');
    } else {
      closeModal();
    }
  });

  document.addEventListener('inventory:part-selected', (event) => {
    const detail = event.detail;
    if (detail?.hasBom) {
      return;
    }

    if (detail?.partNumber) {
      void openForPart(detail.partNumber, detail);
    }
  });
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
