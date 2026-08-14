import type { NextFunction, Request, Response } from 'express';
import { runWithLogContext } from '../core/logging';
import { newRequestId } from '../core/request';

export interface RequestContext {
  requestId: string;
  startMs: number;
}

export function requestContextMiddleware(
  request: Request & Partial<RequestContext>,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.header('x-request-id');
  const requestId = newRequestId(incoming);
  request.requestId = requestId;
  request.startMs = Date.now();
  response.setHeader('X-Request-ID', requestId);
  runWithLogContext(requestId, () => next());
}
