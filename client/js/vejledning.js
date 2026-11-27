// vejledning.js
// The guide (vejledning.html).
// Kept out of the page so the Content-Security-Policy can forbid inline scripts.

// The guide names the address it is served from, so it fits any installation.
for (const el of document.querySelectorAll('.js-host')) el.textContent = location.host;
document.getElementById('btn-print').addEventListener('click', () => window.print());
