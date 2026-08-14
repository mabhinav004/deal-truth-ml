import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { ModelRouter } from '../ai/router';
import type { AppConfig } from '../core/config';
import { countChars } from '../core/request';
import { analyzeCall } from '../services/analyze';
import { classifyItems } from '../services/classify';
import { embedItems } from '../services/embeddings';
import { analyzeEmotions } from '../services/emotions';
import { generateText } from '../services/generate';
import { rerankPassages } from '../services/rerank';
import { bodyItemTexts, logHttpSuccess } from './http.util';
import type { RequestContext } from './request-context';
import { APP_CONFIG, MODEL_ROUTER } from './tokens';

@Controller('v1')
export class InferenceController {
  constructor(
    @Inject(MODEL_ROUTER) private readonly router: ModelRouter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('classify')
  @HttpCode(HttpStatus.OK)
  async classify(
    @Body() body: unknown,
    @Req() request: Request & RequestContext,
  ): Promise<Record<string, unknown>> {
    const result = await classifyItems(this.router, this.config, body);
    logHttpSuccess({
      request_id: request.requestId,
      method: request.method,
      path: request.path,
      item_count: result.items.length,
      char_count: countChars(bodyItemTexts(body)),
      model: result.model,
      duration_ms: Date.now() - request.startMs,
    });
    return { items: result.items, model: result.model, request_id: request.requestId };
  }

  @Post('emotions')
  @HttpCode(HttpStatus.OK)
  async emotions(
    @Body() body: unknown,
    @Req() request: Request & RequestContext,
  ): Promise<Record<string, unknown>> {
    const result = await analyzeEmotions(this.router, this.config, body);
    logHttpSuccess({
      request_id: request.requestId,
      method: request.method,
      path: request.path,
      item_count: result.items.length,
      char_count: countChars(bodyItemTexts(body)),
      model: result.model,
      duration_ms: Date.now() - request.startMs,
    });
    return { items: result.items, model: result.model, request_id: request.requestId };
  }

  @Post('embeddings')
  @HttpCode(HttpStatus.OK)
  async embeddings(
    @Body() body: unknown,
    @Req() request: Request & RequestContext,
  ): Promise<Record<string, unknown>> {
    const result = await embedItems(this.router, this.config, body);
    logHttpSuccess({
      request_id: request.requestId,
      method: request.method,
      path: request.path,
      item_count: result.items.length,
      char_count: countChars(bodyItemTexts(body)),
      model: result.model,
      duration_ms: Date.now() - request.startMs,
    });
    return { items: result.items, model: result.model, request_id: request.requestId };
  }

  @Post('rerank')
  @HttpCode(HttpStatus.OK)
  async rerank(
    @Body() body: unknown,
    @Req() request: Request & RequestContext,
  ): Promise<Record<string, unknown>> {
    const result = await rerankPassages(this.router, this.config, body);
    const passages = Array.isArray((body as { passages?: unknown }).passages)
      ? (body as { passages: { text: string }[] }).passages
      : [];
    logHttpSuccess({
      request_id: request.requestId,
      method: request.method,
      path: request.path,
      item_count: result.items.length,
      char_count: countChars(passages.map((passage) => passage.text)),
      model: result.model,
      duration_ms: Date.now() - request.startMs,
    });
    return { items: result.items, model: result.model, request_id: request.requestId };
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(
    @Body() body: unknown,
    @Req() request: Request & RequestContext,
  ): Promise<Record<string, unknown>> {
    const result = await generateText(this.router, this.config, body);
    logHttpSuccess({
      request_id: request.requestId,
      method: request.method,
      path: request.path,
      item_count: 1,
      char_count: String((body as { input?: string }).input ?? '').length,
      model: result.model,
      duration_ms: Date.now() - request.startMs,
    });
    return { ...result, request_id: request.requestId };
  }

  @Post('analyze-call')
  @HttpCode(HttpStatus.OK)
  async analyze(
    @Body() body: unknown,
    @Req() request: Request & RequestContext,
  ): Promise<Record<string, unknown>> {
    const result = await analyzeCall(this.router, this.config, body);
    const segments = Array.isArray((body as { segments?: { text: string }[] }).segments)
      ? (body as { segments: { text: string }[] }).segments
      : [];
    logHttpSuccess({
      request_id: request.requestId,
      method: request.method,
      path: request.path,
      item_count: segments.length,
      char_count: countChars(segments.map((segment) => segment.text)),
      model: result.models.judge,
      duration_ms: Date.now() - request.startMs,
    });
    return { ...result, request_id: request.requestId };
  }
}
