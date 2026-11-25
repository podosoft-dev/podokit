# syntax=docker/dockerfile:1

FROM oven/bun:1.4.4-alpine AS manifests
WORKDIR /src
COPY . .
RUN mkdir -p /app \
    && cp package.json bun.lock bunfig.toml /app/ \
    && find . -name package.json -not -path "*/node_modules/*" \
         -exec sh -c 'mkdir -p "/app/$(dirname "$1")" && cp "$1" "/app/$1"' _ {} \;

FROM oven/bun:1.4.4-alpine AS deps
WORKDIR /app
COPY --from=manifests /app ./
RUN bun ci

FROM oven/bun:1.4.4-alpine AS prod-deps
WORKDIR /app
COPY --from=manifests /app ./
RUN bun install --production --omit=peer --frozen-lockfile --filter './apps/api'

FROM oven/bun:1.4.4-alpine AS build
WORKDIR /app
COPY --from=deps /app ./
COPY . .
RUN if [ -d packages ]; then \
      for manifest in packages/*/package.json; do \
        [ -e "$manifest" ] || continue; \
        bun run --cwd "$(dirname "$manifest")" --if-present build; \
      done; \
    fi
RUN bun run --cwd apps/api build
RUN mkdir -p /app/packages

FROM oven/bun:1.4.4-alpine AS runtime
ARG TARGETARCH
WORKDIR /app
ENV NODE_ENV=production
# System packages and tools the application adds (apps/api/image.extensions.sh,
# application-owned). Runs as root before the image switches to `bun`.
COPY apps/api/image.extensions.sh /tmp/podokit/image.extensions.sh
RUN TARGETARCH="$TARGETARCH" sh /tmp/podokit/image.extensions.sh && rm -rf /tmp/podokit
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=manifests /app/apps/api ./apps/api
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/scripts ./apps/api/scripts
# The API's own files (local object store, SQLite) go under data/. A volume
# mounted there starts with this directory's owner, so `bun` can write to it.
RUN mkdir -p /app/apps/api/data && chown bun:bun /app/apps/api/data
WORKDIR /app/apps/api
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? '3000') + '/health/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "dist/main.js"]
