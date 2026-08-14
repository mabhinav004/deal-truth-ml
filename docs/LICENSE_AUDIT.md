# License audit

Verified from public model cards and project licenses. Do not treat this as legal advice.

| Component                               | Source                            | License (as documented upstream)                                                    |
| --------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| This repository                         | Deal Truth ML                     | MIT (`LICENSE`)                                                                     |
| NestJS                                  | https://github.com/nestjs/nest    | MIT                                                                                 |
| Zod                                     | https://github.com/colinhacks/zod | MIT                                                                                 |
| Cloudflare Workers / Workers AI hosting | Cloudflare                        | Platform terms; not a model license                                                 |
| `@cf/openai/gpt-oss-120b`               | OpenAI gpt-oss via Cloudflare     | Apache-2.0 (OpenAI gpt-oss model card: https://huggingface.co/openai/gpt-oss-120b ) |
| `@cf/qwen/qwen3-30b-a3b-fp8`            | Qwen via Cloudflare               | Apache-2.0 (Qwen3 model series cards on Hugging Face)                               |
| `@cf/qwen/qwen3-embedding-0.6b`         | Qwen via Cloudflare               | Apache-2.0 (https://huggingface.co/Qwen/Qwen3-Embedding-0.6B )                      |
| `@cf/baai/bge-reranker-base`            | BAAI via Cloudflare               | MIT (https://huggingface.co/BAAI/bge-reranker-base )                                |

Cloudflare-hosted inference is subject to Cloudflare’s Workers AI terms and the 10,000 neuron/day Free allocation. Using a hosted model is not the same as redistributing weights.

Historical ONNX stack (GoEmotions, ModernBERT, BGE-small, FLAN-T5) is **not used** in this repository after the hybrid-infra pivot. Their licenses are not claimed here.

If an upstream card is ambiguous, treat the component as **not verified permissive** until confirmed.
