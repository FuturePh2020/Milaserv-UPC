/**
 * API error catalog shared by server and browser. Codes are stable identifiers;
 * messages are safe user-facing Arabic and never include internal details.
 */
export const ERROR_CATALOG = {
  BAD_REQUEST: { status: 400, messageAr: 'الطلب غير صالح.' },
  VALIDATION_FAILED: { status: 400, messageAr: 'بعض البيانات المدخلة غير صحيحة.' },
  INVALID_JSON: { status: 400, messageAr: 'صيغة البيانات المرسلة غير صحيحة.' },
  HOST_REJECTED: { status: 400, messageAr: 'عنوان الخادم المطلوب غير مسموح به.' },
  UNAUTHENTICATED: { status: 401, messageAr: 'يلزم تسجيل الدخول.' },
  FORBIDDEN: { status: 403, messageAr: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.' },
  NOT_FOUND: { status: 404, messageAr: 'المورد المطلوب غير موجود.' },
  METHOD_NOT_ALLOWED: { status: 405, messageAr: 'طريقة الطلب غير مسموح بها لهذا المسار.' },
  PAYLOAD_TOO_LARGE: { status: 413, messageAr: 'حجم البيانات المرسلة أكبر من المسموح.' },
  URI_TOO_LONG: { status: 414, messageAr: 'عنوان الطلب أطول من المسموح.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, messageAr: 'نوع البيانات المرسلة غير مدعوم.' },
  RATE_LIMITED: { status: 429, messageAr: 'عدد المحاولات كبير. حاول مرة أخرى لاحقًا.' },
  INTERNAL: { status: 500, messageAr: 'حدث خطأ غير متوقع في الخادم. حاول مرة أخرى لاحقًا.' },
  UNAVAILABLE: { status: 503, messageAr: 'الخدمة غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.' },
} as const satisfies Record<string, { status: number; messageAr: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export interface ApiFieldError {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: { fields?: ApiFieldError[] };
  };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CATALOG, value);
}
