import { CloudflareWorkersAi, UnconfiguredAi } from './ai/cloudflare-ai';
import type { AiBinding } from './ai/client';
import type { Env } from './env';

export function envFromProcess(): Env {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
  const ai: AiBinding =
    accountId && apiToken
      ? new CloudflareWorkersAi({ accountId, apiToken })
      : new UnconfiguredAi();
  return {
    AI: ai,
    INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN,
    ENABLE_GENERATION: process.env.ENABLE_GENERATION,
    MAX_BATCH_SIZE: process.env.MAX_BATCH_SIZE,
    MAX_TEXT_CHARS: process.env.MAX_TEXT_CHARS,
    LOG_LEVEL: process.env.LOG_LEVEL,
    FAST_MODEL_ID: process.env.FAST_MODEL_ID,
    QUALITY_MODEL_ID: process.env.QUALITY_MODEL_ID,
    EMBEDDING_MODEL_ID: process.env.EMBEDDING_MODEL_ID,
    RERANK_MODEL_ID: process.env.RERANK_MODEL_ID,
    EMBEDDING_DIMENSION: process.env.EMBEDDING_DIMENSION,
  };
}

export function parseListenPort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return parsed;
}
