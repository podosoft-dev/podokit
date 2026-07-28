# syntax=docker/dockerfile:1

# The npm that reads package-lock.json must be the major that wrote it. node:22
# bundles npm 10, and a lockfile written by npm 11 records platform-specific
# packages as extraneous with no `optional` flag; npm 10 rejects those with
# EBADPLATFORM instead of skipping them, so `npm ci` fails inside the image while
# `npm install` on the developer's machine is fine. Keep this in step with the npm
# the project is developed with.
ARG NPM_VERSION=11.17.0

# See apps/api/Dockerfile for why the workspace manifests are collected rather than
# listed: an absent workspace package.json does not fail `npm ci`, it silently
# changes the resolved dependency tree inside the image.
FROM node:22-alpine AS manifests
WORKDIR /src
COPY . .
RUN mkdir -p /app \
    && cp package.json package-lock.json /app/ \
    && find . -name package.json -not -path "*/node_modules/*" \
         -exec sh -c 'mkdir -p "/app/$(dirname "$1")" && cp "$1" "/app/$1"' _ {} \;

FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=manifests /app ./
ARG NPM_VERSION
RUN npm i -g "npm@${NPM_VERSION}"
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY --from=manifests /app ./
ARG NPM_VERSION
RUN npm i -g "npm@${NPM_VERSION}"
# The runtime tree for this image only.
#
# Scoping to the one workspace matters: --omit=dev at the root still installs the
# union of every workspace's production dependencies, so the API image carried Vite
# and the web image carried Nest. Measured on a generated project, this is 198
# packages instead of 283. TypeScript stays either way -- typeorm depends on ts-node,
# which depends on it, so it is a production dependency and not bloat.
RUN npm ci --omit=dev --no-audit --no-fund --workspace=apps/web --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app ./
COPY . .
RUN if [ -d packages ]; then \
      for manifest in packages/*/package.json; do \
        [ -e "$manifest" ] || continue; \
        npm run build --if-present --workspace "$(dirname "$manifest")"; \
      done; \
    fi
RUN npm run build --workspace=apps/web
# The runtime needs the real workspace package directories, not just the symlinks
# npm leaves in node_modules pointing at them. Without this the image boots and
# dies on "Cannot find module <package>" -- a dangling link, at runtime only.
# mkdir keeps the COPY valid for a project that has no packages/ at all.
RUN mkdir -p /app/packages

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S -g 101 app && adduser -S -D -H -u 100 -G app app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=manifests /app/apps/web ./apps/web
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web/build ./apps/web/build
# The entry and the modules it imports run OUTSIDE the bundle, so they ship as
# source. Without them the image falls back to an entry that cannot answer a
# WebSocket upgrade.
COPY --from=build /app/apps/web/server.js ./apps/web/server.js
COPY --from=build /app/apps/web/src/lib/server ./apps/web/src/lib/server
WORKDIR /app/apps/web
USER 100:101
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
