// duration.js
// mm:ss <-> seconds helpers, plus a small "duration input" component (a
// text field showing mm:ss with its own up/down step buttons) used wherever
// a speaking-time length is set: the create form and the admin adjust field.

const DURATION_STEP_SECONDS = 10;
const DURATION_MIN_SECONDS = 5;
const DURATION_MAX_SECONDS = 24 * 60 * 60; // the server's maximum (MAX_DURATION_SECONDS)

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Parses "mm:ss", or a bare number of seconds, into whole seconds.
// Returns null if the text isn't in either form.
function parseDuration(text) {
  const trimmed = String(text).trim();
  const withColon = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (withColon) return Number(withColon[1]) * 60 + Number(withColon[2]);
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return null;
}

// Renders the mm:ss field + steppers into `container`. Returns
// { getSeconds, setSeconds } for the caller to read/drive the value.
function createDurationInput(container, { seconds = DURATION_MIN_SECONDS } = {}) {
  container.innerHTML = `
    <div class="duration-input">
      <input type="text" inputmode="numeric" class="duration-field" aria-label="Taletid (min:sek)" />
      <div class="duration-steppers">
        <button type="button" class="duration-up" aria-label="Forøg taletid">▲</button>
        <button type="button" class="duration-down" aria-label="Formindsk taletid">▼</button>
      </div>
    </div>
  `;

  const fieldEl = container.querySelector('.duration-field');
  const upEl = container.querySelector('.duration-up');
  const downEl = container.querySelector('.duration-down');

  function clamp(value) {
    return Math.min(DURATION_MAX_SECONDS, Math.max(DURATION_MIN_SECONDS, Math.round(value)));
  }

  let current = clamp(seconds);

  function render() {
    fieldEl.value = formatDuration(current);
  }

  function setSeconds(value) {
    current = clamp(value);
    render();
  }

  function step(delta) {
    setSeconds(current + delta);
  }

  fieldEl.addEventListener('blur', () => {
    const parsed = parseDuration(fieldEl.value);
    setSeconds(parsed === null ? current : parsed);
  });
  fieldEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') fieldEl.blur();
    if (event.key === 'ArrowUp') { event.preventDefault(); step(DURATION_STEP_SECONDS); }
    if (event.key === 'ArrowDown') { event.preventDefault(); step(-DURATION_STEP_SECONDS); }
  });
  upEl.addEventListener('click', () => step(DURATION_STEP_SECONDS));
  downEl.addEventListener('click', () => step(-DURATION_STEP_SECONDS));

  render();

  return { getSeconds: () => current, setSeconds };
}
