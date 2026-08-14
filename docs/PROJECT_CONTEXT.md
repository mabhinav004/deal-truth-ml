# Deal Truth — Project Context

Single source of truth for **what we are building**, **how the pieces fit**, and **what this repo does**. Use this file (plus sibling-repo docs) to restore context in a future session.

Original design discussion (branded OpenGong in the chat; the product is Deal Truth): [open_gong_hackathon_chat_export.md](../open_gong_hackathon_chat_export.md).

Running backend (as of 2026-08-13):

- OpenAPI: https://deal-truth-ngrok.ngrok-free.app/docs
- Reference docs: https://deal-truth-ngrok.ngrok-free.app/api/v1/reference
- ML reference docs: https://deal-truth-ml-ngrok.ngrok-free.app/v1/reference

---

## 1. What Deal Truth is

Deal Truth is an open-source sales-call intelligence product.

A user uploads a call recording (or supplies an HTTPS recording URL). The system produces an evidence-backed call report: diarized transcript, summaries, deal insights, coaching, follow-up email, and a queryable call memory.

### Product invariant

> **NO PROOF IN THE TRANSCRIPT, NO CLAIM IN THE REPORT.**

- Every factual insight references real transcript **segment IDs**.
- Displayed quotes always come from stored transcript segments — never model-generated quotes.
- The model may infer. The **evidence layer decides whether the inference ships**.
- Unsupported claims are dropped or marked `UNCONFIRMED`.
- Absence-based risks (for example "no timeline mentioned") are marked `ABSENCE_BASED`.
- We never show a fake close probability ("84% likely to close"). We show observable deal-signal dimensions.

### Demo story

Upload call → report appears → "but summaries hallucinate" → click a claim → **hear the customer say it** → Reality Check (rep-said vs customer-said) → something the salesperson missed → Next Call Battlecard → follow-up email that **refuses unsupported commitments**.

### Signature features

Customer Truth, click-to-play evidence, Reality Check, Commitment Ledger, Deal Killers, Next Call Battlecard, Manager Brief, evidence-safe follow-up, Ask-the-Call, competitor intelligence, objection coaching, moments timeline, talk ratio.

---

## 2. Repositories

| Repo               | Path (local)                                    | Responsibility                                                           | Hosting                                                                                             |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `deal-truth` (api) | `/Users/debjyoti_pandit/Work/github/deal-truth` | FastAPI, Celery pipeline, evidence validator, reports, PyAI + ML clients | Oracle Always Free VM (2 OCPU / 12 GB): FastAPI, Celery, Valkey, Caddy. **No ML models on the VM.** |
| `deal-truth-web`   | (sibling, UI)                                   | React + Tailwind upload/report/player                                    | Cloudflare Pages                                                                                    |
| `deal-truth-ml`    | **this repo**                                   | Authenticated model-routing API                                          | Cloudflare Worker + Workers AI                                                                      |

Data lives in **Supabase Free** (PostgreSQL + pgvector + Storage), not on the VM.

Speech is **PyAI Hear** (transcript, diarization, timestamps) and **PyAI Recap** (headline, summary, action items). This ML service must not regenerate Recap output.

---

## 3. Locked hybrid infrastructure

```text
USER
  │
  ▼
Cloudflare Pages          deal-truth-web          $0
  │
  ▼ HTTPS
Oracle Always Free VM     deal-truth-api          $0
  FastAPI / Celery / Valkey / Caddy
  NO ML MODELS
  │
  ├── PyAI sandbox        Hear + Recap
  ├── Supabase Free       Postgres + pgvector + Storage
  └── deal-truth-ml       Cloudflare Worker
        └── Workers AI
              ├── GPT-OSS 120B          quality path
              ├── Qwen3 30B-A3B FP8     fast path
              ├── Qwen3 Embedding 0.6B  1024-dim
              └── BGE reranker base
```

### Why this shape

| Option                         | Verdict                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| Everything on the 12 GB ARM VM | Too slow / inaccurate for 30B–120B inference                |
| Everything on Render Free      | 512 MB, sleeps after 15 minutes, ~1 minute wake — demo risk |
| Hybrid                         | Always-on API, strong hosted models, managed DB/storage, $0 |

Oracle Always Free A1 is tied to the home region and can be unavailable or reclaimed. Prefer Mumbai (or Hyderabad) and measure PyAI latency after deploy. Fallback if Oracle capacity is refused: Render + QStash, same HTTP contracts.

---

## 4. What this repo implements

`deal-truth-ml` is a **routing layer**, not a single-model service.

```text
deal-truth-ml
      │
Model Router
      ├── FAST PATH     Qwen3-30B-A3B     classify, emotions, stage-1 candidates, most generation
      ├── QUALITY PATH  GPT-OSS-120B      analyze-call judge, qa_synthesis
      ├── RETRIEVAL     Qwen3 Embedding   1024-dim vectors
      └── RERANK        BGE reranker      Ask-the-Call top-k
```

### Intelligence pipeline (cross-repo)

```text
AUDIO → PyAI Hear → speaker-aware transcript
     → PyAI Recap → baseline summary / actions
     → Qwen3-30B  → fast candidates
     → GPT-OSS-120B → high-quality judge (candidates + relevant segments only)
     → Evidence validator (deal-truth-api) → NO PROOF → DOES NOT SHIP
     → PostgreSQL → React UI
```

Ask-the-Call:

```text
question → /v1/embeddings → pgvector top 15 (api) → /v1/rerank top 5 → GPT-OSS qa_synthesis
        → answer + segment IDs + click-to-play
```

### Emotion vs intent vs deal signals

Do **not** use GoEmotions as the primary sales sentiment engine. `/v1/emotions` returns three never-merged blocks:

- emotion: enthusiastic, interested, curious, neutral, uncertain, hesitant, concerned, frustrated, skeptical, rejecting
- buying_intent: strong_positive, positive, neutral, weak, negative
- deal_signals: pricing_blocker, security_blocker, budget_blocker, competitor_active, timeline_present, next_step_committed

Example: “I absolutely love this product, but finance froze our budget until next year.”

- Emotion: enthusiastic HIGH
- Buying intent: LOW / negative
- Deal blocker: budget CRITICAL

### Dropped from the original ONNX design

Local GoEmotions, ModernBERT zero-shot, local BGE-small (384-dim), FLAN-T5, SeaweedFS as the production blob (Supabase Storage instead), Postgres on the VM. This repo is NestJS on Node — it does not ship model weights.

Compat aliases `POST /classify`, `/emotion`, `/embed`, `/generate` still match the current Python `DealTruthMLClient` so the running backend keeps working during migration.

---

## 5. Local run (this repo + API)

```bash
cd deal-truth-ml && make setup && make dev     # :8081
# deal-truth/.env:
#   ML_SERVICE_BASE_URL=http://localhost:8081
#   ML_SERVICE_API_KEY=
cd deal-truth && make up
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are required. Details: [README](../README.md), [HOSTING.md](HOSTING.md).

## 6. Backend status (`deal-truth`, not this repo)

Done (as of 2026-08-13):

1. ~~Wire the API~~ — the API resolves this NestJS service via `ML_SERVICE_BASE_URL`
   (`http://localhost:8081` locally, or the Render HTTPS URL). Bearer = `INTERNAL_API_TOKEN`.
2. ~~Vector migration~~ — `transcript_chunks.embedding` is `VECTOR(1024)` (API migration
   `0002_embedding_1024`); Qwen3 1024-dim embeddings index cleanly.
3. Slug labels (`pain_point`) are mapped back to extractor keys API-side
   (`canonical_sales_label`); either casing is safe on `/classify`.
4. The API degrades when this Worker is down: pipeline → `PARTIAL` with warnings,
   Ask-the-Call → lexical retrieval (`retrieval_lexical_fallback`) or `no_index` — never a
   deal judgment. The UI-facing behavior is documented in the API repo
   (`docs/frontend-contract.md`, served at `/api/v1/reference/frontend-contract.md`).

Still open:

1. Adopt `/v1/analyze-call` and `/v1/rerank` in the API; compat aliases (`/classify`,
   `/emotion`, `/embed`, `/generate`) remain the live contract until then.
2. Treat `/v1/emotions` as the sales taxonomy; do not map it to GoEmotions groupings.
3. Move Postgres/storage to Supabase and deploy API/worker/Valkey/Caddy to the Oracle VM.
4. Keep Celery + Valkey (do not rewrite to QStash unless Oracle capacity fails).

---

## 7. Decision log

| Decision                                       | Rationale                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Drop local Qwen3-4B / llama.cpp                | Too slow on modest hardware                                               |
| Drop self-hosted ONNX stack in this repo       | Workers AI now hosts stronger models at $0 within 10k neurons/day         |
| Specialist routing + deterministic validator   | Extraction is classification/judgment; evidence layer remains the product |
| GPT-OSS-120B for quality, Qwen3-30B for volume | Neuron cost ~7× lower on Qwen input; 120B reserved for judge/reasoning    |
| Qwen3-Embedding 1024-dim + BGE rerank          | Proper RAG instead of toy BGE-small search                                |
| Sales taxonomy over GoEmotions                 | Domain is deal interest/hesitation, not Reddit-style emotion              |
| No close probability                           | Fake precision                                                            |
| Seek-to-timestamp audio                        | No clip pre-generation                                                    |
| Retry only infrastructure failures             | Retrying semantic failure fabricates evidence                             |
| Cloudflare Pages for UI                        | Do not spend VM CPU serving React                                         |

---

## 8. Security notes

- No secrets in Git. Tokens live in host env (`.env` locally, Render secrets in prod).
- Health endpoints are public; inference routes require bearer auth when the token is configured.
- Logs: request ID, counts, model, duration, named error — never transcript text.
- Backend must never expose PyAI keys or storage credentials to the frontend.

See [SECURITY.md](../SECURITY.md).
