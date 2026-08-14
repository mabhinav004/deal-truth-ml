import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { ModelRouter } from '../ai/router';
import type { AppConfig } from '../core/config';
import { AppError } from '../core/errors';
import { countChars } from '../core/request';
import { classifyItems } from '../services/classify';
import { embedItems } from '../services/embeddings';
import { analyzeEmotions } from '../services/emotions';
import { generateText } from '../services/generate';
import { asOptionalStringArray, asStringArray, logHttpSuccess, slugify } from './http.util';
import type { RequestContext } from './request-context';
import { APP_CONFIG, MODEL_ROUTER } from './tokens';

@Controller()
export class CompatController {
  constructor(
    @Inject(MODEL_ROUTER) private readonly router: ModelRouter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('classify')
  @HttpCode(HttpStatus.OK)
  async classify(
    @Body() body: { texts?: unknown; labels?: unknown },
    @Req() request: Request & RequestContext,
  ): Promise<Record<string, unknown>> {
    const texts = asStringArray(body.texts, 'texts');
    const labels = asOptionalStringArray(body.labels, 'labels');
    const mapped = await classifyItems(this.router, this.config, {
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
    logHttpSuccess({
      request_id: request.requestId,
      method: request.method,
      path: request.path,
      item_count: texts.length,
      char_count: countChars(texts),
      model: mapped.model,
      duration_ms: Date.now() - request.startMs,
    });
    return {
      results: mapped.items.map((item) => ({
        labels: item.labels.map((label) => ({ label: label.id, score: label.score })),
      })),
    };
  }

  @Post('emotion')
  @HttpCode(HttpStatus.OK)
  async emotion(
    @Body() body: { texts?: unknown },
    @Req() request: Request & RequestContext,
  ): Promise<Record<string, unknown>> {
    const texts = asStringArray(body.texts);
    const mapped = await analyzeEmotions(this.router, this.config, {
      items: texts.map((text, index) => ({ id: String(index), text })),
    });
    logHttpSuccess({
      request_id: request.requestId,
      method: request.method,
      path: request.path,
      item_count: texts.length,
      char_count: countChars(texts),
      model: mapped.model,
      duration_ms: Date.now() - request.startMs,
    });
    return {
      results: mapped.items.map((item) => {
        const row = item as {
          emotion: { label: string; score: number }[];
          buying_intent: { label: string; score: number }[];
          deal_signals: { label: string; score: number }[];
        };
        return {
          labels: [...row.emotion, ...row.buying_intent, ...row.deal_signals],
        };
      }),
    };
  }

  @Post('embed')
  @HttpCode(HttpStatus.OK)
  async embed(
    @Body() body: { texts?: unknown },
    @Req() request: Request & RequestContext,
  ): Promise<Record<string, unknown>> {
    const texts = asStringArray(body.texts);
    const mapped = await embedItems(this.router, this.config, {
      items: texts.map((text, index) => ({ id: String(index), text })),
      normalize: true,
    });
    logHttpSuccess({
      request_id: request.requestId,
      method: request.method,
      path: request.path,
      item_count: texts.length,
      char_count: countChars(texts),
      model: mapped.model,
      duration_ms: Date.now() - request.startMs,
    });
    return {
      results: mapped.items.map((item) => ({ embedding: item.vector })),
    };
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(
    @Body() body: { prompt?: unknown; max_tokens?: unknown },
    @Req() request: Request & RequestContext,
  ): Promise<{ text: string }> {
    if (typeof body.prompt !== 'string' || !body.prompt) {
      throw new AppError('INVALID_REQUEST', 'prompt is required.');
    }
    const mapped = await generateText(this.router, this.config, {
      task: 'summary_fallback',
      input: body.prompt,
      max_new_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 256,
      temperature: 0,
    });
    logHttpSuccess({
      request_id: request.requestId,
      method: request.method,
      path: request.path,
      item_count: 1,
      char_count: body.prompt.length,
      model: mapped.model,
      duration_ms: Date.now() - request.startMs,
    });
    return { text: mapped.text };
  }
}
