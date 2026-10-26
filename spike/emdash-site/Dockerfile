FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
RUN npm install --no-audit --no-fund
COPY scripts ./scripts
RUN node scripts/patch-emdash-ssrf.mjs
COPY . .
ARG EMDASH_SITE_URL=http://localhost:4321
ENV EMDASH_SITE_URL=$EMDASH_SITE_URL
ARG DATABASE_URL
ARG UPLOADS_DIR=/app/data/uploads
RUN DATABASE_URL=$DATABASE_URL UPLOADS_DIR=$UPLOADS_DIR npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/seed ./seed
RUN mkdir -p /app/data/uploads
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
