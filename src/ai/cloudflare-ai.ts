import { AppError } from '../core/errors';
import type { AiBinding } from './client';

const WORKERS_AI_ACCOUNTS_URL = 'https://api.cloudflare.com/client/v4/accounts';
const AI_TIMEOUT_MS = 120_000;
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const MODEL_ID_PATTERN = /^@[\w.-]+\/[\w./-]+$/;

export interface CloudflareAiCredentials {
  accountId: string;
  apiToken: string;
}

export class UnconfiguredAi implements AiBinding {
  isReady(): boolean {
    return false;
  }

  async run(_model: string, _inputs: Record<string, unknown>): Promise<unknown> {
    throw new AppError('UPSTREAM_AI_ERROR', 'Cloudflare Workers AI is not configured.');
  }
}

export class CloudflareWorkersAi implements AiBinding {
  private readonly accountId: string;
  private readonly apiToken: string;

  constructor(credentials: CloudflareAiCredentials) {
    if (!ACCOUNT_ID_PATTERN.test(credentials.accountId)) {
      throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character hex account id.');
    }
    if (!credentials.apiToken.trim()) {
      throw new Error('CLOUDFLARE_API_TOKEN is required.');
    }
    this.accountId = credentials.accountId;
    this.apiToken = credentials.apiToken;
  }

  isReady(): boolean {
    return true;
  }

  async run(model: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (!MODEL_ID_PATTERN.test(model)) {
      throw new AppError('INVALID_REQUEST', 'Unsupported model id.');
    }
    const url = `${WORKERS_AI_ACCOUNTS_URL}/${this.accountId}/ai/run/${model}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(inputs),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'fetch failed';
      throw new AppError('UPSTREAM_AI_ERROR', 'Workers AI request failed.', {
        reason: 'network_error',
        upstream: message.slice(0, 240),
      });
    }
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok || !isSuccessPayload(payload)) {
      throw mapHttpError(response.status, payload);
    }
    return unwrapResult(payload);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSuccessPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.success === true;
}

function unwrapResult(payload: unknown): unknown {
  if (isRecord(payload) && 'result' in payload) {
    return payload.result;
  }
  return payload;
}

function firstErrorMessage(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.errors) || payload.errors.length === 0) {
    return `HTTP error`;
  }
  const first = payload.errors[0];
  if (isRecord(first) && typeof first.message === 'string') {
    return first.message;
  }
  return 'HTTP error';
}

function mapHttpError(status: number, payload: unknown): AppError {
  const message = firstErrorMessage(payload);
  const lower = message.toLowerCase();
  if (
    status === 429 ||
    lower.includes('quota') ||
    lower.includes('neuron') ||
    lower.includes('rate limit')
  ) {
    return new AppError('QUOTA_EXCEEDED', 'Workers AI free allocation is exhausted.', {
      retryable_hint: 'Retry after the daily neuron budget resets.',
    });
  }
  return new AppError('UPSTREAM_AI_ERROR', 'Workers AI request failed.', {
    reason: 'upstream_error',
    upstream: message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 240),
  });
}
