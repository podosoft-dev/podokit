# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY tests/package.json ./tests/package.json
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=apps/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Keep the adapter-node proxy above the 2 MiB application upload policy so the
# API can return stable validation codes after accounting for multipart framing.
ENV BODY_SIZE_LIMIT=3M
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/node_modules ./node_modules
COPY --from=deps /app/apps/web ./apps/web
COPY --from=build /app/apps/web/build ./apps/web/build
WORKDIR /app/apps/web
USER app
EXPOSE 3000
CMD ["node", "build"]
