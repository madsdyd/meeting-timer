# Changelog

Notable changes to Talerstol Timer. A version is the date and time of the build, e.g. `2026-10-18-1530`, which is
also the tag of the docker image and the git tag. See "Releasing" in [README.md](README.md).

## Unreleased

- Licensed under EUPL-1.2, following the REUSE specification.
- Versions and releases: `release.sh` (also `make release`) builds the docker image `meeting-timer:<version>`, where
  the version is the date and time of the build, and tags the commit with the version. The server logs the version
  at startup.
- A `Makefile` installs, tests and builds the docker image.
- Docker compose: a fixed project name (`meeting-timer`), the image is set with `MEETING_TIMER_IMAGE`, and the logs
  are limited in size.
