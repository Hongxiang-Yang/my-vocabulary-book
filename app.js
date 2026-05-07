const API_URL = 'https://script.google.com/macros/s/AKfycbzktCl5zINU3p1DUX4KKaIzgVHkB3YiJ_hwmKZ7hQBgZs69P6csIODeKGLBI-PmGgea/exec';
const AUTO_REFRESH_INTERVAL_MS = 15000;
const THEME_KEY = 'hongxiang-vocabulary-theme';
const SIDEBAR_KEY = 'hongxiang-vocabulary-sidebar-collapsed';

const state = {
  records: [],
  query: '',
  filter: 'review',
  selectedId: '',
  isLoading: false,
  isRevealed: false,
  hasLoadedOnce: false,
};

const els = {
  wordList: document.querySelector('#wordList'),
  appShell: document.querySelector('#appShell'),
  loadingOverlay: document.querySelector('#loadingOverlay'),
  detailPanel: document.querySelector('#detailPanel'),
  summary: document.querySelector('#summary'),
  totalCount: document.querySelector('#totalCount'),
  learningCount: document.querySelector('#learningCount'),
  masteredCount: document.querySelector('#masteredCount'),
  search: document.querySelector('#search'),
  refresh: document.querySelector('#refresh'),
  reveal: document.querySelector('#reveal'),
  markMastered: document.querySelector('#markMastered'),
  todayWord: document.querySelector('#todayWord'),
  reviewMeaning: document.querySelector('#reviewMeaning'),
  pageTitle: document.querySelector('#pageTitle'),
  themeSelect: document.querySelector('#themeSelect'),
  sidebarToggle: document.querySelector('#sidebarToggle'),
  sidebarToggleIcon: document.querySelector('#sidebarToggleIcon'),
  filters: [...document.querySelectorAll('.filter')],
};

const savedTheme = localStorage.getItem(THEME_KEY) || 'mist';
document.documentElement.dataset.theme = savedTheme;
els.themeSelect.value = savedTheme;

const savedSidebarCollapsed = localStorage.getItem(SIDEBAR_KEY) === 'true';
els.appShell.classList.toggle('sidebar-collapsed', savedSidebarCollapsed);
els.sidebarToggle.setAttribute('aria-expanded', String(!savedSidebarCollapsed));
updateSidebarToggleIcon(savedSidebarCollapsed);

els.themeSelect.addEventListener('change', event => {
  const theme = event.target.value;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
});

els.sidebarToggle.addEventListener('click', () => {
  const collapsed = !els.appShell.classList.contains('sidebar-collapsed');
  els.appShell.classList.toggle('sidebar-collapsed', collapsed);
  els.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  updateSidebarToggleIcon(collapsed);
  localStorage.setItem(SIDEBAR_KEY, String(collapsed));
});

els.search.addEventListener('input', event => {
  state.query = event.target.value.trim().toLowerCase();
  render();
});

els.refresh.addEventListener('click', () => loadRecords());
els.reveal.addEventListener('click', async () => {
  if (state.isRevealed) {
    moveToNextReviewWord();
    return;
  }

  const record = state.records.find(item => item.id === state.selectedId);
  if (record && !state.isRevealed && record.status !== 'mastered') {
    await applyRecordAction(record, 'review', 'learning', { keepRevealed: true });
  }
  state.isRevealed = true;
  render();
});
els.markMastered.addEventListener('click', () => reviewSelected('mastered'));

els.filters.forEach(button => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    state.selectedId = '';
    state.isRevealed = false;
    render();
  });
});

loadRecords();

setInterval(() => {
  if (!document.hidden) {
    loadRecords({ silent: true });
  }
}, AUTO_REFRESH_INTERVAL_MS);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    loadRecords({ silent: true });
  }
});

async function loadRecords(options = {}) {
  if (API_URL.includes('PASTE_YOUR')) {
    els.wordList.innerHTML = '<div class="empty">Paste your Google Apps Script URL into app.js first.</div>';
    els.summary.textContent = 'Waiting for API setup';
    return;
  }

  if (state.isLoading) {
    return;
  }

  state.isLoading = true;
  if (!options.silent) {
    els.summary.textContent = 'Loading saved words...';
  }

  try {
    const data = await loadJsonp(API_URL);
    state.records = normalizeRecords(data.records || []);
    render();
  } catch (error) {
    if (!options.silent) {
      els.wordList.innerHTML = `<div class="empty">Could not load words. ${escapeHtml(error.message)}</div>`;
      els.summary.textContent = 'Connection failed';
    }
  } finally {
    state.isLoading = false;
    finishInitialLoading();
  }
}

function loadJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `vocabCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const separator = url.includes('?') ? '&' : '?';

    window[callbackName] = data => {
      delete window[callbackName];
      script.remove();
      resolve(data);
    };

    script.onerror = () => {
      delete window[callbackName];
      script.remove();
      reject(new Error('Unable to load vocabulary data'));
    };

    script.src = `${url}${separator}callback=${callbackName}`;
    document.body.appendChild(script);
  });
}

function normalizeRecords(records) {
  return records
    .filter(record => record.word)
    .map(record => {
      const status = record.status === 'mastered' ? 'mastered' : 'learning';
      return {
        ...record,
        id: record.id || record.word,
        status,
        reviewCount: Number(record.reviewCount || 0),
      };
    })
    .sort(sortRecords);
}

function render() {
  const filtered = filteredRecords();
  const selected = selectedRecord(filtered);
  state.selectedId = selected?.id || '';
  els.appShell.classList.toggle('review-mode', state.filter === 'review');

  els.filters.forEach(button => {
    button.classList.toggle('active', button.dataset.filter === state.filter);
  });

  const learningRecords = state.records.filter(record => record.status !== 'mastered');
  const masteredRecords = state.records.filter(record => record.status === 'mastered');

  els.pageTitle.textContent = titleForFilter(state.filter);
  els.totalCount.textContent = state.records.length;
  els.learningCount.textContent = learningRecords.length;
  els.masteredCount.textContent = masteredRecords.length;
  els.summary.textContent = summaryText(filtered, learningRecords);
  els.todayWord.textContent = selected ? deckText(selected) : 'No learning words yet.';
  els.reviewMeaning.textContent = selected ? reviewMeaningText(selected) : '';
  els.reviewMeaning.classList.toggle('visible', Boolean(selected && state.filter === 'review' && state.isRevealed));

  renderList(filtered);
  renderDetail(selected);
  updateReviewControls(selected);
}

function selectedRecord(filtered) {
  const existing = state.records.find(record => record.id === state.selectedId);
  if (existing && filtered.some(record => record.id === existing.id)) {
    return existing;
  }

  return filtered[0] || null;
}

function filteredRecords() {
  return state.records.filter(record => {
    const matchesFilter = (
      state.filter === 'all' ||
      (state.filter === 'review' && record.status !== 'mastered') ||
      (state.filter === 'mastered' && record.status === 'mastered')
    );
    const searchable = `${record.word} ${record.translation} ${record.service}`.toLowerCase();
    return matchesFilter && searchable.includes(state.query);
  });
}

function renderList(records) {
  if (!records.length) {
    els.wordList.innerHTML = '<div class="empty">No words match this view.</div>';
    return;
  }

  els.wordList.innerHTML = records.map(record => `
    <button class="word-row ${record.id === state.selectedId ? 'selected' : ''}" type="button" data-id="${escapeAttr(record.id)}">
      <span class="word-row-main">
        <strong>${escapeHtml(record.word)}</strong>
        <small>${escapeHtml(listSubtitle(record))}</small>
      </span>
      <span class="status ${escapeAttr(record.status)}">${escapeHtml(record.status)}</span>
    </button>
  `).join('');

  els.wordList.querySelectorAll('.word-row').forEach(row => {
    row.addEventListener('click', () => {
      state.selectedId = row.dataset.id;
      state.isRevealed = false;
      render();
    });
  });
}

function renderDetail(record) {
  if (!record) {
    els.detailPanel.innerHTML = `
      <div class="empty-detail">
        <span>Choose a word</span>
        <p>Its meaning, source, and review notes will appear here.</p>
      </div>
    `;
    return;
  }

  const shouldHideMeaning = state.filter === 'review' && !state.isRevealed && record.status !== 'mastered';
  const meaning = shouldHideMeaning ? 'Meaning hidden. Try recalling it first, then reveal.' : (record.translation || 'No translation saved yet.');

  els.detailPanel.innerHTML = `
    <div class="detail-head">
      <div>
        <span class="eyebrow">Selected word</span>
        <h3>${escapeHtml(record.word)}</h3>
      </div>
      <span class="status ${escapeAttr(record.status)}">${escapeHtml(record.status)}</span>
    </div>

    <section class="detail-section">
      <h4>Meaning</h4>
      <p class="meaning ${shouldHideMeaning ? 'masked' : ''}">${escapeHtml(meaning)}</p>
    </section>

    <section class="detail-section compact">
      <div><span>Service</span><strong>${escapeHtml(record.service || 'Hongxiang dict')}</strong></div>
      <div><span>Language</span><strong>${escapeHtml(record.fromLanguage || 'auto')} -> ${escapeHtml(record.toLanguage || '')}</strong></div>
      <div><span>Saved</span><strong>${formatDate(record.createdAt)}</strong></div>
      <div><span>Reviews</span><strong>${record.reviewCount || 0}</strong></div>
    </section>

    <section class="detail-section">
      <h4>Check</h4>
      <p class="prompt">Recall the meaning first. Reveal it, then keep it in Learning or move it to Mastered.</p>
    </section>

    <section class="detail-section">
      <h4>Actions</h4>
      ${actionsMarkup(record)}
    </section>
  `;

  els.detailPanel.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => handleRecordAction(record, button));
  });
}

async function handleRecordAction(record, button) {
  const action = button.dataset.action;
  const status = button.dataset.status || record.status || 'learning';

  if (action === 'delete') {
    const confirmed = window.confirm(`Delete "${record.word}" from your vocabulary book?`);
    if (!confirmed) return;
  }

  button.disabled = true;
  try {
    await applyRecordAction(record, action, status);
  } catch (error) {
    window.alert(`Action failed: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function reviewSelected(status) {
  const record = state.records.find(item => item.id === state.selectedId);
  if (!record) return;
  const action = status === 'mastered' && state.isRevealed ? 'status' : 'review';
  await applyRecordAction(record, action, status);
}

async function applyRecordAction(record, action, status, options = {}) {
  await postAction({
    action,
    status,
    word: record.word,
  });

  if (action === 'delete') {
    state.records = state.records.filter(item => item.id !== record.id);
    state.selectedId = '';
  } else if (action === 'review') {
    record.status = status;
    record.reviewCount = Number(record.reviewCount || 0) + 1;
    record.lastReviewedAt = new Date().toISOString();
  } else if (action === 'status') {
    record.status = status;
  }

  state.records.sort(sortRecords);
  state.isRevealed = Boolean(options.keepRevealed);
  render();
}

async function postAction(payload) {
  const url = new URL(API_URL);
  Object.entries(payload).forEach(([key, value]) => {
    url.searchParams.set(key, value || '');
  });

  const data = await loadJsonp(url.toString());
  if (!data.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function updateReviewControls(record) {
  const canReview = Boolean(record);
  els.reveal.disabled = !canReview;
  els.reveal.textContent = state.isRevealed ? 'Next' : 'Reveal';
  els.markMastered.disabled = !canReview;
}

function titleForFilter(filter) {
  return {
    review: 'Check mastery',
    mastered: 'Mastered',
    all: 'All words',
  }[filter] || 'Check mastery';
}

function listSubtitle(record) {
  if (state.filter === 'review') {
    return record.id === state.selectedId ? 'Selected for mastery check' : 'Meaning hidden for check';
  }

  return firstLine(record.translation) || 'No translation saved';
}

function summaryText(filtered, learningRecords) {
  if (state.filter === 'review') {
    return `${learningRecords.length} word${learningRecords.length === 1 ? '' : 's'} waiting for check`;
  }
  return `${filtered.length} word${filtered.length === 1 ? '' : 's'} shown`;
}

function deckText(record) {
  if (state.filter === 'review') {
    return record.word;
  }
  return `${record.word} · ${firstLine(record.translation)}`;
}

function reviewMeaningText(record) {
  if (state.filter !== 'review' || !state.isRevealed) {
    return '';
  }

  return record.translation || 'No translation saved yet.';
}

function actionsMarkup(record) {
  if (record.status === 'mastered') {
    return `
      <div class="detail-actions two-actions">
        <button type="button" data-action="status" data-status="learning">Keep learning</button>
        <button class="danger" type="button" data-action="delete">Delete</button>
      </div>
    `;
  }

  return `
    <div class="detail-actions">
      <button type="button" data-action="review" data-status="mastered">Mark mastered</button>
      <button class="danger" type="button" data-action="delete">Delete</button>
    </div>
  `;
}

function sortRecords(a, b) {
  const statusA = a.status === 'mastered' ? 1 : 0;
  const statusB = b.status === 'mastered' ? 1 : 0;
  if (statusA !== statusB) {
    return statusA - statusB;
  }

  if (statusA === 0) {
    return dateValue(a.lastReviewedAt) - dateValue(b.lastReviewedAt)
      || dateValue(b.createdAt) - dateValue(a.createdAt);
  }

  return dateValue(b.lastReviewedAt || b.createdAt) - dateValue(a.lastReviewedAt || a.createdAt);
}

function dateValue(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function updateSidebarToggleIcon(collapsed) {
  els.sidebarToggleIcon.textContent = collapsed ? '|›' : '‹|';
}

function moveToNextReviewWord() {
  const reviewRecords = state.records.filter(record => record.status !== 'mastered');
  if (!reviewRecords.length) return;

  const currentIndex = reviewRecords.findIndex(record => record.id === state.selectedId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % reviewRecords.length : 0;
  state.selectedId = reviewRecords[nextIndex].id;
  state.isRevealed = false;
  render();
}

function finishInitialLoading() {
  if (state.hasLoadedOnce) return;

  state.hasLoadedOnce = true;
  document.body.classList.remove('initial-loading');
  els.loadingOverlay?.classList.add('hidden');
}

function firstLine(value) {
  return String(value || '').split('\n').find(Boolean) || '';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
