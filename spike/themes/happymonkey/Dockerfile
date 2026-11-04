# Build context must be spike/emdash-site with HappyMonkey overlays already applied
# (see scripts/prepare-build.sh). Tag as: docker build -t astro-cms/site:happymonkey .
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
COPY plugins ./plugins
RUN cd plugins/migration-guard && npm install --no-audit --no-fund && npm run build
RUN cd plugins/agent-guard && npm install --no-audit --no-fund && npm run build
RUN npm install --no-audit --no-fund
COPY scripts ./scripts
RUN node scripts/patch-emdash.mjs
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/seed ./seed
COPY --from=builder /app/plugins/migration-guard/dist ./plugins/migration-guard/dist
COPY --from=builder /app/plugins/migration-guard/package.json /app/plugins/migration-guard/emdash-plugin.jsonc ./plugins/migration-guard/
COPY --from=builder /app/plugins/agent-guard/dist ./plugins/agent-guard/dist
COPY --from=builder /app/plugins/agent-guard/package.json /app/plugins/agent-guard/emdash-plugin.jsonc ./plugins/agent-guard/
COPY --from=builder /app/packages/pg-search ./packages/pg-search
RUN mkdir -p /app/data/uploads
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
