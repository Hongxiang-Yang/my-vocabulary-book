const API_URL = 'https://script.google.com/macros/s/AKfycbwxWjvL0dOFZKD3q0i0e2rrKqNZTo90HSa3szxh9Y68OMMTDiTYrN_R6RKdgyUouEha/exec';
const AUTO_REFRESH_INTERVAL_MS = 60000;
const THEME_KEY = 'hongxiang-vocabulary-theme';
const SIDEBAR_KEY = 'hongxiang-vocabulary-sidebar-collapsed';
const SOUND_KEY = 'hongxiang-vocabulary-sound-enabled';
const RECORDS_CACHE_KEY = 'hongxiang-vocabulary-records-cache';
const PENDING_ACTIONS_KEY = 'hongxiang-vocabulary-pending-actions';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const WRITE_FLUSH_DELAY_MS = 650;
const LOOKUP_DEBOUNCE_MS = 520;
const PRONUNCIATION_DELAY_MS = 180;
const DICTIONARY_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const TRANSLATION_API_URL = 'https://api.mymemory.translated.net/get';

const state = {
  records: [],
  query: '',
  filter: 'review',
  selectedId: '',
  isLoading: false,
  isRevealed: false,
  isSoundEnabled: readSoundPreference(),
  hasLoadedOnce: false,
  reviewSignature: '',
  spokenWordSignature: '',
  pendingActions: readPendingActions(),
  flushTimer: 0,
  pronunciationTimer: 0,
  pronunciationAudio: null,
  pronunciationAudioCache: new Map(),
  audioContext: null,
  isFlushing: false,
  manualLookupTimer: 0,
  lookupAbortController: null,
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
  playPronunciation: document.querySelector('#playPronunciation'),
  todayWord: document.querySelector('#todayWord'),
  reviewMeaning: document.querySelector('#reviewMeaning'),
  reviewDeck: document.querySelector('#reviewDeck'),
  pageTitle: document.querySelector('#pageTitle'),
  themeSelect: document.querySelector('#themeSelect'),
  soundToggle: document.querySelector('#soundToggle'),
  sidebarToggle: document.querySelector('#sidebarToggle'),
  sidebarToggleIcon: document.querySelector('#sidebarToggleIcon'),
  addWordForm: document.querySelector('#addWordForm'),
  manualWord: document.querySelector('#manualWord'),
  manualMeaning: document.querySelector('#manualMeaning'),
  lookupWord: document.querySelector('#lookupWord'),
  lookupStatus: document.querySelector('#lookupStatus'),
  saveWord: document.querySelector('#saveWord'),
  clearManualWord: document.querySelector('#clearManualWord'),
  filters: [...document.querySelectorAll('.filter')],
};

const savedTheme = localStorage.getItem(THEME_KEY) || 'mist';
document.documentElement.dataset.theme = savedTheme;
els.themeSelect.value = savedTheme;
updateSoundToggle();

const savedSidebarCollapsed = localStorage.getItem(SIDEBAR_KEY) === 'true';
els.appShell.classList.toggle('sidebar-collapsed', savedSidebarCollapsed);
els.sidebarToggle.setAttribute('aria-expanded', String(!savedSidebarCollapsed));
updateSidebarToggleIcon(savedSidebarCollapsed);

els.themeSelect.addEventListener('change', event => {
  const theme = event.target.value;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
});

els.soundToggle.addEventListener('change', () => {
  state.isSoundEnabled = els.soundToggle.checked;
  writeSoundPreference(state.isSoundEnabled);
  updateSoundToggle();
  updateReviewControls(state.records.find(record => record.id === state.selectedId));

  if (state.isSoundEnabled) {
    state.spokenWordSignature = '';
    queueAutoPronunciation(state.records.find(record => record.id === state.selectedId));
  } else {
    stopPronunciation();
  }
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
els.manualWord.addEventListener('input', () => {
  scheduleManualLookup();
  updateSaveState();
});
els.manualMeaning.addEventListener('input', updateSaveState);
els.lookupWord.addEventListener('click', () => lookupManualWord());
els.addWordForm.addEventListener('submit', event => {
  event.preventDefault();
  saveManualWord();
});
els.clearManualWord.addEventListener('click', resetManualForm);
els.playPronunciation.addEventListener('click', () => {
  const record = state.records.find(item => item.id === state.selectedId);
  if (!record) return;
  state.spokenWordSignature = '';
  playPronunciation(record.word);
});
els.reveal.addEventListener('click', async () => {
  if (state.isRevealed) {
    playButtonSound('next');
    moveToNextReviewWord();
    return;
  }

  playButtonSound('reveal');
  const record = state.records.find(item => item.id === state.selectedId);
  if (record && !state.isRevealed && record.status !== 'mastered') {
    await applyRecordAction(record, 'review', 'learning', { keepRevealed: true });
  }
  state.isRevealed = true;
  render();
});
els.markMastered.addEventListener('click', () => {
  playButtonSound('master');
  reviewSelected('mastered');
});

els.filters.forEach(button => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    state.selectedId = '';
    state.isRevealed = false;
    render();
    if (state.filter === 'add') {
      window.setTimeout(() => els.manualWord.focus(), 0);
    }
  });
});

loadCachedRecords();
loadRecords({ silent: state.hasLoadedOnce });
scheduleActionFlush(0);

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
    writeRecordsCache(state.records);
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
  els.appShell.classList.toggle('add-mode', state.filter === 'add');

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
  animateReviewChange(selected);

  renderList(filtered);
  renderDetail(selected);
  updateReviewControls(selected);
  queueAutoPronunciation(selected);
}

function selectedRecord(filtered) {
  const existing = state.records.find(record => record.id === state.selectedId);
  if (existing && filtered.some(record => record.id === existing.id)) {
    return existing;
  }

  return filtered[0] || null;
}

function filteredRecords() {
  if (state.filter === 'add') {
    return state.records;
  }

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
  const previousRecords = state.records.map(item => ({ ...item }));
  const previousSelectedId = state.selectedId;
  const now = new Date().toISOString();

  if (action === 'delete') {
    state.records = state.records.filter(item => item.id !== record.id);
    state.selectedId = '';
  } else if (action === 'review') {
    record.status = status;
    record.reviewCount = Number(record.reviewCount || 0) + 1;
    record.lastReviewedAt = now;
  } else if (action === 'status') {
    record.status = status;
  }

  state.records.sort(sortRecords);
  state.isRevealed = Boolean(options.keepRevealed);
  writeRecordsCache(state.records);
  render();

  enqueueAction({
    action,
    status,
    word: record.word,
  }, () => {
    state.records = previousRecords;
    state.selectedId = previousSelectedId;
    writeRecordsCache(state.records);
    render();
  });
}

function enqueueAction(payload, rollback) {
  state.pendingActions.push({
    ...payload,
    queuedAt: Date.now(),
  });
  writePendingActions();
  scheduleActionFlush();
  flushActions().catch(error => {
    rollback?.();
    window.alert(`Action failed: ${error.message}`);
  });
}

function scheduleActionFlush(delay = WRITE_FLUSH_DELAY_MS) {
  window.clearTimeout(state.flushTimer);
  state.flushTimer = window.setTimeout(() => {
    flushActions().catch(error => {
      console.warn('Vocabulary sync failed', error);
    });
  }, delay);
}

async function flushActions() {
  if (state.isFlushing || !state.pendingActions.length) {
    return;
  }

  state.isFlushing = true;
  const actions = state.pendingActions.slice(0, 12);

  try {
    if (actions.length === 1) {
      await postAction(actions[0]);
    } else {
      await postAction({
        action: 'batch',
        items: JSON.stringify(actions),
      });
    }
    state.pendingActions.splice(0, actions.length);
    writePendingActions();
  } finally {
    state.isFlushing = false;
  }

  if (state.pendingActions.length) {
    scheduleActionFlush(0);
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

function loadCachedRecords() {
  const cached = readRecordsCache();
  if (!cached.length) return;

  state.records = cached;
  render();
  finishInitialLoading();
}

function readRecordsCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(RECORDS_CACHE_KEY) || 'null');
    if (!cached || Date.now() - Number(cached.savedAt || 0) > CACHE_MAX_AGE_MS) {
      return [];
    }
    return normalizeRecords(cached.records || []);
  } catch (error) {
    return [];
  }
}

function writeRecordsCache(records) {
  try {
    localStorage.setItem(RECORDS_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      records,
    }));
  } catch (error) {
    localStorage.removeItem(RECORDS_CACHE_KEY);
  }
}

function readPendingActions() {
  try {
    const actions = JSON.parse(localStorage.getItem(PENDING_ACTIONS_KEY) || '[]');
    return Array.isArray(actions) ? actions : [];
  } catch (error) {
    return [];
  }
}

function writePendingActions() {
  try {
    localStorage.setItem(PENDING_ACTIONS_KEY, JSON.stringify(state.pendingActions));
  } catch (error) {
    localStorage.removeItem(PENDING_ACTIONS_KEY);
  }
}

function readSoundPreference() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'false';
  } catch (error) {
    return true;
  }
}

function writeSoundPreference(isEnabled) {
  try {
    localStorage.setItem(SOUND_KEY, String(isEnabled));
  } catch (error) {
    localStorage.removeItem(SOUND_KEY);
  }
}

function updateSoundToggle() {
  els.soundToggle.checked = state.isSoundEnabled;
  els.soundToggle.setAttribute(
    'aria-label',
    state.isSoundEnabled ? 'Turn sound off' : 'Turn sound on',
  );
}

function queueAutoPronunciation(record) {
  if (!state.isSoundEnabled || !record || state.filter === 'add') {
    window.clearTimeout(state.pronunciationTimer);
    return;
  }

  const signature = `${state.filter}:${record.id}:${record.word}`;
  if (signature === state.spokenWordSignature) {
    return;
  }

  state.spokenWordSignature = signature;
  window.clearTimeout(state.pronunciationTimer);
  state.pronunciationTimer = window.setTimeout(() => {
    playPronunciation(record.word);
  }, PRONUNCIATION_DELAY_MS);
}

async function playPronunciation(word) {
  if (!state.isSoundEnabled || !word) {
    return;
  }

  stopPronunciationPlayback();

  const audioUrl = await pronunciationAudioUrl(word);
  if (!state.isSoundEnabled) {
    return;
  }

  if (audioUrl) {
    try {
      await playPronunciationAudio(audioUrl);
      return;
    } catch (error) {
      if (error?.name === 'NotAllowedError') {
        return;
      }
      console.warn('Dictionary pronunciation failed, falling back to speech synthesis', error);
    }
  }

  speakWord(word);
}

async function pronunciationAudioUrl(word) {
  if (!isSingleEnglishWord(word)) {
    return '';
  }

  const key = word.toLowerCase();
  if (state.pronunciationAudioCache.has(key)) {
    return state.pronunciationAudioCache.get(key);
  }

  try {
    const response = await fetch(`${DICTIONARY_API_BASE}${encodeURIComponent(key)}`);
    if (!response.ok) {
      throw new Error('Pronunciation lookup failed');
    }

    const data = await response.json();
    const entries = Array.isArray(data) ? data : [];
    const audioUrl = entries
      .flatMap(entry => entry.phonetics || [])
      .map(phonetic => String(phonetic.audio || '').trim())
      .find(url => url);
    const normalizedUrl = normalizeAudioUrl(audioUrl || '');
    state.pronunciationAudioCache.set(key, normalizedUrl);
    return normalizedUrl;
  } catch (error) {
    state.pronunciationAudioCache.set(key, '');
    return '';
  }
}

function normalizeAudioUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  return /^https?:\/\//i.test(url) ? url : '';
}

async function playPronunciationAudio(url) {
  const audio = document.createElement('audio');
  audio.src = url;
  audio.preload = 'auto';
  audio.volume = 0.86;
  state.pronunciationAudio = audio;
  await audio.play();
}

function speakWord(word) {
  if (!state.isSoundEnabled || !word || !('speechSynthesis' in window)) {
    return;
  }

  const voice = preferredSpeechVoice(word);
  if (!voice && looksLikeEnglishText(word)) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = voice?.lang || (looksLikeEnglishText(word) ? 'en-US' : 'zh-CN');
  if (voice) {
    utterance.voice = voice;
  }
  utterance.rate = 0.96;
  utterance.pitch = 1;
  utterance.volume = 0.88;
  window.speechSynthesis.speak(utterance);
}

function stopPronunciation() {
  window.clearTimeout(state.pronunciationTimer);
  stopPronunciationPlayback();
}

function stopPronunciationPlayback() {
  if (state.pronunciationAudio) {
    state.pronunciationAudio.pause();
    state.pronunciationAudio.currentTime = 0;
    state.pronunciationAudio = null;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

function preferredSpeechVoice(word) {
  if (!('speechSynthesis' in window)) {
    return null;
  }

  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) {
    return null;
  }

  const isEnglish = looksLikeEnglishText(word);
  const candidates = voices.filter(voice => (
    isEnglish ? /^en[-_]/i.test(voice.lang) : /^zh[-_]/i.test(voice.lang)
  ));
  const naturalCandidates = candidates.filter(voice => !isNoveltyVoice(voice));

  return naturalCandidates.find(voice => (
    /^(Samantha|Alex|Daniel|Karen|Moira|Tessa|Serena)$/i.test(voice.name)
    || /Microsoft (Jenny|Aria|Guy|Libby|Ryan|Sonia)/i.test(voice.name)
    || /Google (US|UK|Australian) English/i.test(voice.name)
    || /Natural|Premium|Enhanced/i.test(voice.name)
  ))
    || naturalCandidates.find(voice => /en[-_]US/i.test(voice.lang))
    || naturalCandidates.find(voice => /en[-_]GB/i.test(voice.lang))
    || naturalCandidates[0]
    || null;
}

function isNoveltyVoice(voice) {
  return /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Fred|Good News|Hysterical|Junior|Jester|Organ|Pipe Organ|Princess|Ralph|Superstar|Trinoids|Whisper|Zarvox/i.test(voice.name);
}

function playButtonSound(type) {
  if (!state.isSoundEnabled) {
    return;
  }

  const audioContext = ensureAudioContext();
  if (!audioContext) {
    return;
  }

  if (audioContext.state === 'suspended') {
    audioContext.resume()
      .then(() => playSoundSequence(audioContext, type))
      .catch(() => {});
    return;
  }

  playSoundSequence(audioContext, type);
}

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  if (!state.audioContext) {
    state.audioContext = new AudioContextClass();
  }

  return state.audioContext;
}

function playSoundSequence(audioContext, type) {
  const sounds = {
    reveal: [
      { frequency: 620, endFrequency: 430, duration: 0.11, offset: 0, type: 'triangle', peak: 0.038 },
      { frequency: 740, endFrequency: 520, duration: 0.07, offset: 0.035, type: 'sine', peak: 0.024 },
    ],
    next: [
      { frequency: 520, endFrequency: 760, duration: 0.075, offset: 0, type: 'sine', peak: 0.033 },
      { frequency: 880, duration: 0.055, offset: 0.065, type: 'sine', peak: 0.026 },
    ],
    master: [
      { frequency: 659, duration: 0.09, offset: 0, type: 'sine', peak: 0.032 },
      { frequency: 784, duration: 0.11, offset: 0.075, type: 'sine', peak: 0.032 },
      { frequency: 988, duration: 0.14, offset: 0.155, type: 'triangle', peak: 0.026 },
    ],
  };

  const sequence = sounds[type] || sounds.reveal;
  const start = audioContext.currentTime + 0.012;
  sequence.forEach(tone => {
    playTone(audioContext, tone, start);
  });
}

function playTone(audioContext, tone, start) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const toneStart = start + tone.offset;
  const toneEnd = toneStart + tone.duration;

  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
  if (tone.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, toneEnd);
  }

  gain.gain.setValueAtTime(0.0001, toneStart);
  gain.gain.exponentialRampToValueAtTime(tone.peak, toneStart + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(toneStart);
  oscillator.stop(toneEnd + 0.03);
}

function scheduleManualLookup() {
  window.clearTimeout(state.manualLookupTimer);

  const word = normalizedManualWord();
  if (!word) {
    setLookupStatus('');
    return;
  }

  if (!looksLikeEnglishText(word)) {
    setLookupStatus('Add the meaning manually for this entry.');
    return;
  }

  setLookupStatus('Ready to lookup');
  state.manualLookupTimer = window.setTimeout(() => {
    lookupManualWord({ automatic: true });
  }, LOOKUP_DEBOUNCE_MS);
}

async function lookupManualWord(options = {}) {
  const word = normalizedManualWord();
  if (!word) {
    setLookupStatus('Enter a word first.', 'error');
    return;
  }

  if (!looksLikeEnglishText(word)) {
    setLookupStatus('Add the meaning manually for this entry.');
    updateSaveState();
    return;
  }

  state.lookupAbortController?.abort();
  const controller = new AbortController();
  state.lookupAbortController = controller;
  els.lookupWord.disabled = true;
  setLookupStatus(options.automatic ? 'Matching meaning...' : 'Looking up...');

  try {
    const result = await fetchLookupResult(word, controller.signal);
    if (controller.signal.aborted || normalizedManualWord() !== word) {
      return;
    }

    els.manualMeaning.value = result.translation;
    els.manualMeaning.dataset.service = result.service;
    els.manualMeaning.dataset.fromLanguage = result.fromLanguage;
    els.manualMeaning.dataset.toLanguage = result.toLanguage;
    setLookupStatus('Meaning matched.', 'success');
    updateSaveState();
  } catch (error) {
    if (!controller.signal.aborted) {
      setLookupStatus('Could not match automatically. You can edit the meaning manually.', 'error');
      updateSaveState();
    }
  } finally {
    if (state.lookupAbortController === controller) {
      state.lookupAbortController = null;
      els.lookupWord.disabled = false;
    }
  }
}

async function fetchLookupResult(word, signal) {
  try {
    const youdaoResult = await fetchYoudaoLookup(word);
    if (youdaoResult.translation) {
      return youdaoResult;
    }
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
  }

  const dictionaryPromise = isSingleEnglishWord(word)
    ? fetchDictionaryEntry(word, signal)
    : Promise.reject(new Error('Dictionary lookup supports single words'));
  const translationPromise = fetchChineseTranslation(word, signal);
  const [dictionaryResult, translationResult] = await Promise.allSettled([
    dictionaryPromise,
    translationPromise,
  ]);

  const lines = [];
  const chinese = translationResult.status === 'fulfilled' ? translationResult.value : '';
  if (chinese) {
    lines.push(`Chinese: ${chinese}`);
  }

  if (dictionaryResult.status === 'fulfilled') {
    const details = dictionaryResult.value;
    if (details.phonetic) {
      lines.push(`Pronunciation: ${details.phonetic}`);
    }
    details.definitions.forEach(item => {
      lines.push(`${item.partOfSpeech ? `${item.partOfSpeech}: ` : ''}${item.definition}`);
    });
    if (details.example) {
      lines.push(`Example: ${details.example}`);
    }
  }

  if (!lines.length) {
    throw new Error('No lookup result');
  }

  return {
    translation: lines.join('\n'),
    service: 'Web dictionary lookup',
    fromLanguage: 'en',
    toLanguage: chinese ? 'zh-CN' : 'en',
  };
}

async function fetchYoudaoLookup(word) {
  const data = await postAction({
    action: 'lookup',
    lookupWord: word,
  });
  const result = data.result || {};

  if (!result.translation) {
    throw new Error('No Youdao lookup result');
  }

  return {
    translation: result.translation,
    service: result.service || 'Youdao Dictionary',
    fromLanguage: result.fromLanguage || 'English',
    toLanguage: result.toLanguage || 'Simplified-Chinese',
  };
}

async function fetchDictionaryEntry(word, signal) {
  const response = await fetch(`${DICTIONARY_API_BASE}${encodeURIComponent(word.toLowerCase())}`, { signal });
  if (!response.ok) {
    throw new Error('Dictionary lookup failed');
  }

  const data = await response.json();
  const entries = Array.isArray(data) ? data : [];
  const firstEntry = entries[0] || {};
  const phonetic = firstEntry.phonetic
    || (firstEntry.phonetics || []).find(item => item.text)?.text
    || '';
  const definitions = [];
  let example = '';

  entries.forEach(entry => {
    (entry.meanings || []).forEach(meaning => {
      (meaning.definitions || []).forEach(definition => {
        if (definitions.length >= 4 || !definition.definition) {
          return;
        }
        definitions.push({
          partOfSpeech: meaning.partOfSpeech || '',
          definition: definition.definition,
        });
        if (!example && definition.example) {
          example = definition.example;
        }
      });
    });
  });

  if (!definitions.length && !phonetic) {
    throw new Error('No dictionary result');
  }

  return { phonetic, definitions, example };
}

async function fetchChineseTranslation(word, signal) {
  const url = new URL(TRANSLATION_API_URL);
  url.searchParams.set('q', word);
  url.searchParams.set('langpair', 'en|zh-CN');

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error('Translation lookup failed');
  }

  const data = await response.json();
  const translatedText = String(data.responseData?.translatedText || '').trim();
  if (!translatedText || translatedText.toLowerCase() === word.toLowerCase()) {
    return '';
  }
  return translatedText;
}

function saveManualWord() {
  const word = normalizedManualWord();
  const translation = els.manualMeaning.value.trim();

  if (!word || !translation) {
    setLookupStatus('Word and meaning are required.', 'error');
    updateSaveState();
    return;
  }

  const previousRecords = state.records.map(item => ({ ...item }));
  const previousSelectedId = state.selectedId;
  const previousFilter = state.filter;
  const existing = state.records.find(record => record.word.toLowerCase() === word.toLowerCase());
  const now = new Date().toISOString();
  const record = {
    id: existing?.id || createRecordId(word),
    word,
    translation,
    service: els.manualMeaning.dataset.service || 'Manual entry',
    fromLanguage: els.manualMeaning.dataset.fromLanguage || 'auto',
    toLanguage: els.manualMeaning.dataset.toLanguage || 'zh-CN',
    source: 'Vocabulary web',
    createdAt: existing?.createdAt || now,
    reviewCount: existing?.reviewCount || 0,
    lastReviewedAt: existing?.lastReviewedAt || '',
    status: 'learning',
  };

  state.records = [
    record,
    ...state.records.filter(item => item.word.toLowerCase() !== word.toLowerCase()),
  ].sort(sortRecords);
  state.filter = 'add';
  state.selectedId = record.id;
  state.isRevealed = false;
  writeRecordsCache(state.records);
  resetManualForm();
  setLookupStatus(`Saved "${word}".`, 'success');
  render();
  window.setTimeout(() => els.manualWord.focus(), 0);

  enqueueAction({
    action: 'upsert',
    ...record,
  }, () => {
    state.records = previousRecords;
    state.selectedId = previousSelectedId;
    state.filter = previousFilter;
    writeRecordsCache(state.records);
    render();
  });
}

function resetManualForm() {
  state.lookupAbortController?.abort();
  window.clearTimeout(state.manualLookupTimer);
  els.manualWord.value = '';
  els.manualMeaning.value = '';
  delete els.manualMeaning.dataset.service;
  delete els.manualMeaning.dataset.fromLanguage;
  delete els.manualMeaning.dataset.toLanguage;
  setLookupStatus('');
  updateSaveState();
}

function updateSaveState() {
  els.saveWord.disabled = !(normalizedManualWord() && els.manualMeaning.value.trim());
}

function setLookupStatus(message, tone = '') {
  els.lookupStatus.textContent = message;
  els.lookupStatus.dataset.tone = tone;
}

function normalizedManualWord() {
  return els.manualWord.value.trim().replace(/\s+/g, ' ');
}

function looksLikeEnglishText(value) {
  return /^[a-z][a-z\s'-]*$/i.test(value);
}

function isSingleEnglishWord(value) {
  return /^[a-z][a-z'-]*$/i.test(value);
}

function createRecordId(word) {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `manual-${word.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
}

function updateReviewControls(record) {
  const canReview = Boolean(record);
  els.reveal.disabled = !canReview;
  els.reveal.textContent = state.isRevealed ? 'Next' : 'Reveal';
  els.markMastered.disabled = !canReview;
  els.playPronunciation.disabled = !canReview || !state.isSoundEnabled;
  els.playPronunciation.hidden = !canReview;
}

function titleForFilter(filter) {
  return {
    review: 'Check mastery',
    mastered: 'Mastered',
    add: 'Add word',
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
  if (state.filter === 'add') {
    return `${state.records.length} word${state.records.length === 1 ? '' : 's'} saved`;
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

function animateReviewChange(record) {
  const signature = `${state.filter}:${record?.id || ''}:${state.isRevealed}`;
  if (!state.hasLoadedOnce || signature === state.reviewSignature) {
    state.reviewSignature = signature;
    return;
  }

  state.reviewSignature = signature;
  els.reviewDeck.classList.remove('is-changing');
  window.requestAnimationFrame(() => {
    els.reviewDeck.classList.add('is-changing');
  });
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
