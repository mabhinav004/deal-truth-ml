import { describe, expect, it } from 'vitest';
import { FakeAi, testEnv, withApp } from '../helpers';

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('auth and health', () => {
  it('serves root without auth so host probes do not 400', async () => {
    await withApp(testEnv(new FakeAi(), { INTERNAL_API_TOKEN: 'secret' }), async (app) => {
      const response = await app.request('http://ml/');
      expect(response.status).toBe(200);
      const body = await jsonOf(response);
      expect(body.health).toBe('/health/live');
    });
  });

  it('serves live and ready without auth', async () => {
    await withApp(testEnv(new FakeAi(), { INTERNAL_API_TOKEN: 'secret' }), async (app) => {
      const live = await app.request('http://ml/health/live');
      const ready = await app.request('http://ml/health/ready');
      expect(live.status).toBe(200);
      expect(ready.status).toBe(200);
      const body = await jsonOf(ready);
      expect(body.overall).toBe('ready');
    });
  });

  it('serves swagger ui and openapi json without auth', async () => {
    await withApp(testEnv(new FakeAi(), { INTERNAL_API_TOKEN: 'secret' }), async (app) => {
      const docs = await app.request('http://ml/docs');
      const spec = await app.request('http://ml/openapi.json');
      expect(docs.status).toBe(200);
      expect(docs.headers.get('Content-Type')).toContain('text/html');
      expect(await docs.text()).toContain('swagger-ui');
      expect(spec.status).toBe(200);
      const body = await jsonOf(spec);
      expect(body.openapi).toBe('3.1.0');
      const paths = body.paths as Record<string, unknown>;
      expect(paths['/classify']).toBeTruthy();
      expect(paths['/v1/classify']).toBeTruthy();
    });
  });

  it('rejects protected routes without a token when configured', async () => {
    await withApp(testEnv(new FakeAi(), { INTERNAL_API_TOKEN: 'secret' }), async (app) => {
      const response = await app.request('http://ml/v1/models');
      expect(response.status).toBe(401);
      const body = await jsonOf(response);
      const error = body.error as { code: string };
      expect(error.code).toBe('AUTH_FAILED');
      expect(body.request_id).toBeTruthy();
    });
  });

  it('accepts a matching bearer token', async () => {
    await withApp(testEnv(new FakeAi(), { INTERNAL_API_TOKEN: 'secret' }), async (app) => {
      const response = await app.request('http://ml/v1/models', {
        headers: { Authorization: 'Bearer secret' },
      });
      expect(response.status).toBe(200);
    });
  });

  it('echoes X-Request-ID', async () => {
    await withApp(testEnv(new FakeAi()), async (app) => {
      const response = await app.request('http://ml/health/live', {
        headers: { 'X-Request-ID': 'req-123' },
      });
      expect(response.headers.get('X-Request-ID')).toBe('req-123');
    });
  });
});

describe('reference docs', () => {
  it('lists allowlisted markdown without auth', async () => {
    await withApp(testEnv(new FakeAi(), { INTERNAL_API_TOKEN: 'secret' }), async (app) => {
      const response = await app.request('http://ml/v1/reference');
      expect(response.status).toBe(200);
      const body = (await response.json()) as { docs: { name: string; path: string }[] };
      const names = new Set(body.docs.map((item) => item.name));
      expect(names.has('API.md')).toBe(true);
      expect(names.has('MODELS.md')).toBe(true);
      expect(names.has('PROJECT_CONTEXT.md')).toBe(true);
    });
  });

  it('serves markdown and the API path alias', async () => {
    await withApp(testEnv(new FakeAi()), async (app) => {
      const response = await app.request('http://ml/api/v1/reference/API.md');
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/markdown');
      const text = await response.text();
      expect(text).toContain('GET /v1/reference');
    });
  });

  it('rejects path traversal and unknown names', async () => {
    await withApp(testEnv(new FakeAi()), async (app) => {
      const traversal = await app.request('http://ml/v1/reference/..%2F.env');
      const unknown = await app.request('http://ml/v1/reference/.env');
      expect(traversal.status).toBe(404);
      expect(unknown.status).toBe(404);
    });
  });
});

describe('validation and errors', () => {
  it('returns BATCH_TOO_LARGE', async () => {
    await withApp(testEnv(new FakeAi(), { MAX_BATCH_SIZE: '1' }), async (app) => {
      const response = await app.request('http://ml/v1/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { id: '1', text: 'a' },
            { id: '2', text: 'b' },
          ],
        }),
      });
      expect(response.status).toBe(413);
      const body = await jsonOf(response);
      expect((body.error as { code: string }).code).toBe('BATCH_TOO_LARGE');
    });
  });

  it('returns TEXT_TOO_LONG', async () => {
    await withApp(testEnv(new FakeAi(), { MAX_TEXT_CHARS: '4' }), async (app) => {
      const response = await app.request('http://ml/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: '1', text: 'too-long' }] }),
      });
      expect(response.status).toBe(413);
      expect(((await jsonOf(response)).error as { code: string }).code).toBe('TEXT_TOO_LONG');
    });
  });

  it('returns GENERATION_DISABLED', async () => {
    await withApp(testEnv(new FakeAi(), { ENABLE_GENERATION: 'false' }), async (app) => {
      const response = await app.request('http://ml/v1/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'email_polish', input: 'Hi' }),
      });
      expect(response.status).toBe(503);
      expect(((await jsonOf(response)).error as { code: string }).code).toBe('GENERATION_DISABLED');
    });
  });

  it('maps quota errors', async () => {
    const ai = new FakeAi();
    ai.failQuota = true;
    await withApp(testEnv(ai), async (app) => {
      const response = await app.request('http://ml/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: '1', text: 'hello' }] }),
      });
      expect(response.status).toBe(429);
      const error = (await jsonOf(response)).error as { code: string; retryable: boolean };
      expect(error.code).toBe('QUOTA_EXCEEDED');
      expect(error.retryable).toBe(true);
    });
  });
});
