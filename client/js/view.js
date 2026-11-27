// view.js
// The view page (view.html): shows the timer for the token in the URL.
// Kept out of the page so the Content-Security-Policy can forbid inline scripts.

showViewer(new URLSearchParams(location.search).get('token'));
