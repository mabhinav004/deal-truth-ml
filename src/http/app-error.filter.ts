import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, errorEnvelope } from '../core/errors';
import { logRequest, loggableErrorDetail, logger, redact } from '../core/logging';
import type { RequestContext } from './request-context';

@Catch()
export class AppErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & RequestContext>();
    const appError = toAppError(exception);
    const requestId = request.requestId ?? 'unknown';
    if (!(exception instanceof AppError) && !(exception instanceof NotFoundException)) {
      logger.error('http.unhandled', {
        name: exception instanceof Error ? exception.name : 'unknown',
        message: exception instanceof Error ? redact(exception.message) : 'non-error',
      });
    }
    logRequest({
      request_id: requestId,
      method: request.method,
      path: request.path,
      status: appError.status,
      duration_ms: Date.now() - (request.startMs ?? Date.now()),
      success: false,
      error_code: appError.code,
      error_detail: loggableErrorDetail(appError),
    });
    response.status(appError.status).json(errorEnvelope(appError, requestId));
  }
}

function toAppError(exception: unknown): AppError {
  if (exception instanceof AppError) {
    return exception;
  }
  if (exception instanceof NotFoundException) {
    return new AppError('INVALID_REQUEST', 'Unknown route.');
  }
  if (exception instanceof HttpException && exception.getStatus() === 404) {
    return new AppError('INVALID_REQUEST', 'Unknown route.');
  }
  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred.');
}
