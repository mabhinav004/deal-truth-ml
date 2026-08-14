import { AppError } from '../core/errors';
import { logRequest } from '../core/logging';
import type { RequestLog } from '../core/logging';

export const PUBLIC_EXACT_PATHS = new Set([
  '/',
  '/health/live',
  '/health/ready',
  '/docs',
  '/openapi.json',
]);

export function isPublicPath(path: string, method: string): boolean {
  if (method === 'OPTIONS') {
    return true;
  }
  if (PUBLIC_EXACT_PATHS.has(path)) {
    return true;
  }
  return path === '/v1/reference' ||
    path.startsWith('/v1/reference/') ||
    path === '/api/v1/reference' ||
    path.startsWith('/api/v1/reference/');
}

export function asStringArray(value: unknown, field = 'texts'): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new AppError('INVALID_REQUEST', `${field} must be a non-empty string array.`);
  }
  return value;
}

export function asOptionalStringArray(value: unknown, field = 'labels'): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new AppError('INVALID_REQUEST', `${field} must be a string array.`);
  }
  return value;
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'label'
  );
}

export function bodyItemTexts(body: unknown): string[] {
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

export function logHttpSuccess(entry: Omit<RequestLog, 'status' | 'success'>): void {
  logRequest({
    ...entry,
    status: 200,
    success: true,
  });
}
