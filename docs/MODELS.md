# Models

All inference is Cloudflare Workers AI. Model IDs are env vars and can be overridden.

| Role    | ID                              | Notes                                                                                         |
| ------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| Fast    | `@cf/qwen/qwen3-30b-a3b-fp8`    | MoE, ~3B active params per pass. Segment classify, emotions, stage-1 candidates, most polish. |
| Quality | `@cf/openai/gpt-oss-120b`       | 120B class, 128K context, structured responses. Judge, Ask synthesis, high-stakes reasoning.  |
| Embed   | `@cf/qwen/qwen3-embedding-0.6b` | 1024-dim, 8,192-token context. Replaces BGE-small 384-dim.                                    |
| Rerank  | `@cf/baai/bge-reranker-base`    | Query + passages → relevance scores.                                                          |

Docs:

- https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/
- https://developers.cloudflare.com/workers-ai/models/qwen3-embedding-0.6b/
- https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/
- https://blog.cloudflare.com/openai-gpt-oss-on-workers-ai/

## Routing rules

1. Per-segment or high-volume → fast path.
2. Whole-call reasoning and judge → quality path.
3. Never send the full transcript to 120B when candidates already exist; send candidates + relevant segments.
4. Embeddings and rerank never go through chat models.
5. Generation is optional (`ENABLE_GENERATION=false` → `GENERATION_DISABLED`).

## Neuron costs (indicative, Cloudflare accounting)

GPT-OSS-120B (published equivalents):

- ~31,818 neurons / million input tokens
- ~68,182 neurons / million output tokens

Example 5k in + 2k out ≈ 295 neurons.

Qwen3-30B-A3B input is listed around 4,625 neurons / million tokens — use it for volume.

Free allocation: 10,000 neurons/day on Workers Free. Exhaustion returns `QUOTA_EXCEEDED` and does not auto-bill on that plan.

## Strict JSON

Chat models are prompted for JSON only. Output is parsed, validated with zod, and repaired **once**. A second failure is `SCHEMA_INVALID`. Classify and emotion batches are chunked (3–4 items) so Qwen does not hit max_tokens and return truncated JSON.

Models must return segment IDs, never timestamps or invented quotes.
