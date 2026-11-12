import type { ServerResponse } from 'node:http';
import { ERROR_CATALOG, type ApiErrorBody, type ErrorCode } from '../../shared/errors.ts';
import type { AppError } from './errors.ts';

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(payload.length));
  // HEAD responses carry headers only.
  res.end(res.req?.method === 'HEAD' ? undefined : payload);
}

export function errorBody(code: ErrorCode, requestId: string, err?: AppError): ApiErrorBody {
  const body: ApiErrorBody = { error: { code, message: ERROR_CATALOG[code].messageAr, requestId } };
  if (err?.fields && err.fields.length > 0) body.error.details = { fields: err.fields };
  if (err?.current) body.error.details = { ...body.error.details, current: err.current };
  return body;
}

export function sendError(res: ServerResponse, requestId: string, code: ErrorCode, err?: AppError): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, ERROR_CATALOG[code].status, errorBody(code, requestId, err), err?.headers ?? {});
}
