import { AppError } from '../core/errors';
import { logger } from '../core/logging';
import { parseJsonObject } from './json';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
  isReady(): boolean;
}

// Chat-completion metadata must never be mistaken for generated text
// (finish_reason "length", role "assistant", ids, model names, ...).
const SKIP_TEXT_KEYS = new Set([
  'thinking',
  'reasoning',
  'reasoning_content',
  'logprobs',
  'usage',
  'prompt_logprobs',
  'finish_reason',
  'stop_reason',
  'role',
  'id',
  'model',
  'object',
  'name',
  'system_fingerprint',
  'request_id',
  'created',
  'tool_calls',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectFromKeys(value: unknown, acc: string[], keys: string[]): void {
  if (typeof value === 'string') {
    if (value.trim()) {
      acc.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFromKeys(item, acc, keys);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const key of keys) {
    if (typeof value[key] === 'string' && (value[key] as string).trim()) {
      acc.push(value[key] as string);
    }
  }
  if (value.content !== undefined) {
    collectFromKeys(value.content, acc, keys);
  }
  if (value.message !== undefined) {
    collectFromKeys(value.message, acc, keys);
  }
  if (value.choices !== undefined) {
    collectFromKeys(value.choices, acc, keys);
  }
  if (value.output !== undefined) {
    collectFromKeys(value.output, acc, keys);
  }
  if (value.result !== undefined) {
    collectFromKeys(value.result, acc, keys);
  }
}

function collectFallback(value: unknown, acc: string[]): void {
  if (typeof value === 'string') {
    if (value.trim()) {
      acc.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFallback(item, acc);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (SKIP_TEXT_KEYS.has(key)) {
      continue;
    }
    collectFallback(nested, acc);
  }
}

export function extractGeneratedText(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  const preferred: string[] = [];
  collectFromKeys(payload, preferred, ['output_text', 'response', 'text']);
  // Some Workers AI chat models return the same text in both `response` and
  // `choices[].message.content`; keep one copy.
  const unique = [...new Set(preferred.map((s) => s.trim()).filter(Boolean))];
  const joined = unique.join('\n').trim();
  if (joined) {
    return joined;
  }
  const fallback: string[] = [];
  collectFallback(payload, fallback);
  const rest = fallback.join('\n').trim();
  if (rest) {
    return rest;
  }
  throw new AppError('UPSTREAM_AI_ERROR', 'Upstream model returned no text.');
}

function sanitizeUpstreamMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(cfut_|sk-|eyJ)[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function mapUpstreamError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes('quota') ||
    lower.includes('neuron') ||
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('capacity')
  ) {
    return new AppError('QUOTA_EXCEEDED', 'Workers AI free allocation is exhausted.', {
      retryable_hint: 'Retry after the daily neuron budget resets.',
    });
  }
  return new AppError('UPSTREAM_AI_ERROR', 'Workers AI request failed.', {
    reason: 'upstream_error',
    upstream: sanitizeUpstreamMessage(message),
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class ModelClient {
  constructor(private readonly ai: AiBinding) {}

  async run(model: string, inputs: Record<string, unknown>): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const started = Date.now();
      logger.debug('ai.run.start', { model, attempt: attempt + 1 });
      try {
        const result = await this.ai.run(model, inputs);
        logger.info('ai.run.ok', {
          model,
          attempt: attempt + 1,
          duration_ms: Date.now() - started,
        });
        return result;
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        const mapped = mapUpstreamError(error);
        logger.warn('ai.run.fail', {
          model,
          attempt: attempt + 1,
          duration_ms: Date.now() - started,
          error_code: mapped.code,
        });
        if (mapped.code === 'QUOTA_EXCEEDED' || attempt === 1) {
          throw mapped;
        }
        lastError = error;
        await delay(400);
      }
    }
    throw mapUpstreamError(lastError);
  }

  async generateText(
    model: string,
    messages: ChatMessage[],
    options: { maxTokens?: number; temperature?: number; json?: boolean } = {},
  ): Promise<string> {
    const payload = await this.run(model, {
      messages,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0,
      stream: false,
      enable_thinking: false,
      thinking: false,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    });
    return extractGeneratedText(payload);
  }

  async generateJson(
    model: string,
    messages: ChatMessage[],
    options: { maxTokens?: number; temperature?: number } = {},
  ): Promise<unknown> {
    const text = await this.generateText(model, messages, { ...options, json: true });
    return parseJsonObject(text);
  }

  async embed(model: string, texts: string[]): Promise<number[][]> {
    const payload = await this.run(model, { text: texts });
    return extractEmbeddings(payload, texts.length);
  }

  async rerank(
    model: string,
    query: string,
    contexts: string[],
    topK?: number,
  ): Promise<{ index: number; score: number }[]> {
    const payload = await this.run(model, {
      query,
      contexts: contexts.map((text) => ({ text })),
      ...(topK ? { top_k: topK } : {}),
    });
    return extractRerank(payload, contexts.length);
  }
}

function extractEmbeddings(payload: unknown, expected: number): number[][] {
  if (!isRecord(payload)) {
    throw new AppError('UPSTREAM_AI_ERROR', 'Embedding response was not an object.');
  }
  let vectors: unknown = payload.data ?? payload.embeddings ?? payload.result;
  if (isRecord(vectors) && Array.isArray(vectors.data)) {
    vectors = vectors.data;
  }
  if (!Array.isArray(vectors)) {
    throw new AppError('UPSTREAM_AI_ERROR', 'Embedding response missing vectors.');
  }
  const out: number[][] = [];
  for (const item of vectors) {
    if (Array.isArray(item) && item.every((n) => typeof n === 'number')) {
      out.push(item as number[]);
      continue;
    }
    if (isRecord(item) && Array.isArray(item.embedding)) {
      out.push((item.embedding as unknown[]).map((n) => Number(n)));
    }
  }
  if (out.length !== expected) {
    throw new AppError('UPSTREAM_AI_ERROR', 'Embedding response item count mismatch.', {
      expected,
      actual: out.length,
    });
  }
  return out;
}

function extractRerank(payload: unknown, count: number): { index: number; score: number }[] {
  let rows: unknown = payload;
  if (isRecord(payload)) {
    rows = payload.response ?? payload.result ?? payload.data ?? payload.results ?? payload;
  }
  if (!Array.isArray(rows)) {
    throw new AppError('UPSTREAM_AI_ERROR', 'Rerank response missing scores.');
  }
  const mapped = rows.map((row, fallbackIndex) => {
    if (typeof row === 'number') {
      return { index: fallbackIndex, score: row };
    }
    if (isRecord(row)) {
      const index =
        typeof row.id === 'number'
          ? row.id
          : typeof row.index === 'number'
            ? row.index
            : fallbackIndex;
      const score = Number(row.score ?? row.relevance_score ?? 0);
      return { index, score };
    }
    return { index: fallbackIndex, score: 0 };
  });
  return mapped.filter((row) => row.index >= 0 && row.index < count);
}

export function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector.slice();
  }
  return vector.map((value) => value / norm);
}
