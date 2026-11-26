// viewer.js
// The read-only countdown view. view.html shows it on load; admin.html turns
// itself into it when a screen switches to the view, without loading a new
// page, so the fullscreen requested by that click survives the switch.

const VIEWER_MARKUP = `
  <main class="page page--viewer" id="app" hidden>
    <section class="panel timer" id="timer-container"></section>
  </main>

  <button type="button" class="icon-button fullscreen-button" id="btn-fullscreen" hidden></button>

  <p class="panel" id="error" hidden></p>
`;

// Replaces the page's content with the view of the meeting with this viewer
// token.
async function showViewer(token) {
  document.title = 'Talerstol Timer';
  document.body.innerHTML = VIEWER_MARKUP;

  const errorEl = document.getElementById('error');
  function fail(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  if (!token) return fail('Mangler token i linket.');

  let initial;
  try {
    initial = await getMeetingState(token);
  } catch (err) {
    return fail('Kunne ikke finde mødet. Tjek at linket er korrekt.');
  }

  document.getElementById('app').hidden = false;

  const display = createTimerDisplay(document.getElementById('timer-container'), { showTitleInStatus: true });
  display.update(initial);

  subscribeToMeeting(token, (state) => {
    display.update(state);
  });

  keepScreenOn();
  setupFullscreenButton();
}

// Keeps the screen from dimming/locking while the view is open. Needs a
// secure context (https or localhost); the browser releases the lock when
// the page is hidden, so it is requested again when it becomes visible.
function keepScreenOn() {
  if (!('wakeLock' in navigator)) return;
  const request = () => navigator.wakeLock.request('screen').catch(() => {});
  request();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') request();
  });
}

// Fullscreen must be requested from a click in this page, so the view has
// its own button. It stays visible for 30 seconds after the page opens -
// time to find it after switching a screen to the view - and for a few
// seconds after any activity, then gets out of the way. Hidden where
// the browser cannot go fullscreen (e.g. iPhone).
const ENTER_FULLSCREEN_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
const EXIT_FULLSCREEN_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
const FULLSCREEN_BUTTON_INITIAL_MS = 30000;
const FULLSCREEN_BUTTON_ACTIVITY_MS = 5000;

function setupFullscreenButton() {
  if (!document.fullscreenEnabled) return;
  const btn = document.getElementById('btn-fullscreen');
  btn.hidden = false;

  function render() {
    const label = document.fullscreenElement ? 'Afslut fuldskærm' : 'Fuldskærm';
    btn.innerHTML = document.fullscreenElement ? EXIT_FULLSCREEN_ICON : ENTER_FULLSCREEN_ICON;
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  // Hides at whichever is later: the initial period or the last activity.
  let hideTimer;
  let hideAt = 0;
  function showFor(ms) {
    btn.classList.remove('is-idle');
    hideAt = Math.max(hideAt, performance.now() + ms);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => btn.classList.add('is-idle'), hideAt - performance.now());
  }

  btn.addEventListener('click', () => {
    const action = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    action.catch(() => {});
  });
  document.addEventListener('fullscreenchange', render);
  for (const type of ['pointermove', 'pointerdown', 'keydown']) {
    document.addEventListener(type, () => showFor(FULLSCREEN_BUTTON_ACTIVITY_MS));
  }

  render();
  showFor(FULLSCREEN_BUTTON_INITIAL_MS);
}

// Switches this page to the view, in response to a click: goes fullscreen
// where the browser can (it must be requested within the click), and
// replaces the address - and the history entry - with the viewer link, so
// nobody at the screen can go "back" to the controls, and a reload shows
// the plain view.
function switchToViewer(viewerToken) {
  if (document.fullscreenEnabled) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  history.replaceState(null, '', `/view.html?token=${viewerToken}`);
  showViewer(viewerToken);
}
