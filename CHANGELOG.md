# Changelog

Notable changes to Talerstol Timer. A version is the date and time of the build, e.g. `2026-10-18-1530`, which is
also the tag of the docker image and the git tag. See "Releasing" in [README.md](README.md).

## Unreleased

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
