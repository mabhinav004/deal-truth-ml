import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AiBinding } from '../ai/client';
import type { AppConfig } from '../core/config';
import { AI_BINDING, APP_CONFIG } from './tokens';

@Controller()
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_BINDING) private readonly ai: AiBinding,
  ) {}

  @Get()
  root(): { service: string; docs: string; health: string } {
    return {
      service: 'deal-truth-ml',
      docs: '/docs',
      health: '/health/live',
    };
  }

  @Get('health/live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('health/ready')
  ready(@Res({ passthrough: true }) response: Response): {
    overall: 'ready' | 'not_ready';
    ai_binding: boolean;
    generation_enabled: boolean;
    models: Record<string, unknown>;
    max_batch_size: number;
    max_text_chars: number;
  } {
    const ready = this.ai.isReady();
    response.status(ready ? 200 : 503);
    return {
      overall: ready ? 'ready' : 'not_ready',
      ai_binding: ready,
      generation_enabled: this.config.enableGeneration,
      models: {
        fast: this.config.fastModelId,
        quality: this.config.qualityModelId,
        embeddings: { id: this.config.embeddingModelId, dimension: this.config.embeddingDimension },
        rerank: this.config.rerankModelId,
      },
      max_batch_size: this.config.maxBatchSize,
      max_text_chars: this.config.maxTextChars,
    };
  }
}
