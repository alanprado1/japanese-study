/* ============================================================
   積む — app.js  (load order: 4th / last)
   Core state, SRS, rendering, navigation
   ============================================================ */

// ─── global state ────────────────────────────────────────────
var sentences       = [];
var currentIdx      = 0;
var showTranslation = true;
var showFurigana    = false;
var isListView      = false;
var isReviewMode    = false;
var reviewQueue     = [];
var reviewIdx       = 0;
var srsData         = {};

var INTERVALS  = { again: 1, hard: 3, good: 10, easy: 30 }; // minutes
var isDeleteMode = false;

// ─── length filter ───────────────────────────────────────────
// null = show all; otherwise 'SHORT','MEDIUM','LONG','VERY LONG'
var currentLengthFilter = null;

// Remembers the card index for each filter value so switching filters
// restores position. Keys: null→'', 'SHORT', 'MEDIUM', 'LONG', 'VERY LONG'.
// Persisted to localStorage so it survives refresh, sign-out, and Firebase pulls.
var filterIndexes = {};

function saveFilterIndexes() {
  var d = decks[currentDeckId];
  if (d) d.filterIndexes = filterIndexes;
}

function loadFilterIndexes() {
  var d = decks[currentDeckId];
  filterIndexes = (d && d.filterIndexes && typeof d.filterIndexes === 'object') ? d.filterIndexes : {};
}

function saveCurrentLengthFilter() {
  var d = decks[currentDeckId];
  if (d) d.lengthFilter = currentLengthFilter || '';
}

function loadCurrentLengthFilter() {
  var d = decks[currentDeckId];
  currentLengthFilter = (d && d.lengthFilter && d.lengthFilter !== '') ? d.lengthFilter : null;
}

// ─── saveCurrentDeck ─────────────────────────────────────────
// BUG FIX: was called throughout the codebase but never defined.
function saveCurrentDeck() {
  syncAppToDeck();
  saveDeck(currentDeckId);
}

// ─── lengthLabel ─────────────────────────────────────────────
// BUG FIX: was called by getSentencesForFilter() but never defined.
function lengthLabel(len) {
  if (len <= 10) return 'SHORT';
  if (len <= 20) return 'MEDIUM';
  if (len <= 35) return 'LONG';
  return 'VERY LONG';
}

// ─── toggleLengthPill ────────────────────────────────────────
// BUG FIX: called from HTML onclick but never defined.
// Clicking the active filter (or "All") resets to showing all cards.
function toggleLengthPill(label) {
  if (label === null || label === currentLengthFilter) {
    if (currentLengthFilter === null) return; // already showing All
    currentLengthFilter = null;
    saveCurrentLengthFilter();
    var filtKey  = '';
    var savedIdx = filterIndexes[filtKey];
    currentIdx   = (savedIdx !== undefined && savedIdx >= 0) ? savedIdx : 0;
    var _filt    = getSentencesForFilter();
    currentIdx   = Math.max(0, Math.min(currentIdx, _filt.length - 1));
    filterIndexes[filtKey] = currentIdx;
    saveFilterIndexes();
    saveCurrentDeck();
    render();
  } else {
    setLengthFilter(label);
  }
}

// ─── updateLengthFilterBar ───────────────────────────────────
// BUG FIX: called by render() but never defined.
// Syncs pill active-state highlight to currentLengthFilter.
function updateLengthFilterBar() {
  var bar = document.getElementById('lengthFilterBar');
  if (!bar) return;
  bar.querySelectorAll('.length-filter-pill').forEach(function(pill) {
    var onclick = pill.getAttribute('onclick') || '';
    var match   = onclick.match(/toggleLengthPill\(([^)]*)\)/);
    if (!match) return;
    var arg        = match[1].trim();
    var pillFilter = (arg === 'null') ? null : arg.replace(/['"]/g, '');
    pill.classList.toggle('active', pillFilter === currentLengthFilter);
  });
}

var LENGTH_LABELS = ['SHORT', 'MEDIUM', 'LONG', 'VERY LONG'];

function getSentencesForFilter() {
  if (!currentLengthFilter) return sentences;
  return sentences.filter(function(s) {
    return lengthLabel(s.jp.length) === currentLengthFilter;
  });
}

function setLengthFilter(label) {
  var key;
  if (!label || label === 'ALL') {
    key = null;
  } else if (label === 'VERY LONG' || label === 'VERY') {
    key = 'VERY LONG';
  } else {
    key = label.split(' ')[0]; // 'SHORT', 'MEDIUM', 'LONG'
  }

  currentLengthFilter = key;
  saveCurrentLengthFilter();

  var filtKey  = currentLengthFilter || '';
  var savedIdx = filterIndexes[filtKey];
  currentIdx   = (savedIdx !== undefined && savedIdx >= 0) ? savedIdx : 0;

  var _filt = getSentencesForFilter();
  // If filter yields no cards, auto-reset to All
  if (key && _filt.length === 0) {
    currentLengthFilter = null;
    saveCurrentLengthFilter();
    _filt    = sentences;
    filtKey  = '';
    savedIdx = filterIndexes[''];
    currentIdx = (savedIdx !== undefined && savedIdx >= 0) ? savedIdx : 0;
  }
  currentIdx = Math.max(0, Math.min(currentIdx, _filt.length - 1));
  filterIndexes[filtKey] = currentIdx;
  saveFilterIndexes();
  saveCurrentDeck();
  render();
}

// ─── SRS ─────────────────────────────────────────────────────
function getDueCards() {
  var now = Date.now();
  return sentences.filter(function(s) {
    var d = srsData[s.id];
    return d && d.due <= now;
  });
}

// ─── delete sentence ─────────────────────────────────────────
function deleteSentence(id) {
  sentences = sentences.filter(function(s) { return s.id !== id; });
  delete srsData[id];
  var _filt = getSentencesForFilter();
  currentIdx = Math.max(0, Math.min(currentIdx, _filt.length - 1));
  reviewQueue = reviewQueue.filter(function(s) { return s.id !== id; });
  reviewIdx   = Math.max(0, Math.min(reviewIdx, reviewQueue.length - 1));
  saveCurrentDeck();
  render();
}

function updateDueBadge() {
  var due   = getDueCards().length;
  var badge = document.getElementById('dueBadge');
  if (!badge) return;
  badge.style.display = due > 0 ? '' : 'none';
  badge.textContent   = due;
}

function reviewCard(rating) {
  var card = isReviewMode ? reviewQueue[reviewIdx] : sentences[currentIdx];
  if (!card) return;

  var now  = Date.now();
  var prev = srsData[card.id] || { interval: 0, due: 0 };
  var mult = { again: 0.5, hard: 1.2, good: 2.0, easy: 3.0 }[rating];
  var interval = Math.max(INTERVALS[rating], prev.interval * mult);
  srsData[card.id] = { interval: interval, due: now + interval * 60000 };

  if (isReviewMode) {
    reviewQueue.splice(reviewIdx, 1);
    saveReviewState();
    if (reviewQueue.length === 0) {
      exitReviewMode();
    } else {
      reviewIdx = Math.min(reviewIdx, reviewQueue.length - 1);
      renderReviewMode();
    }
  } else {
    saveCurrentDeck();
    render();
  }
  updateDueBadge();
}

// ─── empty / card area helpers ────────────────────────────────
function _showCardArea(visible) {
  var cardArea   = document.getElementById('cardArea');
  var emptyState = document.getElementById('emptyState');
  if (cardArea)   cardArea.style.display   = visible ? ''     : 'none';
  if (emptyState) emptyState.style.display = visible ? 'none' : '';
}

// ─── card render ─────────────────────────────────────────────
// BUG FIX: all DOM IDs corrected:
//   cardJP       → jpText
//   cardEN       → transText
//   reviewButtons→ reviewBtns
//   emptyMessage → emptyState (handled via _showCardArea)
function renderCard() {
  var filtered = getSentencesForFilter();
  currentIdx   = Math.max(0, Math.min(currentIdx, filtered.length - 1));
  var card     = filtered[currentIdx];

  if (!card) {
    _showCardArea(false);
    var statsBar = document.getElementById('statsBar');
    if (statsBar) statsBar.style.display = 'none';
    document.getElementById('statCard').textContent     = '0 / 0';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('lengthFilterBar').style.display = 'none';
    return;
  }

  _showCardArea(true);

  var statsBar = document.getElementById('statsBar');
  if (statsBar) statsBar.style.display = 'flex';

  document.getElementById('statCard').textContent     = (currentIdx + 1) + ' / ' + filtered.length;
  document.getElementById('progressFill').style.width = ((currentIdx + 1) / filtered.length * 100) + '%';

  document.getElementById('lengthFilterBar').style.display = sentences.length > 1 ? 'flex' : 'none';

  var reviewBtns = document.getElementById('reviewBtns');
  if (reviewBtns) reviewBtns.style.display = isReviewMode ? '' : 'none';

  var cardNav = document.getElementById('cardNav');
  if (cardNav) cardNav.style.display = isReviewMode ? 'none' : '';

  // BUG FIX: correct ID is 'jpText'
  var jpEl = document.getElementById('jpText');
  if (jpEl) {
    jpEl.innerHTML = card.jp;
    if (showFurigana) addFurigana(jpEl);
  }

  // BUG FIX: correct ID is 'transText'
  var enEl = document.getElementById('transText');
  if (enEl) {
    enEl.innerHTML     = card.en;
    enEl.style.display = showTranslation ? '' : 'none';
  }

  updateCardImage(card.jp);
  prefetchJP(filtered[currentIdx + 1] ? filtered[currentIdx + 1].jp : null);
}

// ─── list render ─────────────────────────────────────────────
// BUG FIX: was targeting 'sentenceList' which doesn't exist — correct element is 'listView'
// Also: list now respects currentLengthFilter so filtering works in list mode too
function renderListView() {
  var list = document.getElementById('listView');
  if (!list) return;
  list.innerHTML = '';

  var displaySentences = currentLengthFilter ? getSentencesForFilter() : sentences;

  displaySentences.forEach(function(s) {
    var item       = document.createElement('div');
    item.className = 'list-item' + (isDeleteMode ? ' delete-mode' : '');

    var jp       = document.createElement('div');
    jp.className = 'jp-text';
    jp.innerHTML = s.jp;
    if (showFurigana) addFurigana(jp);

    var en           = document.createElement('div');
    en.className     = 'en-text';
    en.innerHTML     = s.en;
    en.style.display = showTranslation ? '' : 'none';

    var audioBtn       = document.createElement('button');
    audioBtn.className = 'card-audio-btn list-audio-btn';
    audioBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>';
    (function(sentence, btn) {
      btn.onclick = function(e) { e.stopPropagation(); speakListItem(btn, sentence.jp); };
    })(s, audioBtn);

    item.appendChild(jp);
    item.appendChild(en);
    item.appendChild(audioBtn);

    if (isDeleteMode) {
      var delBtn         = document.createElement('button');
      delBtn.className   = 'delete-btn';
      delBtn.textContent = '✕';
      (function(id) { delBtn.onclick = function() { deleteSentence(id); }; })(s.id);
      item.appendChild(delBtn);
    }

    list.appendChild(item);
  });
}

// ─── main render ─────────────────────────────────────────────
// BUG FIX: was never dispatching to renderReviewMode() when isReviewMode=true
function render() {
  if (isListView) {
    renderListView();
  } else if (isReviewMode) {
    renderReviewMode();
  } else {
    renderCard();
  }
  updateDueBadge();
  updateLengthFilterBar();
}

// ─── navigation ──────────────────────────────────────────────
function prevCard() {
  if (isReviewMode) return;
  var _filt = getSentencesForFilter();
  if (currentIdx > 0) {
    currentIdx--;
    var key = currentLengthFilter || '';
    filterIndexes[key] = currentIdx;
    saveFilterIndexes();
    resetAudioBtn();
    saveCurrentDeck();
    render();
  }
}

function nextCard() {
  if (isReviewMode) return;
  var _filt = getSentencesForFilter();
  if (currentIdx < _filt.length - 1) {
    currentIdx++;
    var key = currentLengthFilter || '';
    filterIndexes[key] = currentIdx;
    saveFilterIndexes();
    resetAudioBtn();
    saveCurrentDeck();
    render();
  }
}

// ─── review mode persistence ─────────────────────────────────
function saveReviewState() {
  try {
    localStorage.setItem('jpStudy_isReviewMode', 'true');
    localStorage.setItem('jpStudy_reviewQueueIds', JSON.stringify(reviewQueue.map(function(s) { return s.id; })));
    localStorage.setItem('jpStudy_reviewIdx', reviewIdx);
  } catch(e) {}
}

function loadReviewState() {
  try {
    if (localStorage.getItem('jpStudy_isReviewMode') !== 'true') return;
    var raw = localStorage.getItem('jpStudy_reviewQueueIds');
    if (!raw) return;
    var ids     = JSON.parse(raw);
    var sentMap = {};
    sentences.forEach(function(s) { sentMap[s.id] = s; });
    var queue = ids.map(function(id) { return sentMap[id]; }).filter(Boolean);
    if (!queue.length) return;
    var idx = parseInt(localStorage.getItem('jpStudy_reviewIdx') || '0', 10);
    if (idx >= queue.length) idx = 0;
    isReviewMode = true;
    reviewQueue  = queue;
    reviewIdx    = idx;
  } catch(e) {}
}

// ─── init ────────────────────────────────────────────────────
initDecks();      // decks.js  — loads deck data into globals
loadUIPrefs();    // ui.js     — restores theme, font, toggles, sets isListView

// Apply per-filter card position on startup
(function() {
  if (currentLengthFilter) {
    var _fi  = filterIndexes[currentLengthFilter];
    var _set = getSentencesForFilter();
    if (_fi !== undefined) {
      currentIdx = (_fi < _set.length) ? _fi : Math.max(0, _set.length - 1);
    }
  }
  var _filt = getSentencesForFilter();
  currentIdx = Math.max(0, Math.min(currentIdx, _filt.length - 1));
})();

loadReviewState();    // restore in-progress review session
loadVoicePref();      // tts.js   — restore selected voice
loadFuriganaCache();  // kuromoji — load cached furigana readings
updateDeckUI();       // decks.js — set deck button label + modal content
applyViewState();     // ui.js    — sync DOM to isListView/isReviewMode flags

if (window.speechSynthesis) { speechSynthesis.onvoiceschanged = function() {}; speechSynthesis.getVoices(); }

render();

// Init kuromoji after first render (~1-2s for dict load)
initKuromoji();

// Firebase last — page renders from localStorage first, then cloud overwrites
if (typeof initFirebase === 'function') initFirebase();
