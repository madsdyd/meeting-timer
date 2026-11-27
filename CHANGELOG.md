# Changelog

Notable changes to Talerstol Timer. A version is the date and time of the build, e.g. `2026-10-18-1530`, which is
also the tag of the docker image and the git tag. See "Releasing" in [README.md](README.md).

## Unreleased

- The speaking time is at most 24 hours, and a title at most 200 characters; the server rejects longer ones.
- Meetings are deleted after 24 hours without activity (no actions and no open view).
- The container's memory is limited to 256 MB.
- At most 100 meetings at a time: a new one replaces the longest idle meeting without an open view, and is refused
  (with a message on the front page) only if every meeting has one. A meeting has at most 10 open views; a new one
  closes the oldest, which reconnects by itself.

## 2026-11-26

- A short guide for users at `/vejledning.html`, linked from the front page, that prints on one A4 page.
  `tools/vejledning-billeder` takes its screenshots again.
- "Opret og vis på denne skærm" now comes first on the front page and is what Enter in a field does, matching the
  guide. "Opret og styr herfra" comes second.
- The front page asks what this device is for: "Opret og styr herfra" (as before) or "Opret og vis på denne skærm".
  The latter shows "Forbind din telefon" with a large QR code for the control link and a "Start visning" button,
  which switches the screen to the view and fullscreen in one tap. "Brug denne skærm som visning" on the control page
  now also goes fullscreen.
- Fixed: elements meant to be hidden were shown, e.g. the empty control page while loading.

## 2026-11-24

- Kiosk use: the control page can show a QR code for its own link ("Styr fra en anden enhed"), so control can move
  to a phone while the device the meeting was created on becomes the display ("Brug denne skærm som visning").
- The view keeps the screen on while it is open (Screen Wake Lock, needs https) and has a fullscreen button that
  stays visible for the first 30 seconds and for 5 seconds after activity.

## 2026-10-18

- Fixed: the countdown could drift from the server over a long meeting, so speakers got less (or more) time than
  set. The clock offset was measured once when a page was opened, so a device or server clock adjusted later (NTP,
  sleep, a phone correcting its clock) shifted every countdown. Server and clients now count with a monotonic clock
  from `remainingMs` (new in the state), the SSE stream sends the state every 10 seconds while the timer runs (and a
  keepalive while paused), and a page reconnects when it becomes visible again. Pause/start no longer round to whole
  seconds. The state no longer has `now`.
- Licensed under EUPL-1.2, following the REUSE specification.
- Versions and releases: `release.sh` (also `make release`) builds the docker image `meeting-timer:<version>`, where
  the version is the date and time of the build, and tags the commit with the version. The server logs the version
  at startup.
- A `Makefile` installs, tests and builds the docker image.
- Docker compose: a fixed project name (`meeting-timer`), the image is set with `MEETING_TIMER_IMAGE`, and the logs
  are limited in size.
- `.env.example`, a template for the non-committed `.env` read by docker compose.
