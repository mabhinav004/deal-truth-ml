import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ModelClient } from './ai/client';
import { ModelRouter } from './ai/router';
import { loadConfig } from './core/config';
import { configureLogger } from './core/logging';
import type { Env } from './env';
import { AppErrorFilter } from './http/app-error.filter';
import { AuthGuard } from './http/auth.guard';
import { CompatController } from './http/compat.controller';
import { DocsController } from './http/docs.controller';
import { HealthController } from './http/health.controller';
import { InferenceController } from './http/inference.controller';
import { ModelsController } from './http/models.controller';
import { AI_BINDING, APP_CONFIG, MODEL_ROUTER } from './http/tokens';

@Module({})
export class AppModule {
  static register(env: Env): DynamicModule {
    const config = loadConfig(env);
    configureLogger(config.logLevel);
    const router = new ModelRouter(new ModelClient(env.AI), config);
    return {
      module: AppModule,
      controllers: [
        HealthController,
        DocsController,
        ModelsController,
        InferenceController,
        CompatController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: AI_BINDING, useValue: env.AI },
        { provide: MODEL_ROUTER, useValue: router },
        { provide: APP_FILTER, useClass: AppErrorFilter },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
