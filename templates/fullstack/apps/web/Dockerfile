# syntax=docker/dockerfile:1

FROM oven/bun:1.4.0-alpine AS manifests
WORKDIR /src
COPY . .
RUN mkdir -p /app \
    && cp package.json bun.lock bunfig.toml /app/ \
    && find . -name package.json -not -path "*/node_modules/*" \
         -exec sh -c 'mkdir -p "/app/$(dirname "$1")" && cp "$1" "/app/$1"' _ {} \;

FROM oven/bun:1.4.0-alpine AS deps
WORKDIR /app
COPY --from=manifests /app ./
RUN bun ci

FROM oven/bun:1.4.0-alpine AS prod-deps
WORKDIR /app
COPY --from=manifests /app ./
RUN bun install --production --frozen-lockfile --filter './apps/web'

FROM oven/bun:1.4.0-alpine AS build
WORKDIR /app
COPY --from=deps /app ./
COPY . .
RUN if [ -d packages ]; then \
      for manifest in packages/*/package.json; do \
        [ -e "$manifest" ] || continue; \
        bun run --cwd "$(dirname "$manifest")" --if-present build; \
      done; \
    fi
RUN bun run --cwd apps/web build
RUN mkdir -p /app/packages

FROM oven/bun:1.4.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV BODY_SIZE_LIMIT=3M
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=manifests /app/apps/web ./apps/web
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web/build ./apps/web/build
COPY --from=build /app/apps/web/server.js ./apps/web/server.js
COPY --from=build /app/apps/web/src/lib/server ./apps/web/src/lib/server
WORKDIR /app/apps/web
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD bun -e "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "server.js"]
