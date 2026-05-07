const API_URL = 'https://script.google.com/macros/s/AKfycbzktCl5zINU3p1DUX4KKaIzgVHkB3YiJ_hwmKZ7hQBgZs69P6csIODeKGLBI-PmGgea/exec';
const AUTO_REFRESH_INTERVAL_MS = 15000;

const state = {
  records: [],
  query: '',
  filter: 'all',
  selectedId: '',
  isLoading: false,
};

const els = {
  wordList: document.querySelector('#wordList'),
  detailPanel: document.querySelector('#detailPanel'),
  summary: document.querySelector('#summary'),
  totalCount: document.querySelector('#totalCount'),
  newCount: document.querySelector('#newCount'),
  reviewedCount: document.querySelector('#reviewedCount'),
  search: document.querySelector('#search'),
  refresh: document.querySelector('#refresh'),
  shuffle: document.querySelector('#shuffle'),
  todayWord: document.querySelector('#todayWord'),
  pageTitle: document.querySelector('#pageTitle'),
  filters: [...document.querySelectorAll('.filter')],
};

els.search.addEventListener('input', event => {
  state.query = event.target.value.trim().toLowerCase();
  render();
});

els.refresh.addEventListener('click', loadRecords);
els.shuffle.addEventListener('click', selectRandomWord);

els.filters.forEach(button => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    state.selectedId = '';
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
    .map(record => ({
      ...record,
      id: record.id || record.word,
      status: record.status || 'new',
      reviewCount: Number(record.reviewCount || 0),
    }))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function render() {
  const filtered = filteredRecords();
  const selected = state.records.find(record => record.id === state.selectedId) || filtered[0];
  state.selectedId = selected?.id || '';

  els.filters.forEach(button => {
    button.classList.toggle('active', button.dataset.filter === state.filter);
  });

  els.pageTitle.textContent = titleForFilter(state.filter);
  els.totalCount.textContent = state.records.length;
  els.newCount.textContent = state.records.filter(record => record.status === 'new').length;
  els.reviewedCount.textContent = state.records.filter(record => record.reviewCount > 0).length;
  els.summary.textContent = `${filtered.length} word${filtered.length === 1 ? '' : 's'} shown`;
  els.todayWord.textContent = selected ? `${selected.word} · ${firstLine(selected.translation)}` : 'No saved words yet.';

  renderList(filtered);
  renderDetail(selected);
}

function filteredRecords() {
  return state.records.filter(record => {
    const matchesFilter = state.filter === 'all' || record.status === state.filter;
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
        <small>${escapeHtml(firstLine(record.translation) || 'No translation saved')}</small>
      </span>
      <span class="status ${escapeAttr(record.status)}">${escapeHtml(record.status)}</span>
    </button>
  `).join('');

  els.wordList.querySelectorAll('.word-row').forEach(row => {
    row.addEventListener('click', () => {
      state.selectedId = row.dataset.id;
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
      <p class="meaning">${escapeHtml(record.translation || 'No translation saved yet.')}</p>
    </section>

    <section class="detail-section compact">
      <div><span>Service</span><strong>${escapeHtml(record.service || 'Easydict')}</strong></div>
      <div><span>Language</span><strong>${escapeHtml(record.fromLanguage || 'auto')} -> ${escapeHtml(record.toLanguage || '')}</strong></div>
      <div><span>Saved</span><strong>${formatDate(record.createdAt)}</strong></div>
      <div><span>Reviews</span><strong>${record.reviewCount || 0}</strong></div>
    </section>

    <section class="detail-section">
      <h4>Review prompt</h4>
      <p class="prompt">Cover the meaning, say the word aloud, then explain it in your own sentence.</p>
    </section>

    <section class="detail-section">
      <h4>Actions</h4>
      <div class="detail-actions">
        <button type="button" data-action="review" data-status="learning">Reviewed</button>
        <button type="button" data-action="status" data-status="learning">Learning</button>
        <button type="button" data-action="status" data-status="mastered">Mastered</button>
        <button class="danger" type="button" data-action="delete">Delete</button>
      </div>
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

    render();
  } catch (error) {
    window.alert(`Action failed: ${error.message}`);
  } finally {
    button.disabled = false;
  }
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

function selectRandomWord() {
  const records = filteredRecords();
  if (!records.length) return;
  const index = Math.floor(Math.random() * records.length);
  state.selectedId = records[index].id;
  render();
}

function titleForFilter(filter) {
  return {
    all: 'All words',
    new: 'New words',
    learning: 'Learning',
    mastered: 'Mastered',
  }[filter] || 'All words';
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
