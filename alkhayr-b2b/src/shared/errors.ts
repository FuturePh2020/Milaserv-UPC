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
  INVALID_CREDENTIALS: { status: 401, messageAr: 'بيانات الدخول غير صحيحة.' },
  FORBIDDEN: { status: 403, messageAr: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.' },
  ACCOUNT_PENDING: { status: 403, messageAr: 'حسابك قيد المراجعة من الإدارة ولم يُعتمد بعد.' },
  CSRF_FAILED: { status: 403, messageAr: 'انتهت صلاحية الصفحة أو الطلب غير موثّق. حدّث الصفحة وحاول مرة أخرى.' },
  ORIGIN_REJECTED: { status: 403, messageAr: 'مصدر الطلب غير مسموح به.' },
  REAUTH_FAILED: { status: 403, messageAr: 'كلمة المرور الحالية أو رمز التحقق غير صحيح.' },
  ADMIN_ACCOUNT_PROTECTED: { status: 403, messageAr: 'لا يمكن تغيير حالة حساب مدير من شاشة التجار.' },
  NOT_FOUND: { status: 404, messageAr: 'المورد المطلوب غير موجود.' },
  METHOD_NOT_ALLOWED: { status: 405, messageAr: 'طريقة الطلب غير مسموح بها لهذا المسار.' },
  IDEMPOTENCY_KEY_REUSED: { status: 409, messageAr: 'تم استخدام مفتاح العملية نفسه لطلب مختلف. أنشئ مفتاحًا جديدًا لكل عملية.' },
  DUPLICATE: { status: 409, messageAr: 'القيمة مستخدمة بالفعل في سجل آخر.' },
  VERSION_CONFLICT: { status: 409, messageAr: 'تم تعديل هذه البيانات بواسطة طلب آخر. راجع البيانات الحالية ثم أعد المحاولة.' },
  INVALID_STATE_TRANSITION: { status: 409, messageAr: 'لا يمكن نقل الحساب إلى هذه الحالة من حالته الحالية.' },
  CREDENTIALS_CHANGED: { status: 409, messageAr: 'تغيّرت بيانات الدخول أثناء تنفيذ الطلب. سجّل الدخول من جديد.' },
  PAYLOAD_TOO_LARGE: { status: 413, messageAr: 'حجم البيانات المرسلة أكبر من المسموح.' },
  URI_TOO_LONG: { status: 414, messageAr: 'عنوان الطلب أطول من المسموح.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, messageAr: 'نوع البيانات المرسلة غير مدعوم.' },
  NO_CHANGE: { status: 422, messageAr: 'العملية لا تغيّر الرصيد الحالي.' },
  INVENTORY_NEGATIVE: { status: 422, messageAr: 'لا يمكن أن يصبح الرصيد الإجمالي أقل من صفر.' },
  INVENTORY_BELOW_RESERVED: { status: 422, messageAr: 'لا يمكن أن يقل الرصيد الإجمالي عن الكمية المحجوزة لطلبات مؤكدة.' },
  INVENTORY_LIMIT: { status: 422, messageAr: 'الرصيد الناتج أكبر من الحد المسموح.' },
  CATALOG_LIMIT: { status: 422, messageAr: 'تم بلوغ الحد الأقصى لعدد المنتجات في الكتالوج (5000 منتج).' },
  RECENT_AUTH_REQUIRED: { status: 428, messageAr: 'لأمان العملية، يلزم تسجيل الدخول مرة أخرى بكلمة المرور ورمز التحقق.' },
  RATE_LIMITED: { status: 429, messageAr: 'عدد المحاولات كبير. حاول مرة أخرى لاحقًا.' },
  INTERNAL: { status: 500, messageAr: 'حدث خطأ غير متوقع في الخادم. حاول مرة أخرى لاحقًا.' },
  UNAVAILABLE: { status: 503, messageAr: 'الخدمة غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.' },
  NOT_READY: { status: 503, messageAr: 'الخدمة غير جاهزة لاستقبال الطلبات حاليًا.' },
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
    details?: { fields?: ApiFieldError[]; current?: Record<string, unknown> };
  };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CATALOG, value);
}
