# meeting-timer

Talerstol Timer: a small web app for timing speakers at meetings, see [README.md](README.md).

- `server/` – Node.js/Express: REST API, Server-Sent Events and the static client files. In memory, no database.
- `client/` – plain HTML/CSS/JavaScript, no build step
- `Dockerfile`, `compose.yaml` – the docker image and how it runs

The server and the client form one system. When changing the API, URLs or JSON structures, update `client/js/api.js`
and the pages together with the server, and the API table in README.md.

## Building and testing

- `make test` runs `npm ci` and `npm test` (node:test) in `server/`; `make image` builds the docker image.
- `npm start` in `server/` runs the app on http://localhost:3000.

## Browser testing

When testing the UI in Chrome, always start Chrome using:

    ./tools/claude-chrome

Never start Chrome with the default user profile and never access
~/.config/google-chrome or ~/.config/chromium.

## Conventions

- Versions: a version is the build date and time `YYYY-MM-DD-HHMM`. It is created only by `release.sh`, which builds
  the image and tags the commit. Never edit versions by hand (the `version` in `package.json` is not used).
- Notable changes go in the `## Unreleased` section of `CHANGELOG.md`.
- Licensed under EUPL-1.2 via `REUSE.toml`; no license headers in files. Keep `reuse lint` passing.
- Never commit personal data or secrets (exports, logs, `.env`). Local data belongs in `local/`, which is ignored.
- Keep the deliberate design choices in README.md (in memory, tokens instead of login, SSE, no build step) unless
  asked to change them.
- Docker: a multi-stage build with only production dependencies, running as the `node` user. Compose keeps a fixed
  project name, binds the port to 127.0.0.1, runs read-only without capabilities, and limits the log size. Keep
  these when changing the docker files, and add files that are not needed at runtime to `.dockerignore`.

## Working style

1. Inspect the relevant parts and the current API contract before substantial changes.
2. Make changes incrementally, and run the tests after meaningful steps.
3. Fix errors rather than merely describing them.
4. Prefer minimal, idiomatic solutions; avoid unrelated rewrites.
5. Ask before irreversible or broad architectural changes, but not about details that can be determined from the
   repository, build output or tests.
6. Never push; the user pushes. New repositories use the branch `main`.

The toolchains may not be installed. Advise the user to install tools with the system (e.g. apt); do not install
them yourself.
