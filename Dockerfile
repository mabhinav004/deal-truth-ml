FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
ENV HUSKY=0
RUN npm ci

COPY wrangler.jsonc tsconfig.json ./
COPY src ./src
COPY docs ./docs
COPY worker-configuration.d.ts ./
COPY scripts/start.sh ./scripts/start.sh

RUN chmod +x scripts/start.sh \
  && npx wrangler deploy --dry-run --outdir dist

ENV PORT=8081
EXPOSE 8081

HEALTHCHECK --interval=5s --timeout=5s --start-period=40s --retries=12 \
  CMD curl -fsS http://127.0.0.1:8081/health/live || exit 1

CMD ["bash", "scripts/start.sh"]
