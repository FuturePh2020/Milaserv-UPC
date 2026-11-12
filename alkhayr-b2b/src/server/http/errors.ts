import { ERROR_CATALOG, type ApiFieldError, type ErrorCode } from '../../shared/errors.ts';

/** An expected, client-safe failure. The message is chosen from the Arabic catalog. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: ApiFieldError[] | undefined;
  readonly headers: Record<string, string> | undefined;
  /** Safe current state for conflicts (only data the caller is allowed to see). */
  readonly current: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, options: { fields?: ApiFieldError[]; headers?: Record<string, string>; current?: Record<string, unknown>; cause?: unknown } = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CATALOG[code].status;
    this.fields = options.fields;
    this.headers = options.headers;
    this.current = options.current;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
