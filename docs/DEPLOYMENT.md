# Deal Truth ML — deploy

Pair with `deal-truth` docs/DEPLOYMENT.md.

## Local

```bash
cp .env.example .env
# set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
make setup
make dev             # NestJS :8081
```

On the API: `ML_SERVICE_BASE_URL=http://localhost:8081`.

## Production (Render)

| Field | Value |
| --- | --- |
| Runtime | Node 20+ |
| Build | `npm ci && npm run build` |
| Start | `npm run start:prod` |
| Health | `/health/live` |

| Item | Where |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Render secret |
| `CLOUDFLARE_ACCOUNT_ID` | Render env (32-char hex) |
| `INTERNAL_API_TOKEN` | Render secret |
| `HUSKY=0` | Render env |

Then on the **API**:

```text
ML_SERVICE_BASE_URL=https://<your-service>.onrender.com
ML_SERVICE_API_KEY=<same INTERNAL_API_TOKEN>
ML_GENERATION_ENABLED=true
```

Do not put PyAI, Postgres, or SeaweedFS vars in this repo — they belong only on `deal-truth`.
