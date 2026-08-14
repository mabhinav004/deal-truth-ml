import { createApp, type HttpApp } from '../src/http/create-app';
import type { Env } from '../src/env';
import { SALES_LABELS } from '../src/taxonomies/sales-labels';

export async function withApp<T>(env: Env, fn: (app: HttpApp) => Promise<T>): Promise<T> {
  const app = await createApp(env);
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

function allMessageText(inputs: Record<string, unknown>): string {
  const messages = inputs.messages;
  if (!Array.isArray(messages)) {
    return '';
  }
  return messages
    .map((message) => {
      const row = message as { content?: string };
      return typeof row.content === 'string' ? row.content : '';
    })
    .join('\n');
}

function extractIds(prompt: string): string[] {
  const ids = [...prompt.matchAll(/id=([^\s]+)/g)].map((match) => match[1] ?? 'item');
  if (ids.length > 0) {
    return ids;
  }
  const bracket = [...prompt.matchAll(/\[([^\]|]+)\|/g)].map((match) => match[1] ?? '1');
  return bracket.length > 0 ? bracket : ['1'];
}

export class FakeAi {
  failQuota = false;
  invalidJsonOnce = false;
  calls: { model: string; inputs: Record<string, unknown> }[] = [];

  isReady(): boolean {
    return true;
  }

  async run(model: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ model, inputs });
    if (this.failQuota) {
      throw new Error('Workers AI quota exceeded: 10000 neurons');
    }
    if (model.includes('embedding')) {
      const texts = Array.isArray(inputs.text)
        ? (inputs.text as string[])
        : [String(inputs.text ?? '')];
      return {
        data: texts.map(() => {
          const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0.01));
          return { embedding: vector };
        }),
      };
    }
    if (model.includes('reranker')) {
      const contexts = Array.isArray(inputs.contexts) ? inputs.contexts : [];
      return {
        response: contexts.map((_, index) => ({
          id: index,
          score: Math.max(0, 0.95 - index * 0.08),
        })),
      };
    }
    const prompt = allMessageText(inputs);
    if (this.invalidJsonOnce) {
      this.invalidJsonOnce = false;
      return { response: 'not-json' };
    }
    return { response: this.responseFor(prompt) };
  }

  private responseFor(prompt: string): string {
    if (prompt.includes('Score each text')) {
      const ids = extractIds(prompt);
      const labelIds = [...prompt.matchAll(/^- ([a-z0-9_]+):/gm)].map(
        (match) => match[1] ?? 'label',
      );
      const labels = (labelIds.length > 0 ? labelIds : SALES_LABELS.map((l) => l.id)).slice(0, 4);
      return JSON.stringify({
        items: ids.map((id) => ({
          id,
          labels: labels.map((label, index) => ({
            id: label,
            score:
              label.includes('budget') || label.includes('pricing') || index === 0 ? 0.91 : 0.12,
          })),
        })),
      });
    }
    if (prompt.includes('three independent axes')) {
      const ids = extractIds(prompt);
      return JSON.stringify({
        items: ids.map((id) => ({
          id,
          emotion: [
            { label: 'enthusiastic', score: 0.88 },
            { label: 'interested', score: 0.4 },
          ],
          buying_intent: [
            { label: 'negative', score: 0.81 },
            { label: 'weak', score: 0.55 },
          ],
          deal_signals: [{ label: 'budget_blocker', score: 0.93 }],
        })),
      });
    }
    if (prompt.includes('Stage 1')) {
      return JSON.stringify({
        pains: [
          { type: 'pain', summary: 'Manual routing cost', segment_ids: ['1'], confidence: 0.8 },
        ],
        blockers: [
          { type: 'blocker', summary: 'Budget frozen', segment_ids: ['2'], confidence: 0.9 },
        ],
        commitments: [],
        competitors: [],
        signals: [
          { type: 'praise', summary: 'Likes product', segment_ids: ['2'], confidence: 0.7 },
        ],
        objections: [],
        reality_checks: [],
      });
    }
    if (prompt.includes('Stage 2') || prompt.includes('high-quality judge')) {
      return JSON.stringify({
        customer_truth: [
          {
            summary: 'Customer likes the product but budget is frozen',
            segment_ids: ['2'],
            supported: true,
          },
        ],
        objections: [],
        commitments: [],
        risks: [
          {
            summary: 'Budget blocker until next year',
            segment_ids: ['2'],
            severity: 'critical',
            supported: true,
          },
        ],
        competitors: [],
        buying_signals: [],
        reality_checks: [],
      });
    }
    return 'Polished text without adding facts.';
  }
}

export function testEnv(
  ai: FakeAi,
  overrides: Record<string, string> = {},
): {
  AI: FakeAi;
  INTERNAL_API_TOKEN?: string;
  ENABLE_GENERATION?: string;
  MAX_BATCH_SIZE?: string;
  MAX_TEXT_CHARS?: string;
  LOG_LEVEL?: string;
  FAST_MODEL_ID?: string;
  QUALITY_MODEL_ID?: string;
  EMBEDDING_MODEL_ID?: string;
  RERANK_MODEL_ID?: string;
  EMBEDDING_DIMENSION?: string;
} {
  return {
    AI: ai,
    INTERNAL_API_TOKEN: '',
    ENABLE_GENERATION: 'true',
    MAX_BATCH_SIZE: '32',
    MAX_TEXT_CHARS: '8000',
    LOG_LEVEL: 'info',
    FAST_MODEL_ID: '@cf/qwen/qwen3-30b-a3b-fp8',
    QUALITY_MODEL_ID: '@cf/openai/gpt-oss-120b',
    EMBEDDING_MODEL_ID: '@cf/qwen/qwen3-embedding-0.6b',
    RERANK_MODEL_ID: '@cf/baai/bge-reranker-base',
    EMBEDDING_DIMENSION: '1024',
    ...overrides,
  };
}
