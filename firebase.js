/* ============================================================
   積む — firebase.js  (load order: 0th / first)
   Firebase Auth + Firestore cloud sync
   ============================================================ */

var firebaseConfig = {
  apiKey:            "AIzaSyCGecVsmUAM6NFZ_dA483DSeP9t_GMrizE",
  authDomain:        "japanese-study-b420f.firebaseapp.com",
  projectId:         "japanese-study-b420f",
  storageBucket:     "japanese-study-b420f.firebasestorage.app",
  messagingSenderId: "102954502203",
  appId:             "1:102954502203:web:ec3422f0c796b17e01b41e"
};

var firebaseApp   = null;
var firebaseAuth  = null;
var firebaseDB    = null;
var currentUser   = null;
var firebaseReady = false;

// ─── init ────────────────────────────────────────────────────
function initFirebase() {
  try {
    firebaseApp  = firebase.initializeApp(firebaseConfig);
    firebaseAuth = firebase.auth();
    firebaseDB   = firebase.firestore();
    firebaseReady = true;

    // Fires immediately on page load if session is already active,
    // OR after a fresh sign-in. Always pull cloud data either way.
    firebaseAuth.onAuthStateChanged(function(user) {
      currentUser = user;
      updateAuthUI();

      if (user) {
        pullFromFirestore().then(function() {
          // syncDeckToApp sets sentences, srsData, currentIdx, AND
          // currentLengthFilter all from the deck object — the filter
          // is stored as part of the deck, not a separate key.
          syncDeckToApp();
          render();
          updateDeckUI();
        }).catch(function(e) {
          console.warn('Pull failed:', e);
        });
      }
    });

  } catch(e) {
    console.warn('Firebase init failed — local-only mode.', e);
    firebaseReady = false;
  }
}

// ─── auth ────────────────────────────────────────────────────
// signInWithPopup works on all platforms including mobile browsers.
//
// Safari exception: ITP (Intelligent Tracking Prevention) partitions or
// blocks sessionStorage in certain contexts — pages opened from other apps,
// Home Screen PWAs, or when "Prevent Cross-Site Tracking" is on. Firebase's
// signInWithPopup probes sessionStorage before opening the popup; if that
// probe throws a SecurityError, Firebase raises
// auth/operation-not-supported-in-this-environment before the popup opens.
//
// Fix: detect Safari + probe sessionStorage safely. If blocked, switch
// persistence to NONE (pure in-memory) before calling signInWithPopup.
// NONE bypasses the storage probe so the popup opens normally.
// Trade-off: auth state won't survive a page refresh in that Safari context,
// but the app re-syncs from Firestore on every sign-in anyway.

function _isSafari() {
  var ua = navigator.userAgent;
  return /Safari/i.test(ua) &&
    !/Chrome/i.test(ua) &&
    !/CriOS/i.test(ua) &&
    !/FxiOS/i.test(ua);
}

function _sessionStorageAvailable() {
  try {
    var key = '__fbTest__';
    sessionStorage.setItem(key, '1');
    sessionStorage.removeItem(key);
    return true;
  } catch(e) {
    return false;
  }
}

function signInWithGoogle() {
  if (!firebaseReady) return;
  var provider = new firebase.auth.GoogleAuthProvider();

  var doSignIn = function() {
    firebaseAuth.signInWithPopup(provider).catch(function(err) {
      // User closed the popup before completing sign-in — not a real error, ignore silently.
      if (err.code === 'auth/popup-closed-by-user' ||
          err.code === 'auth/cancelled-popup-request') return;
      console.error('Sign in failed:', err);
      alert('Sign in failed: ' + err.message);
    });
  };

  // On Safari, if sessionStorage is blocked, switch to in-memory persistence
  // so Firebase's environment check passes and the popup can open.
  if (_isSafari() && !_sessionStorageAvailable()) {
    firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.NONE)
      .then(doSignIn)
      .catch(function(err) {
        console.warn('setPersistence failed, attempting popup anyway:', err);
        doSignIn();
      });
  } else {
    doSignIn();
  }
}

function signOut() {
  if (!firebaseReady) return;
  firebaseAuth.signOut();
}

function updateAuthUI() {
  var btn      = document.getElementById('btnAuth');
  var userInfo = document.getElementById('userInfo');
  if (!btn) return;

  if (currentUser) {
    btn.textContent = 'Sign Out';
    btn.onclick     = signOut;
    if (userInfo) {
      userInfo.textContent   = currentUser.displayName || currentUser.email;
      userInfo.style.display = '';
    }
  } else {
    btn.textContent = '☁ Sync';
    btn.onclick     = signInWithGoogle;
    if (userInfo) userInfo.style.display = 'none';
  }
}

// ─── Firestore reference ─────────────────────────────────────
function userDoc() {
  if (!firebaseReady || !currentUser) return null;
  return firebaseDB.collection('users').doc(currentUser.uid);
}

// ─── push one deck up ────────────────────────────────────────
// Called from decks.js saveDeck() after every local change.
function pushDeckToFirestore(deckId) {
  var ref = userDoc();
  if (!ref) return Promise.resolve();

  var d = decks[deckId];
  if (!d) return Promise.resolve();

  // Make sure in-memory state is flushed into the deck object
  if (deckId === currentDeckId) syncAppToDeck();

  var meta = {};
  Object.keys(decks).forEach(function(id) {
    meta[id] = { name: decks[id].name };
  });

  var batch   = firebaseDB.batch();
  var deckRef = ref.collection('decks').doc(deckId);

  // Write top-level user doc (deck list + active deck)
  batch.set(ref, { deckList: meta, currentDeckId: currentDeckId }, { merge: true });

  // Write full deck data
  batch.set(deckRef, {
    name:         d.name,
    sentences:    d.sentences,
    srsData:      d.srsData,
    currentIdx:   d.currentIdx,
    lengthFilter: d.lengthFilter || null
  });

  return batch.commit().catch(function(e) {
    console.warn('Firestore push failed:', e);
  });
}

function pushAllDecksToFirestore() {
  if (!userDoc()) return Promise.resolve();
  return Promise.all(Object.keys(decks).map(function(id) {
    return pushDeckToFirestore(id);
  }));
}

// Push ONLY the currentDeckId field — call this right after currentDeckId changes
function pushCurrentDeckId() {
  var ref = userDoc();
  if (!ref) return;
  ref.set({ currentDeckId: currentDeckId }, { merge: true }).catch(function(e) {
    console.warn('Firestore currentDeckId update failed:', e);
  });
}

// ─── delete one deck from Firestore ──────────────────────────
// Called by deleteDeck() in decks.js right after local removal.
// Must: (1) delete the deck Firestore doc, (2) overwrite (not merge)
// the deckList on the user doc so the deleted deck is gone from cloud.
function deleteDeckFromFirestore(deckId) {
  var ref = userDoc();
  if (!ref) return Promise.resolve();

  // Build the updated deck list — deck is already removed from local `decks`
  var meta = {};
  Object.keys(decks).forEach(function(id) {
    meta[id] = { name: decks[id].name };
  });

  var batch = firebaseDB.batch();

  // Overwrite the user doc with the new deckList — NOT merge, so deleted deck
  // key is fully removed from the cloud deckList field
  batch.set(ref, { deckList: meta, currentDeckId: currentDeckId });

  // Delete the deck's own Firestore document
  batch.delete(ref.collection('decks').doc(deckId));

  return batch.commit().catch(function(e) {
    console.warn('Firestore deck delete failed:', e);
  });
}

// ─── pull all decks from Firestore ───────────────────────────
// Cloud always wins — completely replaces whatever is in memory.
function pullFromFirestore() {
  var ref = userDoc();
  if (!ref) return Promise.resolve();

  return ref.get().then(function(doc) {
    // No data in cloud yet — first sign-in, push local data up
    if (!doc.exists || !doc.data().deckList || !Object.keys(doc.data().deckList).length) {
      return pushAllDecksToFirestore();
    }

    var data         = doc.data();
    var meta         = data.deckList;
    var cloudCurrent = data.currentDeckId;

    return ref.collection('decks').get().then(function(snapshot) {
      var cloudDecks = {};

      snapshot.forEach(function(deckDoc) {
        var id = deckDoc.id;
        // ONLY include deck documents that are listed in deckList meta.
        // Orphaned docs (e.g. deleted deck whose document hasn't been purged yet)
        // must be ignored — deckList is the authoritative record of existing decks.
        if (!meta[id]) return;
        var d  = deckDoc.data();
        cloudDecks[id] = {
          name:         d.name         || meta[id].name,
          sentences:    d.sentences    || [],
          srsData:      d.srsData      || {},
          currentIdx:   d.currentIdx   || 0,
          lengthFilter: d.lengthFilter || null
        };
      });

      // Any decks in meta without a doc (empty decks)
      Object.keys(meta).forEach(function(id) {
        if (!cloudDecks[id]) {
          cloudDecks[id] = { name: meta[id].name, sentences: [], srsData: {}, currentIdx: 0, lengthFilter: null };
        }
      });

      // ── Preserve local currentIdx before overwriting with cloud ──
      // currentIdx is "which card you're looking at" — pure UI state.
      // Firestore stores the idx from the last push, which may lag behind
      // the local value if the user navigated cards and refreshed before
      // the async push completed. Without this guard the cloud's older
      // idx value clobbers the local one, causing the stats bar to jump
      // and a visible card-content flash on every page refresh.
      var _prePullDeckId = currentDeckId;
      var _prePullIdx    = decks[_prePullDeckId] ? decks[_prePullDeckId].currentIdx : 0;

      // Fully replace local state with cloud state
      decks = cloudDecks;

      if (cloudCurrent && decks[cloudCurrent]) {
        currentDeckId = cloudCurrent;
      } else {
        currentDeckId = Object.keys(decks)[0];
      }
      localStorage.setItem('jpStudy_currentDeck', currentDeckId);

      // If the active deck hasn't changed, restore the local card position.
      // If the active deck DID change (switched on another device) we use
      // the cloud's idx so the user lands on the correct card for that deck.
      if (currentDeckId === _prePullDeckId && decks[currentDeckId]) {
        decks[currentDeckId].currentIdx = _prePullIdx;
      }

      // Persist cloud data back to localStorage so next refresh starts fresh correctly.
      // lengthFilter is included in each deck's localStorage entry so it survives
      // refreshes without needing a separate key.
      var deckMeta = {};
      Object.keys(decks).forEach(function(id) {
        deckMeta[id] = { name: decks[id].name };
        try {
          localStorage.setItem('jpStudy_deck_' + id, JSON.stringify({
            name:         decks[id].name,
            sentences:    decks[id].sentences,
            srsData:      decks[id].srsData,
            currentIdx:   decks[id].currentIdx,
            lengthFilter: decks[id].lengthFilter || null
          }));
        } catch(e) { console.warn('localStorage write failed for deck', id, e); }
      });
      try {
        localStorage.setItem('jpStudy_deckList', JSON.stringify(deckMeta));
      } catch(e) {}
    });

  }).catch(function(e) {
    console.warn('Firestore pull failed — keeping local data.', e);
  });
}
