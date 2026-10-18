// timerDisplay.js
// Renders the live countdown (digits + the circular fill) into a container
// element. Shared between admin.html and view.html so both look identical.
// Runs its own animation loop and derives the current remaining time from
// `remainingMs` and the time elapsed since the state arrived (see
// stampReceived in api.js), so it stays smooth between the state updates
// pushed over SSE.

const WARNING_SECONDS = 10; // matches the "rømmer sig" cue the moderator used to give manually

function formatTime(totalSeconds) {
  const sign = totalSeconds < 0 ? '-' : '';
  const abs = Math.round(Math.abs(totalSeconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${String(s).padStart(2, '0')}`;
}

function createTimerDisplay(container, { showTitleInStatus = false } = {}) {
  container.innerHTML = `
    <div class="timer-shape" data-shape>
      <div class="timer-digits" data-digits>00:00</div>
    </div>
    <div class="timer-status" data-status></div>
  `;

  const shapeEl = container.querySelector('[data-shape]');
  const digitsEl = container.querySelector('[data-digits]');
  const statusEl = container.querySelector('[data-status]');

  let state = null;
  let rafId = null;

  function liveRemaining() {
    if (!state) return 0;
    if (!state.running) return state.remainingMs / 1000;
    return (state.remainingMs - (performance.now() - state.receivedAt)) / 1000;
  }

  function render() {
    const remaining = liveRemaining();
    const duration = state.duration || 1;
    const overtime = remaining < 0;
    const warning = !overtime && remaining <= WARNING_SECONDS;
    // Once in overtime there's no "remaining" fraction of the original
    // duration left to draw - show the shape fully filled (in --danger,
    // via the is-overtime class below) instead of letting it clamp to empty.
    const fraction = overtime ? 1 : Math.min(1, Math.max(0, remaining / duration));

    digitsEl.textContent = formatTime(remaining);

    container.classList.toggle('is-running', state.running);
    container.classList.toggle('is-paused', !state.running);
    container.classList.toggle('is-warning', warning);
    container.classList.toggle('is-overtime', overtime);

    const angle = fraction * 360;
    shapeEl.style.background = `conic-gradient(var(--fill) 0deg ${angle}deg, var(--track) ${angle}deg 360deg)`;

    const statusWord = overtime ? 'Overtid' : state.running ? 'Taler' : 'Pause';
    statusEl.textContent = showTitleInStatus && state.title ? `${statusWord} (${state.title})` : statusWord;
  }

  function loop() {
    render();
    rafId = requestAnimationFrame(loop);
  }

  function update(newState) {
    state = newState;
    if (!rafId) loop();
  }

  function destroy() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  return { update, destroy };
}
