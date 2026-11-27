// create.js
// The front page: creates a meeting and opens its control page (index.html).
// Kept out of the page so the Content-Security-Policy can forbid inline scripts.

const form = document.getElementById('create-form');
const titleInput = document.getElementById('title');
const durationInput = createDurationInput(document.getElementById('duration'), { seconds: 90 });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  const duration = durationInput.getSeconds();

  let adminToken;
  try {
    ({ adminToken } = await createMeeting({ title, duration }));
  } catch (err) {
    const errorEl = document.getElementById('error');
    errorEl.textContent = err.message === 'too-many-meetings'
      ? 'Der er for mange møder i gang lige nu. Prøv igen senere.'
      : `Mødet kunne ikke oprettes: ${err.message}`;
    errorEl.hidden = false;
    return;
  }

  const setup = event.submitter && event.submitter.value === 'visning' ? '&setup=visning' : '';
  location.href = `${location.origin}/admin.html?token=${adminToken}${setup}`;
});
