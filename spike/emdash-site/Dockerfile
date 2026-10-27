FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
# Build the sandboxed plugin from source (its dist/ is not committed)
COPY plugins ./plugins
RUN cd plugins/migration-guard && npm install --no-audit --no-fund && npm run build
RUN npm install --no-audit --no-fund
COPY scripts ./scripts
RUN node scripts/patch-emdash.mjs
COPY . .
ARG EMDASH_SITE_URL=http://localhost:4321
ENV EMDASH_SITE_URL=$EMDASH_SITE_URL
ARG DATABASE_URL
ARG UPLOADS_DIR=/app/data/uploads
RUN DATABASE_URL=$DATABASE_URL UPLOADS_DIR=$UPLOADS_DIR npm run build

FROM node:24-bookworm-slim
# workerd (plugin sandbox) refuses to start without system CA certificates
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/seed ./seed
# node_modules/migration-guard is a symlink; workerd loads the bundle at runtime
COPY --from=builder /app/plugins/migration-guard/dist ./plugins/migration-guard/dist
COPY --from=builder /app/plugins/migration-guard/package.json /app/plugins/migration-guard/emdash-plugin.jsonc ./plugins/migration-guard/
RUN mkdir -p /app/data/uploads
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
