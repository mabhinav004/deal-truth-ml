import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { extractBearer, timingSafeEqual } from '../core/auth';
import type { AppConfig } from '../core/config';
import { AppError } from '../core/errors';
import { isPublicPath } from './http.util';
import { APP_CONFIG } from './tokens';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (isPublicPath(request.path, request.method)) {
      return true;
    }
    if (!this.config.internalApiToken) {
      return true;
    }
    const token = extractBearer(request.headers.authorization);
    if (!token || !timingSafeEqual(token, this.config.internalApiToken)) {
      throw new AppError('AUTH_FAILED', 'Invalid or missing bearer token.');
    }
    return true;
  }
}
