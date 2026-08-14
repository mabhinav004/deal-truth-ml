import { describe, expect, it } from 'vitest';
import { FakeAi, testEnv, withApp } from '../helpers';

async function post(
  path: string,
  body: unknown,
  ai: FakeAi = new FakeAi(),
): Promise<{ status: number; json: Record<string, unknown>; ai: FakeAi }> {
  return withApp(testEnv(ai), async (app) => {
    const response = await app.request(`http://ml${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'contract-1' },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Record<string, unknown>, ai };
  });
}

describe('v1 contract', () => {
  it('returns the sales-label catalogue', async () => {
    await withApp(testEnv(new FakeAi()), async (app) => {
      const response = await app.request('http://ml/v1/sales-labels');
      const body = (await response.json()) as { labels: { id: string }[] };
      expect(response.status).toBe(200);
      expect(body.labels.some((label) => label.id === 'security_blocker')).toBe(true);
    });
  });

  it('classifies with threshold filtering', async () => {
    const { status, json, ai } = await post('/v1/classify', {
      items: [{ id: 'segment-1', text: 'We cannot buy until security approves it.' }],
      candidate_labels: [
        { id: 'security_blocker', hypothesis: 'Security approval blocks progress.' },
        { id: 'customer_praise', hypothesis: 'The customer praises the product.' },
      ],
      threshold: 0.5,
      top_k: 10,
    });
    expect(status).toBe(200);
    const items = json.items as {
      id: string;
      labels: { id: string; passed_threshold: boolean }[];
    }[];
    expect(items[0]?.id).toBe('segment-1');
    expect(items[0]?.labels.every((label) => label.passed_threshold)).toBe(true);
    expect(ai.calls[0]?.model).toContain('qwen3-30b');
  });

  it('classifies long batches in chunks', async () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      id: `seg-${index}`,
      text: 'Budget is frozen until next quarter.',
    }));
    const { status, json, ai } = await post('/v1/classify', { items, threshold: 0.5 });
    expect(status).toBe(200);
    expect((json.items as unknown[]).length).toBe(7);
    const classifyCalls = ai.calls.filter((call) => !call.model.includes('embedding'));
    expect(classifyCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps emotion, intent, and deal signals separate', async () => {
    const { status, json } = await post('/v1/emotions', {
      items: [
        {
          id: 'seg-1',
          text: 'I absolutely love this product, but finance froze our budget until next year.',
        },
      ],
    });
    expect(status).toBe(200);
    const item = (json.items as Record<string, unknown>[])[0];
    expect(item?.emotion).toBeTruthy();
    expect(item?.buying_intent).toBeTruthy();
    expect(item?.deal_signals).toBeTruthy();
    expect(item).not.toHaveProperty('valence_score');
  });

  it('returns 1024-dim normalized embeddings', async () => {
    const { status, json } = await post('/v1/embeddings', {
      items: [{ id: 'chunk-1', text: 'Customer requires security approval.' }],
      normalize: true,
    });
    expect(status).toBe(200);
    const item = (json.items as { dimension: number; normalized: boolean; vector: number[] }[])[0];
    expect(item?.dimension).toBe(1024);
    expect(item?.normalized).toBe(true);
    expect(item?.vector).toHaveLength(1024);
    const norm = Math.sqrt(item!.vector.reduce((sum, n) => sum + n * n, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('reranks passages', async () => {
    const { status, json } = await post('/v1/rerank', {
      query: 'Why could this deal fail?',
      passages: [
        { id: 'a', text: 'Security review is mandatory.' },
        { id: 'b', text: 'The weather is nice.' },
      ],
      top_k: 1,
    });
    expect(status).toBe(200);
    const items = json.items as { id: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('a');
  });

  it('generate returns ungrounded metadata', async () => {
    const { status, json } = await post('/v1/generate', {
      task: 'email_polish',
      input: 'Thanks for the time today.',
      max_new_tokens: 40,
      temperature: 0,
    });
    expect(status).toBe(200);
    expect(typeof json.text).toBe('string');
    expect(json.grounded).toBe(false);
  });

  it('analyze-call uses fast then quality models', async () => {
    const ai = new FakeAi();
    const { status, json } = await post(
      '/v1/analyze-call',
      {
        segments: [
          { id: '1', speaker_role: 'customer', text: 'We spend six hours routing calls.' },
          {
            id: '2',
            speaker_role: 'customer',
            text: 'I love this, but finance froze our budget until next year.',
          },
        ],
      },
      ai,
    );
    expect(status).toBe(200);
    expect(Array.isArray(json.customer_truth)).toBe(true);
    expect(Array.isArray(json.risks)).toBe(true);
    const models = json.models as { candidates: string; judge: string };
    expect(models.candidates).toContain('qwen3-30b');
    expect(models.judge).toContain('gpt-oss-120b');
    expect(ai.calls.map((call) => call.model)).toEqual([
      '@cf/qwen/qwen3-30b-a3b-fp8',
      '@cf/openai/gpt-oss-120b',
    ]);
  });

  it('repairs invalid JSON once', async () => {
    const ai = new FakeAi();
    ai.invalidJsonOnce = true;
    const { status } = await post(
      '/v1/classify',
      { items: [{ id: '1', text: 'Security must approve.' }] },
      ai,
    );
    expect(status).toBe(200);
    expect(ai.calls.length).toBe(2);
  });
});

describe('backend compat aliases', () => {
  it('POST /classify matches DealTruthMLClient results/labels shape', async () => {
    const { status, json } = await post('/classify', {
      texts: ['We cannot buy anything until security approves it.'],
      labels: ['security blocker', 'customer praise'],
    });
    expect(status).toBe(200);
    const results = json.results as { labels: { label: string; score: number }[] }[];
    expect(results).toHaveLength(1);
    expect(results[0]?.labels[0]?.label).toBeTruthy();
    expect(typeof results[0]?.labels[0]?.score).toBe('number');
  });

  it('POST /classify accepts texts without labels', async () => {
    const { status, json } = await post('/classify', {
      texts: ['We cannot buy until security approves it.'],
    });
    expect(status).toBe(200);
    const results = json.results as { labels: { label: string; score: number }[] }[];
    expect(results).toHaveLength(1);
  });

  it('POST /emotion returns labels arrays', async () => {
    const { status, json } = await post('/emotion', {
      texts: ['This is impressive, but there is no budget this year.'],
    });
    expect(status).toBe(200);
    const results = json.results as { labels: { label: string; score: number }[] }[];
    expect(results[0]?.labels.some((row) => row.label === 'enthusiastic')).toBe(true);
    expect(results[0]?.labels.some((row) => row.label === 'budget_blocker')).toBe(true);
  });

  it('POST /embed returns embedding vectors', async () => {
    const { status, json } = await post('/embed', {
      texts: ['Customer requires security approval.'],
    });
    expect(status).toBe(200);
    const results = json.results as { embedding: number[] }[];
    expect(results[0]?.embedding).toHaveLength(1024);
  });

  it('POST /generate returns text', async () => {
    const { status, json } = await post('/generate', {
      prompt: 'Summarize the call.',
      max_tokens: 40,
    });
    expect(status).toBe(200);
    expect(typeof json.text).toBe('string');
  });
});
