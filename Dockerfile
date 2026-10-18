# syntax=docker/dockerfile:1

# --- deps: install production dependencies only, in their own layer ---
FROM node:24-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# --- runtime: minimal image, no build tools, no dev dependencies ---
FROM node:24-alpine
ENV NODE_ENV=production
# The version, set by release.sh. Logged by the server at startup.
ARG VERSION=dev
ENV MEETING_TIMER_VERSION=${VERSION}

WORKDIR /app
COPY --from=deps --chown=node:node /app/server/node_modules ./server/node_modules
COPY --chown=node:node server/package.json server/package-lock.json ./server/
COPY --chown=node:node server/server.js server/meetingStore.js ./server/
COPY --chown=node:node client ./client

WORKDIR /app/server
USER node

EXPOSE 3000
CMD ["node", "server.js"]
