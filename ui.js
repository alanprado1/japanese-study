/* ============================================================
   積む — ui.js  (load order: 3rd)
   UI interactions: themes, toggles, settings, modals
   ============================================================ */

// ─── apply view state to DOM ──────────────────────────────────
// Called on init and after deck switch so DOM always matches isListView
function applyViewState() {
  var flashcard = document.getElementById('flashcardView');
  var listView  = document.getElementById('listView');
  var btnList   = document.getElementById('btnListView');
  var btnCard   = document.getElementById('btnCardView');
  var statsBar  = document.getElementById('statsBar');

  if (isListView) {
    flashcard.style.display = 'none';
    listView.classList.add('active');
    btnList.style.display = 'none';
    btnCard.style.display = '';
    statsBar.style.display = 'none';
  } else {
    flashcard.style.display = '';
    listView.classList.remove('active');
    btnList.style.display = '';
    btnCard.style.display = 'none';
    statsBar.style.display = sentences.length ? 'flex' : 'none';
  }
}

// ─── themes ──────────────────────────────────────────────────
function setTheme(t) {
  document.body.setAttribute('data-theme', t);
  document.querySelectorAll('.theme-dot').forEach(function(d) {
    d.classList.toggle('active', d.dataset.t === t);
  });
  try { localStorage.setItem('jpStudy_theme', t); } catch(e) {}
}

document.querySelectorAll('.theme-dot').forEach(function(dot) {
  dot.addEventListener('click', function() {
    setTheme(dot.dataset.t);
    collapseNavOnMobile();
  });
});

// ─── translation toggle ───────────────────────────────────────
document.getElementById('btnToggleTranslation').addEventListener('click', function() {
  showTranslation = !showTranslation;
  var btn = document.getElementById('btnToggleTranslation');
  btn.classList.toggle('active', showTranslation);
  btn.textContent = showTranslation ? 'Translation ON' : 'Translation OFF';
  try { localStorage.setItem('jpStudy_translation', showTranslation); } catch(e) {}
  collapseNavOnMobile();
  render();
});

// ─── furigana toggle ─────────────────────────────────────────
document.getElementById('btnToggleFurigana').addEventListener('click', function() {
  showFurigana = !showFurigana;
  var btn = document.getElementById('btnToggleFurigana');
  btn.classList.toggle('active', showFurigana);
  btn.textContent = showFurigana ? '振仮名 ON' : '振仮名 OFF';
  try { localStorage.setItem('jpStudy_furigana', showFurigana); } catch(e) {}
  collapseNavOnMobile();
  render();
});

// ─── helper: collapse nav on mobile when switching modes ─────
function collapseNavOnMobile() {
  if (window.innerWidth <= 768) {
    document.querySelector('header').classList.add('header-hidden');
  }
}

// ─── view toggle ─────────────────────────────────────────────
// Standard mode toggles — no header side effects.
// The header-hidden class is only ever controlled by the mobile nav pill.
// Keeping these buttons clean/standard means future features can build
// on them without undoing header-collapse state unexpectedly.
document.getElementById('btnListView').addEventListener('click', function() {
  isListView   = true;
  isReviewMode = false;
  if (typeof saveCurrentDeck === 'function') saveCurrentDeck();
  try {
    localStorage.setItem('jpStudy_isListView', 'true');
    localStorage.setItem('jpStudy_isReviewMode', 'false');
    localStorage.removeItem('jpStudy_reviewQueueIds');
    localStorage.removeItem('jpStudy_reviewIdx');
  } catch(e) {}
  collapseNavOnMobile();
  applyViewState();
  render();
});

document.getElementById('btnCardView').addEventListener('click', function() {
  isListView   = false;
  isReviewMode = false;
  if (typeof saveCurrentDeck === 'function') saveCurrentDeck();
  try {
    localStorage.setItem('jpStudy_isListView', 'false');
    localStorage.setItem('jpStudy_isReviewMode', 'false');
    localStorage.removeItem('jpStudy_reviewQueueIds');
    localStorage.removeItem('jpStudy_reviewIdx');
  } catch(e) {}
  collapseNavOnMobile();
  applyViewState();
  render();
});

// ─── review mode ─────────────────────────────────────────────
document.getElementById('btnReviewMode').addEventListener('click', function() {
  var due = getDueCards();
  // Apply active length filter so review queue matches the currently visible set
  if (currentLengthFilter) {
    due = due.filter(function(s) { return lengthLabel(s.jp.length) === currentLengthFilter; });
  }
  if (!due.length) { alert('No cards due for review.'); return; }
  reviewQueue = due.sort(function(a, b) { return srsData[a.id].due - srsData[b.id].due; });
  reviewIdx = 0;
  isReviewMode = true;
  isListView = false;
  saveReviewState();
  try { localStorage.setItem('jpStudy_isListView', 'false'); } catch(e) {}
  collapseNavOnMobile();
  applyViewState();
  renderReviewMode();
});

function exitReviewMode() {
  isReviewMode = false;
  try {
    localStorage.setItem('jpStudy_isReviewMode', 'false');
    localStorage.removeItem('jpStudy_reviewQueueIds');
    localStorage.removeItem('jpStudy_reviewIdx');
  } catch(e) {}
  applyViewState();
  render();
}

function renderReviewMode() {
  var card = reviewQueue[reviewIdx];
  if (!card) return exitReviewMode();
  document.getElementById('statCard').textContent = (reviewIdx + 1) + ' / ' + reviewQueue.length;
  document.getElementById('progressFill').style.width = ((reviewIdx + 1) / reviewQueue.length * 100) + '%';
  document.getElementById('lengthFilterBar').style.display = 'none';
  document.getElementById('reviewButtons').style.display = '';
  document.getElementById('emptyMessage').style.display = 'none';

  var jpEl = document.getElementById('cardJP');
  jpEl.innerHTML = card.jp;
  if (showFurigana) addFurigana(jpEl);

  var enEl = document.getElementById('cardEN');
  enEl.innerHTML = card.en;
  enEl.style.display = showTranslation ? '' : 'none';

  updateCardImage(card.jp);
  prefetchJP(reviewQueue[reviewIdx + 1] ? reviewQueue[reviewIdx + 1].jp : null);
}

// ─── add modal ───────────────────────────────────────────────
function openAddModal()  { document.getElementById('addModal').classList.add('active'); document.getElementById('sentenceInput').focus(); }
function closeAddModal() { document.getElementById('addModal').classList.remove('active'); if (typeof collapseNavOnMobile === 'function') collapseNavOnMobile(); }

// ─── settings modal ──────────────────────────────────────────
function openSettings()  { document.getElementById('settingsModal').classList.add('active'); }
function closeSettings() { document.getElementById('settingsModal').classList.remove('active'); if (typeof collapseNavOnMobile === 'function') collapseNavOnMobile(); }

document.getElementById('btnSettings').addEventListener('click', openSettings);
document.getElementById('settingsModal').addEventListener('click', function(e) { if (e.target === this) closeSettings(); });

document.getElementById('fontSizeSlider').addEventListener('input', function() {
  var size = this.value + 'rem';
  document.documentElement.style.setProperty('--jp-size', size);
  document.getElementById('fontSizeVal').textContent = size;
  try { localStorage.setItem('jpStudy_jpSize', size); } catch(e) {}
});

document.querySelectorAll('.weight-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var w = btn.dataset.w;
    document.documentElement.style.setProperty('--jp-weight', w);
    document.querySelectorAll('.weight-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.w === w); });
    try { localStorage.setItem('jpStudy_jpWeight', w); } catch(e) {}
  });
});

document.querySelectorAll('.speaker-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    setSpeaker(btn.dataset.sid);
  });
});

// ─── deck modal ──────────────────────────────────────────────
document.getElementById('btnDeckSelect').addEventListener('click', function() {
  collapseNavOnMobile();
  openDeckModal();
});
document.getElementById('deckModal').addEventListener('click', function(e) {
  if (e.target === this) closeDeckModal();
});

document.getElementById('btnNewDeck').addEventListener('click', function() {
  var name = prompt('New deck name:');
  if (!name || !name.trim()) return;

  // Save state of current deck first
  syncAppToDeck();
  saveDeck(currentDeckId);

  // Create deck in memory + localStorage only (no Firestore yet)
  var id = 'deck_' + Date.now();
  decks[id] = { name: name.trim(), sentences: [], srsData: {}, currentIdx: 0 };
  try {
    localStorage.setItem('jpStudy_deck_' + id, JSON.stringify({ name: name.trim(), sentences: [], srsData: {}, currentIdx: 0 }));
  } catch(e) {}

  closeDeckModal();

  // Switch to new deck — set currentDeckId BEFORE any Firestore push
  currentDeckId = id;
  localStorage.setItem('jpStudy_currentDeck', id);
  syncDeckToApp();

  // Now push to Firestore with the correct currentDeckId already set
  if (typeof pushCurrentDeckId === 'function') pushCurrentDeckId();
  if (typeof saveDeck === 'function') saveDeck(currentDeckId);

  isReviewMode = false;
  resetAudioBtn();
  applyViewState();
  render();
  updateDeckUI();
});

// ─── word popup ───────────────────────────────────────────────
function closePopup() {
  document.getElementById('wordPopup').classList.remove('active');
  document.querySelectorAll('.jp-word.selected').forEach(function(e) { e.classList.remove('selected'); });
}

document.getElementById('wordPopup').addEventListener('click', function(e) {
  if (e.target === this) closePopup();
});

// ─── delete mode toggle ───────────────────────────────────────
document.getElementById('btnDeleteMode').addEventListener('click', function() {
  isDeleteMode = !isDeleteMode;
  var btn = document.getElementById('btnDeleteMode');
  btn.classList.toggle('active', isDeleteMode);
  btn.classList.toggle('btn-danger', isDeleteMode);
  btn.textContent = isDeleteMode ? '✕ Del ON' : '✕ Del';
  collapseNavOnMobile();
  render();
});
document.addEventListener('keydown', function(e) {
  if (document.getElementById('addModal').classList.contains('active'))  return;
  if (document.getElementById('deckModal').classList.contains('active')) return;
  if (e.key === 'ArrowRight' || e.key === 'l') nextCard();
  if (e.key === 'ArrowLeft'  || e.key === 'h') prevCard();
  if (e.key === 't') document.getElementById('btnToggleTranslation').click();
  if (e.key === 'Escape') { closePopup(); closeAddModal(); closeDeckModal(); }
});

// ─── load all saved UI preferences ───────────────────────────
function loadUIPrefs() {
  var t = localStorage.getItem('jpStudy_theme');
  if (t) setTheme(t);

  var f = localStorage.getItem('jpStudy_furigana');
  if (f === 'true') {
    showFurigana = true;
    var fb = document.getElementById('btnToggleFurigana');
    fb.classList.add('active');
    fb.textContent = '振仮名 ON';
  }

  var tr = localStorage.getItem('jpStudy_translation');
  if (tr !== null) {
    showTranslation = (tr === 'true');
    var tb = document.getElementById('btnToggleTranslation');
    tb.classList.toggle('active', showTranslation);
    tb.textContent = showTranslation ? 'Translation ON' : 'Translation OFF';
  }

  var sz = localStorage.getItem('jpStudy_jpSize');
  if (sz) {
    document.documentElement.style.setProperty('--jp-size', sz);
    document.getElementById('fontSizeSlider').value = parseFloat(sz);
    document.getElementById('fontSizeVal').textContent = sz;
  }

  var wt = localStorage.getItem('jpStudy_jpWeight');
  if (wt) {
    document.documentElement.style.setProperty('--jp-weight', wt);
    document.querySelectorAll('.weight-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.w === wt);
    });
  }

  // Restore list vs card view — set isListView so applyViewState works correctly
  var lv = localStorage.getItem('jpStudy_isListView');
  if (lv === 'true') isListView = true;

  // NOTE: currentLengthFilter is restored by loadCurrentLengthFilter() in
  // app.js (deck-scoped). Do NOT restore it here from the old global key.
}

// ─── mobile: nav toggle pill ─────────────────────────────────
// Header starts visible. Only the pill button toggles it.
document.getElementById('btnMobileNav').addEventListener('click', function() {
  var headerEl = document.querySelector('header');
  headerEl.classList.toggle('header-hidden');
});