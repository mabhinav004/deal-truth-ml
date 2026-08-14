# Hosting

## Local (NestJS)

```bash
cp .env.example .env
# set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
make setup
make dev                 # :8081
```

Inference is **Workers AI** via the Cloudflare REST API. No local weights.

Point **deal-truth**:

```text
ML_SERVICE_BASE_URL=http://localhost:8081
ML_SERVICE_API_KEY=
ML_GENERATION_ENABLED=true
```

## Production (Render, no Docker)

Native Node web service:

```text
Build: npm ci && npm run build
Start: npm run start:prod
Health: /health/live
```

Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `INTERNAL_API_TOKEN`. Set `HUSKY=0`.

```text
ML_SERVICE_BASE_URL=https://<your-service>.onrender.com
ML_SERVICE_API_KEY=<same as INTERNAL_API_TOKEN>
```

## Observability

JSON logs: request ID, item/character counts, model, duration, named error. No transcript text. No Prometheus `/metrics`.

## Quota

Workers Free: 10,000 neurons/day. Exhaustion → HTTP 429 `QUOTA_EXCEEDED`.
