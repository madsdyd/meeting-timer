// admin.js
// The control page (admin.html).
// Kept out of the page so the Content-Security-Policy can forbid inline scripts.

const params = new URLSearchParams(location.search);
const token = params.get('token');
const errorEl = document.getElementById('error');

function fail(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

if (!token) {
  fail('Mangler token i linket.');
} else {
  init();
}

async function init() {
  let initial;
  try {
    initial = await getMeetingState(token);
  } catch (err) {
    return fail('Kunne ikke finde mødet. Tjek at linket er korrekt.');
  }
  if (initial.role !== 'admin') {
    return fail('Dette link giver ikke adgang til at styre timeren.');
  }

  const adminUrl = `${location.origin}/admin.html?token=${token}`;

  if (params.get('setup') === 'visning') {
    return initSetup(initial, adminUrl);
  }

  document.getElementById('app').hidden = false;
  document.getElementById('meeting-title').textContent = initial.title;
  const durationInput = createDurationInput(document.getElementById('duration'), { seconds: initial.duration });

  const viewerUrl = `${location.origin}/view.html?token=${initial.viewerToken}`;
  document.getElementById('viewer-link').textContent = viewerUrl;
  document.getElementById('viewer-open').href = viewerUrl;
  document.getElementById('viewer-qr').innerHTML =
    `<img src="${qrCodeUrl(viewerUrl)}" alt="QR-kode til visningslink" />`;

  setupShareButton(document.getElementById('btn-share-viewer'), viewerUrl, initial.title, 'visningslink');

  document.getElementById('admin-link').textContent = adminUrl;
  document.getElementById('admin-qr').innerHTML =
    `<img src="${qrCodeUrl(adminUrl)}" alt="QR-kode til styringslink" />`;
  setupShareButton(document.getElementById('btn-share-admin'), adminUrl, initial.title, 'styringslink');

  const display = createTimerDisplay(document.getElementById('timer-container'));

  let latest = initial;
  display.update(latest);

  const unsubscribe = subscribeToMeeting(token, (state) => {
    latest = state;
    display.update(state);
  });

  document.getElementById('btn-become-viewer').addEventListener('click', () => {
    unsubscribe();
    display.destroy();
    switchToViewer(initial.viewerToken);
  });

  document.getElementById('btn-start').addEventListener('click', () => startMeeting(token).catch(showApiError));
  document.getElementById('btn-pause').addEventListener('click', () => pauseMeeting(token).catch(showApiError));
  document.getElementById('btn-reset').addEventListener('click', () => resetMeeting(token).catch(showApiError));
  document.getElementById('btn-restart').addEventListener('click', () => restartMeeting(token).catch(showApiError));
  document.getElementById('btn-adjust').addEventListener('click', () => {
    adjustMeeting(token, durationInput.getSeconds()).catch(showApiError);
  });
}

function initSetup(initial, adminUrl) {
  document.getElementById('setup').hidden = false;
  document.getElementById('setup-meeting-title').textContent = initial.title;
  document.getElementById('setup-qr').innerHTML =
    `<img src="${qrCodeUrl(adminUrl)}" alt="QR-kode til styringslink" />`;
  setupShareButton(document.getElementById('btn-share-setup'), adminUrl, initial.title, 'styringslink');
  document.getElementById('btn-start-viewer').addEventListener('click', () => switchToViewer(initial.viewerToken));
}

function showApiError(err) {
  fail(`Handling fejlede: ${err.message}`);
}

// On mobile, hand the link to the OS share sheet; elsewhere, copy it to
// the clipboard - either way sparing people from selecting/copying the
// URL text by hand to paste it into a mail or chat.
const COPY_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const SHARE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>';
const CHECK_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function setupShareButton(btn, url, title, linkName) {
  const canShare = typeof navigator.share === 'function';

  const label = canShare ? `Del ${linkName}` : `Kopiér ${linkName}`;
  btn.innerHTML = canShare ? SHARE_ICON : COPY_ICON;
  btn.setAttribute('aria-label', label);
  btn.title = label;

  btn.addEventListener('click', async () => {
    if (canShare) {
      try {
        await navigator.share({ url, title });
      } catch (err) {
        // AbortError etc. when the user dismisses the share sheet - nothing to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      btn.innerHTML = CHECK_ICON;
      setTimeout(() => { btn.innerHTML = COPY_ICON; }, 1500);
    } catch (err) {
      fail('Kunne ikke kopiere linket.');
    }
  });
}
