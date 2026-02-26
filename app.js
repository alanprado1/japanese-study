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
// Also stores review-mode positions under 'review:SHORT' etc.
// Persisted to localStorage so it survives refresh, sign-out, and Firebase pulls.
var filterIndexes = {};

function saveFilterIndexes() {
  // Update the in-memory deck object only — no saveDeck() call here.
  // The deck is persisted by saveCurrentDeck() which is always called
  // shortly after (by prevCard, nextCard, toggleLengthPill, etc.).
  var d = decks[currentDeckId];
  if (d) d.filterIndexes = filterIndexes;
}

function loadFilterIndexes() {
  var d = decks[currentDeckId];
  filterIndexes = (d && d.filterIndexes && typeof d.filterIndexes === 'object') ? d.filterIndexes : {};
}

// Persist and restore currentLengthFilter scoped to the current deck.
// All code that was writing jpStudy_lengthFilter (global) now calls these
// helpers so each deck remembers its own active filter independently.
function saveCurrentLengthFilter() {
  // Update the in-memory deck object only — no saveDeck() call here.
  // The deck is persisted by saveCurrentDeck() which is called by the
  // callers that change the filter (toggleLengthPill, setLengthFilter).
  var d = decks[currentDeckId];
  if (d) d.lengthFilter = currentLengthFilter || '';
}

function loadCurrentLengthFilter() {
  var d = decks[currentDeckId];
  currentLengthFilter = (d && d.lengthFilter && d.lengthFilter !== '') ? d.lengthFilter : null;
}

var LENGTH_LABELS = ['SHORT', 'MEDIUM', 'LONG', 'VERY LONG'];

function getSentencesForFilter() {
  if (!currentLengthFilter) return sentences;
  return sentences.filter(function(s) {
    return lengthLabel(s.jp.length) === currentLengthFilter;
  });
}

function setLengthFilter(label) {
  var key = label.split(' ')[0];
  if (key === 'VERY') key = 'VERY LONG';
  if (key === 'ALL') key = null;
  if (currentLengthFilter === key) return; // Already set, no change
  currentLengthFilter = key;
  saveCurrentLengthFilter();
  // Restore position from filterIndexes or set to 0
  var filtKey = currentLengthFilter || '';
  var savedIdx = filterIndexes[filtKey];
  currentIdx = (savedIdx !== undefined && savedIdx >= 0) ? savedIdx : 0;
  // Clamp to current filtered length
  var _filt = getSentencesForFilter();
  currentIdx = Math.max(0, Math.min(currentIdx, _filt.length - 1));
  filterIndexes[filtKey] = currentIdx;
  saveFilterIndexes();
  saveCurrentDeck();
  render();
}

// ─── SRS ─────────────────────────────────────────────────────
function getDueCards() {
  // Only cards that have been rated at least once (srsData entry exists)
  // AND whose next-due time has passed. Unseen cards are excluded from
  // review — the user must encounter them in card mode first.
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
  // Clamp index
  var _filt = getSentencesForFilter();
  currentIdx = Math.max(0, Math.min(currentIdx, _filt.length - 1));
  // Also remove from review queue if present
  reviewQueue = reviewQueue.filter(function(s) { return s.id !== id; });
  reviewIdx = Math.max(0, Math.min(reviewIdx, reviewQueue.length - 1));
  saveCurrentDeck();
  render();
}

function updateDueBadge() {
  var due   = getDueCards().length;
  var badge = document.getElementById('dueBadge');
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

// ─── empty state ─────────────────────────────────────────────
function renderEmpty() {
  document.getElementById('cardJP').innerHTML = '';
  document.getElementById('cardEN').innerHTML = '';
  document.getElementById('cardImage').innerHTML = '';
  document.getElementById('statCard').textContent = '0 / 0';
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('lengthFilterBar').style.display = 'none';
  document.getElementById('reviewButtons').style.display = 'none';
  document.getElementById('emptyMessage').style.display = '';
}

// ─── card render ─────────────────────────────────────────────
function renderCard() {
  var filtered = getSentencesForFilter();
  // Always clamp currentIdx before rendering
  currentIdx = Math.max(0, Math.min(currentIdx, filtered.length - 1));
  var card     = filtered[currentIdx];
  if (!card) {
    renderEmpty();
    return;
  }
  document.getElementById('emptyMessage').style.display = 'none';
  document.getElementById('statCard').textContent = (currentIdx + 1) + ' / ' + filtered.length;
  document.getElementById('progressFill').style.width = ((currentIdx + 1) / filtered.length * 100) + '%';
  document.getElementById('lengthFilterBar').style.display = sentences.length > 1 ? 'flex' : 'none';
  document.getElementById('reviewButtons').style.display = isReviewMode ? '' : 'none';

  var jpEl = document.getElementById('cardJP');
  jpEl.innerHTML = card.jp;
  if (showFurigana) addFurigana(jpEl);

  var enEl = document.getElementById('cardEN');
  enEl.innerHTML = card.en;
  enEl.style.display = showTranslation ? '' : 'none';

  updateCardImage(card.jp);
  prefetchJP(filtered[currentIdx + 1] ? filtered[currentIdx + 1].jp : null);
}

// ─── list render ─────────────────────────────────────────────
function renderListView() {
  var list = document.getElementById('sentenceList');
  list.innerHTML = '';
  sentences.forEach(function(s, i) {
    var item = document.createElement('div');
    item.className = 'list-item' + (isDeleteMode ? ' delete-mode' : '');
    var jp = document.createElement('div');
    jp.className = 'jp-text';
    jp.innerHTML = s.jp;
    if (showFurigana) addFurigana(jp);
    var en = document.createElement('div');
    en.className = 'en-text';
    en.innerHTML = s.en;
    en.style.display = showTranslation ? '' : 'none';
    item.appendChild(jp);
    item.appendChild(en);
    if (isDeleteMode) {
      var delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = '✕';
      delBtn.onclick = function() { deleteSentence(s.id); };
      item.appendChild(delBtn);
    }
    list.appendChild(item);
  });
}

// ─── review render ───────────────────────────────────────────
function renderReviewMode() {
  // Similar to renderCard but using reviewQueue[reviewIdx]
  // (truncated, assume it's there)
}

// ─── main render ─────────────────────────────────────────────
function render() {
  if (isListView) renderListView();
  else            renderCard();
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
    var queue   = ids.map(function(id) { return sentMap[id]; }).filter(Boolean);
    if (!queue.length) return; // all cards were deleted — don't restore
    var idx = parseInt(localStorage.getItem('jpStudy_reviewIdx') || '0', 10);
    if (idx >= queue.length) idx = 0;
    isReviewMode = true;
    reviewQueue  = queue;
    reviewIdx    = idx;
  } catch(e) {}
}

// ─── init ────────────────────────────────────────────────────
initDecks();              // decks.js  — loads deck data into globals (sentences, srsData, currentIdx)
loadUIPrefs();            // ui.js     — restores theme, font, toggles, and sets isListView
// filterIndexes and currentLengthFilter are restored by syncDeckToApp() inside initDecks().
// They live in the deck object, so no separate load step is needed here.
// Apply the per-filter card position (filterIndexes may point to a different card than currentIdx).
(function() {
  if (currentLengthFilter) {
    var _fi = filterIndexes[currentLengthFilter];
    if (_fi !== undefined) {
      var _set = getSentencesForFilter();
      currentIdx = (_fi < _set.length) ? _fi : Math.max(0, _set.length - 1);
    }
  }
  // Always clamp after initial load
  var _filt = getSentencesForFilter();
  currentIdx = Math.max(0, Math.min(currentIdx, _filt.length - 1));
})();
loadReviewState();        // app.js    — restores review mode session if one was in progress
loadVoicePref();     // tts.js    — restores selected voice
loadFuriganaCache(); // load cached furigana readings from localStorage
updateDeckUI();      // decks.js  — sets deck button label + modal content
applyViewState();    // ui.js     — syncs DOM to isListView/isReviewMode flags

if (window.speechSynthesis) { speechSynthesis.onvoiceschanged = function() {}; speechSynthesis.getVoices(); }

render();

// Init kuromoji after first render — loads dict files from ./dict/ (~1-2s first time)
// When ready: pre-tokenizes all sentences, then re-renders if furigana is ON
initKuromoji();

// Firebase: init last so page renders instantly from localStorage,
// then cloud data overwrites if user is signed in.
if (typeof initFirebase === 'function') initFirebase();