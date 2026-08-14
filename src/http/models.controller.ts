import { Controller, Get, Inject } from '@nestjs/common';
import type { AppConfig } from '../core/config';
import { SALES_LABELS } from '../taxonomies/sales-labels';
import { APP_CONFIG } from './tokens';

@Controller('v1')
export class ModelsController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('models')
  models(): Record<string, unknown> {
    return {
      fast: { id: this.config.fastModelId, role: 'segment_classification_and_candidates', ready: true },
      quality: { id: this.config.qualityModelId, role: 'call_reasoning_and_judge', ready: true },
      embeddings: {
        id: this.config.embeddingModelId,
        dimension: this.config.embeddingDimension,
        ready: true,
      },
      rerank: { id: this.config.rerankModelId, role: 'passage_rerank', ready: true },
      generation: { enabled: this.config.enableGeneration, ready: this.config.enableGeneration },
    };
  }

  @Get('sales-labels')
  salesLabels(): { labels: typeof SALES_LABELS } {
    return { labels: SALES_LABELS };
  }
}
