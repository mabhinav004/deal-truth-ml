import { AsyncLocalStorage } from 'node:async_hooks';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { loadConfig } from './core/config';
import { extractBearer, timingSafeEqual } from './core/auth';
import { AppError, errorEnvelope, isUpstreamCode } from './core/errors';
import {
  configureLogger,
  logRequest,
  loggableErrorDetail,
  logger,
  redact,
  runWithLogContext,
} from './core/logging';
import { countChars, newRequestId } from './core/request';
import { ModelClient } from './ai/client';
import type { AiBinding } from './ai/client';
import { ModelRouter } from './ai/router';
import { DIMENSIONS, DIMENSION_MAP, SALES_LABELS } from './taxonomies/sales-labels';
import { analyzeCall } from './services/analyze';
import { classifyItems } from './services/classify';
import { embedItems } from './services/embeddings';
import { analyzeEmotions } from './services/emotions';
import { generateText } from './services/generate';
import { rerankPassages } from './services/rerank';
import { getReferenceDoc, listReferenceDocs } from './reference';
import { openApiSpec, swaggerUiHtml } from './openapi';
import type { AppVariables, Env } from './env';

type AppEnv = { Bindings: Env; Variables: AppVariables };

const PROTECTED_PREFIXES = ['/v1/', '/classify', '/emotion', '/embed', '/generate'];

function isProtected(path: string): boolean {
  if (path === '/v1/reference' || path.startsWith('/v1/reference/')) {
    return false;
  }
  return PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

/**
 * The unversioned aliases the Python backend still calls. They are deprecated, not gone:
 * the live pipeline depends on them, so they keep answering until deal-truth-api has
 * migrated to the /v1 routes. Deleting them is a separate, later task.
 *
 * RFC 8594 `Sunset` is an HTTP-date; RFC 9745 `Deprecation: true` marks the route as
 * deprecated now. `Link rel="successor-version"` names where the caller should go.
 */
const COMPAT_SUNSET = 'Thu, 31 Dec 2026 23:59:59 GMT';

const COMPAT_SUCCESSORS: Record<string, string> = {
  '/classify': '/v1/classify',
  '/emotion': '/v1/emotions',
  '/embed': '/v1/embeddings',
  '/generate': '/v1/generate',
};

/**
 * Most recent failed model call in the current request, so an upstream error can name
 * the model that actually failed and can be told apart from a timeout. Written at the
 * AI binding boundary, read only on the error path.
 */
interface UpstreamTrace {
  model?: string;
  timeout?: boolean;
}

const upstreamTrace = new AsyncLocalStorage<UpstreamTrace>();

const TIMEOUT_PATTERN =
  /(timed?[\s_-]?out|timeout|deadline exceeded|etimedout|\bgateway time-?out\b|\b504\b)/i;

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return true;
  }
  return TIMEOUT_PATTERN.test(error instanceof Error ? error.message : String(error));
}

/**
 * Records which model failed, then rethrows the original error untouched. It must stay
 * untouched: ModelClient rethrows an AppError immediately and only retries raw errors,
 * so converting here would silently remove the upstream retry.
 */
function traceUpstreamCalls(ai: AiBinding): AiBinding {
  return {
    async run(model: string, inputs: Record<string, unknown>): Promise<unknown> {
      try {
        return await ai.run(model, inputs);
      } catch (error) {
        const trace = upstreamTrace.getStore();
        if (trace) {
          trace.model = model;
          trace.timeout = isTimeoutError(error);
        }
        throw error;
      }
    },
  };
}

/**
 * Give the caller a status that matches what actually happened. A 404 that says 400, or a
 * model timeout that says 500, sends whoever is debugging to the wrong side of the wire.
 */
function honestAppError(error: unknown, trace: UpstreamTrace | undefined): AppError {
  if (!(error instanceof AppError)) {
    return new AppError('INTERNAL_ERROR', 'An unexpected error occurred.');
  }
  if (!isUpstreamCode(error.code) || !trace?.model) {
    return error;
  }
  const details = { ...error.details, model: trace.model };
  if (trace.timeout) {
    return new AppError('UPSTREAM_TIMEOUT', `Upstream model ${trace.model} timed out.`, details);
  }
  return new AppError(error.code, error.message, details);
}

/** A body that is not JSON is the caller's mistake (400), never an internal fault (500). */
async function readJsonBody(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError('INVALID_REQUEST', 'Request body must be valid JSON.', {
      reason: 'malformed_json',
    });
  }
}

export function createApp(env: Env): Hono<AppEnv> {
  const config = loadConfig(env);
  configureLogger(config.logLevel);
  const router = new ModelRouter(new ModelClient(traceUpstreamCalls(env.AI)), config);
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const requestId = newRequestId(c.req.header('x-request-id'));
    c.set('requestId', requestId);
    c.set('startMs', Date.now());
    c.header('X-Request-ID', requestId);
    await upstreamTrace.run({}, () => runWithLogContext(requestId, () => next()));
  });

  // Backend-to-worker only. Do not reflect arbitrary Origin.
  app.use(
    '*',
    cors({
      origin: [],
      allowHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
      exposeHeaders: ['X-Request-ID'],
    }),
  );

  app.onError((error, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    const appError = honestAppError(error, upstreamTrace.getStore());
    if (!(error instanceof AppError)) {
      logger.error('http.unhandled', {
        name: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? redact(error.message) : 'non-error',
      });
    }
    logRequest({
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      status: appError.status,
      duration_ms: Date.now() - (c.get('startMs') ?? Date.now()),
      success: false,
      error_code: appError.code,
      error_detail: loggableErrorDetail(appError),
    });
    return c.json(errorEnvelope(appError, requestId), appError.status as 400);
  });

  // Compat routes still answer exactly as before — they are only marked, and the caller
  // is recorded so the migration can be chased by user-agent instead of by guesswork.
  // Registered ahead of auth so every response is marked, including a 401: a caller whose
  // token is wrong should still learn the route is going away.
  for (const [path, successor] of Object.entries(COMPAT_SUCCESSORS)) {
    app.use(path, async (c, next) => {
      c.header('Deprecation', 'true');
      c.header('Sunset', COMPAT_SUNSET);
      c.header('Link', `<${successor}>; rel="successor-version"`);
      logger.warn('compat.deprecated_route', {
        path,
        successor,
        sunset: COMPAT_SUNSET,
        user_agent: c.req.header('user-agent') ?? 'unknown',
      });
      await next();
    });
  }

  app.use('*', async (c, next) => {
    if (!isProtected(c.req.path) || c.req.method === 'OPTIONS') {
      await next();
      return;
    }
    if (!config.internalApiToken) {
      await next();
      return;
    }
    const token = extractBearer(c.req.header('authorization'));
    if (!token || !timingSafeEqual(token, config.internalApiToken)) {
      throw new AppError('AUTH_FAILED', 'Invalid or missing bearer token.');
    }
    await next();
  });

  app.get('/', (c) =>
    c.json({
      service: 'deal-truth-ml',
      docs: '/docs',
      health: '/health/live',
    }),
  );

  app.get('/health/live', (c) => c.json({ status: 'ok' }));

  app.get('/openapi.json', (c) => c.json(openApiSpec));

  app.get('/docs', (c) => c.html(swaggerUiHtml('/openapi.json')));

  app.get('/health/ready', (c) => {
    const ready = Boolean(env.AI);
    return c.json(
      {
        overall: ready ? 'ready' : 'not_ready',
        ai_binding: ready,
        generation_enabled: config.enableGeneration,
        models: {
          fast: config.fastModelId,
          quality: config.qualityModelId,
          embeddings: { id: config.embeddingModelId, dimension: config.embeddingDimension },
          rerank: config.rerankModelId,
        },
        max_batch_size: config.maxBatchSize,
        max_text_chars: config.maxTextChars,
      },
      ready ? 200 : 503,
    );
  });

  app.get('/v1/models', (c) =>
    c.json({
      fast: { id: config.fastModelId, role: 'segment_classification_and_candidates', ready: true },
      quality: { id: config.qualityModelId, role: 'call_reasoning_and_judge', ready: true },
      embeddings: {
        id: config.embeddingModelId,
        dimension: config.embeddingDimension,
        ready: true,
      },
      rerank: { id: config.rerankModelId, role: 'passage_rerank', ready: true },
      generation: { enabled: config.enableGeneration, ready: config.enableGeneration },
    }),
  );

  // The 8 dimensions and the label -> dimension map ship with the catalogue so the API
  // never has to hardcode or guess the mapping the proof ring is drawn from.
  app.get('/v1/sales-labels', (c) =>
    c.json({ labels: SALES_LABELS, dimensions: DIMENSIONS, dimension_map: DIMENSION_MAP }),
  );

  const mountReference = (prefix: string) => {
    app.get(`${prefix}/reference`, (c) =>
      c.json({ docs: listReferenceDocs(`${prefix}/reference`) }),
    );
    app.get(`${prefix}/reference/:name`, (c) => {
      const doc = getReferenceDoc(c.req.param('name'));
      if (!doc) {
        return c.json(
          errorEnvelope(
            new AppError('NOT_FOUND', 'Unknown reference document.'),
            c.get('requestId'),
          ),
          404,
        );
      }
      return c.body(doc.body, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    });
  };
  mountReference('/v1');
  mountReference('/api/v1');

  app.post('/v1/classify', async (c) => {
    const body = await readJsonBody(c);
    const result = await classifyItems(router, config, body);
    logSuccess(c, result.items.length, countChars(bodyItems(body)), result.model);
    return c.json({ items: result.items, model: result.model, request_id: c.get('requestId') });
  });

  app.post('/v1/emotions', async (c) => {
    const body = await readJsonBody(c);
    const result = await analyzeEmotions(router, config, body);
    logSuccess(c, result.items.length, countChars(bodyItems(body)), result.model);
    return c.json({ items: result.items, model: result.model, request_id: c.get('requestId') });
  });

  app.post('/v1/embeddings', async (c) => {
    const body = await readJsonBody(c);
    const result = await embedItems(router, config, body);
    logSuccess(c, result.items.length, countChars(bodyItems(body)), result.model);
    return c.json({ items: result.items, model: result.model, request_id: c.get('requestId') });
  });

  app.post('/v1/rerank', async (c) => {
    const body = await readJsonBody(c);
    const result = await rerankPassages(router, config, body);
    const passages = Array.isArray((body as { passages?: unknown }).passages)
      ? (body as { passages: { text: string }[] }).passages
      : [];
    logSuccess(c, result.items.length, countChars(passages.map((p) => p.text)), result.model);
    return c.json({ items: result.items, model: result.model, request_id: c.get('requestId') });
  });

  app.post('/v1/generate', async (c) => {
    const body = await readJsonBody(c);
    const result = await generateText(router, config, body);
    logSuccess(c, 1, String((body as { input?: string }).input ?? '').length, result.model);
    return c.json({ ...result, request_id: c.get('requestId') });
  });

  app.post('/v1/analyze-call', async (c) => {
    const body = await readJsonBody(c);
    const result = await analyzeCall(router, config, body);
    const segments = Array.isArray((body as { segments?: { text: string }[] }).segments)
      ? (body as { segments: { text: string }[] }).segments
      : [];
    logSuccess(c, segments.length, countChars(segments.map((s) => s.text)), result.models.judge);
    return c.json({ ...result, request_id: c.get('requestId') });
  });

  // Pure formatter. No model runs, no network call leaves, and no webhook URL is
  // accepted, stored or echoed — the caller posts the returned blocks itself.
  app.post('/v1/notify/preview', async (c) => {
    const blocks = renderNotification(await readJsonBody(c));
    logRequest({
      request_id: String(c.get('requestId')),
      method: c.req.method,
      path: c.req.path,
      status: 200,
      item_count: blocks.length,
      duration_ms: Date.now() - Number(c.get('startMs')),
      success: true,
    });
    return c.json({ blocks, request_id: c.get('requestId') });
  });

  app.post('/classify', async (c) => {
    const body = (await readJsonBody(c)) as { texts?: unknown; labels?: unknown };
    const texts = asStringArray(body.texts, 'texts');
    const labels = asOptionalStringArray(body.labels, 'labels');
    const mapped = await classifyItems(router, config, {
      items: texts.map((text, index) => ({ id: String(index), text })),
      ...(labels.length
        ? {
            candidate_labels: labels.map((label) => ({
              id: slugify(label),
              hypothesis: label,
            })),
          }
        : {}),
    });
    logSuccess(c, texts.length, countChars(texts), mapped.model);
    return c.json({
      results: mapped.items.map((item) => ({
        labels: item.labels.map((label) => ({ label: label.id, score: label.score })),
      })),
    });
  });

  app.post('/emotion', async (c) => {
    const body = (await readJsonBody(c)) as { texts?: unknown };
    const texts = asStringArray(body.texts);
    const mapped = await analyzeEmotions(router, config, {
      items: texts.map((text, index) => ({ id: String(index), text })),
    });
    // The flat `labels` array cannot say "this axis was not scored", so an unavailable
    // axis is indistinguishable from "nothing detected" here. That loss is why the route
    // is deprecated — but it must not become an error: dropped items are routine at
    // batch size, and failing the call would turn a partial result into a fake outage on
    // the pipeline that still depends on this route. An empty label set asserts nothing,
    // so nothing unsupported ships. Log the loss; /v1/emotions carries the real flag.
    const lostAxes = mapped.items.filter((item) =>
      Object.values(item.unavailable).some(Boolean),
    ).length;
    if (lostAxes > 0) {
      logger.warn('emotion.compat_axis_lost', { item_count: texts.length, lost_items: lostAxes });
    }
    logSuccess(c, texts.length, countChars(texts), mapped.model);
    return c.json({
      results: mapped.items.map((item) => ({
        labels: [...item.emotion, ...item.buying_intent, ...item.deal_signals],
      })),
    });
  });

  app.post('/embed', async (c) => {
    const body = (await readJsonBody(c)) as { texts?: unknown };
    const texts = asStringArray(body.texts);
    const mapped = await embedItems(router, config, {
      items: texts.map((text, index) => ({ id: String(index), text })),
      normalize: true,
    });
    logSuccess(c, texts.length, countChars(texts), mapped.model);
    return c.json({
      results: mapped.items.map((item) => ({ embedding: item.vector })),
    });
  });

  app.post('/generate', async (c) => {
    const body = (await readJsonBody(c)) as { prompt?: unknown; max_tokens?: unknown };
    if (typeof body.prompt !== 'string' || !body.prompt) {
      throw new AppError('INVALID_REQUEST', 'prompt is required.');
    }
    const mapped = await generateText(router, config, {
      task: 'summary_fallback',
      input: body.prompt,
      max_new_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 256,
      temperature: 0,
    });
    logSuccess(c, 1, body.prompt.length, mapped.model);
    return c.json({ text: mapped.text });
  });

  app.notFound(() => {
    throw new AppError('NOT_FOUND', 'Unknown route.');
  });

  return app;
}

function logSuccess(
  c: {
    get: (k: 'requestId' | 'startMs') => string | number;
    req: { method: string; path: string };
  },
  itemCount: number,
  charCount: number,
  model: string,
): void {
  logRequest({
    request_id: String(c.get('requestId')),
    method: c.req.method,
    path: c.req.path,
    status: 200,
    item_count: itemCount,
    char_count: charCount,
    model,
    duration_ms: Date.now() - Number(c.get('startMs')),
    success: true,
  });
}

function bodyItems(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || !('items' in body)) {
    return [];
  }
  const items = (body as { items: unknown }).items;
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) =>
    typeof item === 'object' && item !== null && 'text' in item
      ? String((item as { text: unknown }).text ?? '')
      : '',
  );
}

function asStringArray(value: unknown, field = 'texts'): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new AppError('INVALID_REQUEST', `${field} must be a non-empty string array.`);
  }
  return value;
}

function asOptionalStringArray(value: unknown, field = 'labels'): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new AppError('INVALID_REQUEST', `${field} must be a string array.`);
  }
  return value;
}

type SlackBlock = Record<string, unknown>;

const NOTIFY_TYPES = ['claim_refused', 'dimension_lost'] as const;

/** Slack caps header plain_text at 150 chars and section mrkdwn at 3000. Stay inside both. */
const HEADER_LIMIT = 150;
const TEXT_LIMIT = 2000;
const SHORT_LIMIT = 128;

const NOTIFY_FOOTER =
  'Deal Truth ML preview — rendered only. This service holds no webhook URL and sent nothing.';

/**
 * Field names a caller might use to smuggle a destination in. Rejected loudly rather
 * than ignored: a caller that thinks this service delivers the message would otherwise
 * believe an alert was sent when nothing was.
 */
const WEBHOOK_FIELDS = [
  'webhook_url',
  'webhook',
  'url',
  'callback_url',
  'slack_webhook_url',
  'hook_url',
  'destination',
];

const URL_PATTERN = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi;

/**
 * Strips every URL out of caller-supplied text. A webhook URL must not survive a round
 * trip through this service even when someone pastes one into a claim or a reason.
 */
function scrubUrls(value: string): string {
  return value.replace(URL_PATTERN, '[link removed]');
}

/** Slack mrkdwn control characters. Escaping `<` also disarms `<url|label>` link syntax. */
function escapeMrkdwn(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function notifyText(value: unknown, field: string, limit = TEXT_LIMIT): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('INVALID_REQUEST', `${field} must be a non-empty string.`);
  }
  return escapeMrkdwn(scrubUrls(value.trim())).slice(0, limit);
}

function optionalNotifyText(value: unknown, field: string, limit = TEXT_LIMIT): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return notifyText(value, field, limit);
}

/** Slack quotes one line per `>`, so every line needs the marker. */
function blockQuote(value: string): string {
  return value
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function slackHeader(text: string): SlackBlock {
  return { type: 'header', text: { type: 'plain_text', text: text.slice(0, HEADER_LIMIT) } };
}

function slackSection(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function slackFields(...texts: string[]): SlackBlock {
  return { type: 'section', fields: texts.map((text) => ({ type: 'mrkdwn', text })) };
}

function slackContext(text: string): SlackBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

function renderNotification(body: unknown): SlackBlock[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('INVALID_REQUEST', 'Body must be a JSON object.');
  }
  const event = body as Record<string, unknown>;
  const smuggled = WEBHOOK_FIELDS.filter((name) => event[name] !== undefined);
  if (smuggled.length > 0) {
    throw new AppError(
      'INVALID_REQUEST',
      'This service never accepts a webhook URL. It renders blocks only — post them yourself.',
      { rejected_fields: smuggled },
    );
  }
  if (event.type === 'claim_refused') {
    return claimRefusedBlocks(event);
  }
  if (event.type === 'dimension_lost') {
    return dimensionLostBlocks(event);
  }
  throw new AppError('INVALID_REQUEST', `type must be one of: ${NOTIFY_TYPES.join(', ')}.`, {
    supported_types: [...NOTIFY_TYPES],
  });
}

function claimRefusedBlocks(event: Record<string, unknown>): SlackBlock[] {
  const claim = notifyText(event.claim, 'claim');
  const errorCode = notifyText(event.error_code, 'error_code', SHORT_LIMIT);
  const reason = optionalNotifyText(event.reason, 'reason');
  const evidence = optionalNotifyText(event.evidence, 'evidence');
  const blocks: SlackBlock[] = [
    slackHeader('Claim refused'),
    slackSection(`*Claim*\n${blockQuote(claim)}`),
    slackFields(`*Error code*\n\`${errorCode}\``, `*Reason*\n${reason ?? '_none supplied_'}`),
  ];
  // An absent quote is stated, never implied: this notification must not read as if
  // the transcript backed the claim when nothing was attached.
  blocks.push(
    evidence
      ? slackSection(`*Evidence*\n${blockQuote(evidence)}`)
      : slackContext('No evidence quote was supplied with this event.'),
  );
  blocks.push(slackContext(NOTIFY_FOOTER));
  return blocks;
}

function dimensionLostBlocks(event: Record<string, unknown>): SlackBlock[] {
  const dimension = notifyText(event.dimension, 'dimension', SHORT_LIMIT);
  const from = notifyText(event.from, 'from', SHORT_LIMIT);
  const to = notifyText(event.to, 'to', SHORT_LIMIT);
  return [
    slackHeader('Dimension lost'),
    slackSection(`*Dimension*\n\`${dimension}\``),
    slackFields(`*Was*\n\`${from}\``, `*Now*\n\`${to}\``),
    slackContext(NOTIFY_FOOTER),
  ];
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'label'
  );
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    return createApp(env).fetch(request, env, ctx);
  },
};
