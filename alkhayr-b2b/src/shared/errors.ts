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
  ACCESS_CHANGED: { status: 409, messageAr: 'تغيّرت حالة الحساب أثناء تنفيذ الطلب. حدّث الصفحة وحاول مرة أخرى.' },
  PRODUCT_UNAVAILABLE: { status: 409, messageAr: 'بعض المنتجات في الطلب لم تعد متاحة للطلب. راجع السلة ثم أعد المحاولة.' },
  PRICE_CHANGED: { status: 409, messageAr: 'تغيّر سعر بعض المنتجات. راجع الأسعار الحالية ثم أعد إرسال الطلب.' },
  PACKAGING_CHANGED: { status: 409, messageAr: 'تغيّر عدد القطع في كرتونة بعض المنتجات. راجع البيانات الحالية ثم أعد إرسال الطلب.' },
  INSUFFICIENT_STOCK: { status: 409, messageAr: 'الكمية المطلوبة من بعض المنتجات غير متاحة حاليًا. قلّل الكمية أو احذف المنتج.' },
  PACKAGING_LOCKED: { status: 409, messageAr: 'لا يمكن تغيير عدد القطع في الكرتونة أثناء وجود رصيد أو حجوزات لهذا المنتج. صفّر الرصيد بحركة مخزون موثّقة أولًا.' },
  ORDER_STATE_CONFLICT: { status: 409, messageAr: 'لا يمكن نقل الطلب إلى هذه الحالة من حالته الحالية.' },
  BUYER_NOT_APPROVED: { status: 409, messageAr: 'حساب التاجر غير معتمد حاليًا؛ لا يمكن تأكيد الطلب أو تجهيزه أو شحنه. يمكن إلغاؤه مع ذكر السبب.' },
  CONFIRM_PRODUCT_UNAVAILABLE: { status: 409, messageAr: 'بعض منتجات الطلب غير مفعّلة أو في قسم غير مفعّل؛ لا يمكن تأكيد الطلب.' },
  CONFIRM_PACKAGING_CHANGED: { status: 409, messageAr: 'تغيّر عدد القطع في كرتونة بعض المنتجات منذ إنشاء الطلب. ألغِ الطلب واطلب من التاجر إنشاء طلب جديد.' },
  CONFIRM_STOCK_INSUFFICIENT: { status: 409, messageAr: 'الرصيد المتاح لا يكفي لتأكيد كل أصناف الطلب. لم يُحجز أي صنف.' },
  ORDER_RESERVATION_MISMATCH: { status: 409, messageAr: 'حجوزات الطلب لا تطابق حالته؛ لم يُنفَّذ أي تغيير. راجع سجل الطلب.' },
  IMPORT_PREVIEW_INVALID: { status: 409, messageAr: 'المعاينة لا تطابق هذا الملف أو هذا النوع من الاستيراد أو هذا الحساب. أعد المعاينة قبل التأكيد.' },
  IMPORT_PREVIEW_EXPIRED: { status: 409, messageAr: 'انتهت صلاحية المعاينة قبل التأكيد ولم يُستورد شيء. أعد المعاينة ثم أكّد من جديد.' },
  IMPORT_PREVIEW_STALE: { status: 409, messageAr: 'تغيّرت المنتجات منذ المعاينة؛ لم يُستورد أي سجل. راجع المعاينة الجديدة.' },
  PAYLOAD_TOO_LARGE: { status: 413, messageAr: 'حجم البيانات المرسلة أكبر من المسموح.' },
  URI_TOO_LONG: { status: 414, messageAr: 'عنوان الطلب أطول من المسموح.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, messageAr: 'نوع البيانات المرسلة غير مدعوم.' },
  MINIMUM_QUANTITY_NOT_MET: { status: 422, messageAr: 'الكمية أقل من الحد الأدنى المسموح لبعض المنتجات.' },
  MINIMUM_ORDER_NOT_MET: { status: 422, messageAr: 'إجمالي الطلب أقل من الحد الأدنى لقيمة الطلب.' },
  MIXED_DEMO_ITEMS: { status: 422, messageAr: 'لا يمكن الجمع بين منتجات العرض التجريبي والمنتجات الفعلية في طلب واحد.' },
  DEMO_NOT_ALLOWED: { status: 422, messageAr: 'طلبات العرض التجريبي غير مسموحة في بيئة التشغيل الفعلية.' },
  AMOUNT_LIMIT_EXCEEDED: { status: 422, messageAr: 'قيمة الطلب أكبر من الحد المسموح. قسّم الطلب إلى طلبات أصغر.' },
  NO_CHANGE: { status: 422, messageAr: 'العملية لا تغيّر الرصيد الحالي.' },
  INVENTORY_NEGATIVE: { status: 422, messageAr: 'لا يمكن أن يصبح الرصيد الإجمالي أقل من صفر.' },
  INVENTORY_BELOW_RESERVED: { status: 422, messageAr: 'لا يمكن أن يقل الرصيد الإجمالي عن الكمية المحجوزة لطلبات مؤكدة.' },
  INVENTORY_LIMIT: { status: 422, messageAr: 'الرصيد الناتج أكبر من الحد المسموح.' },
  CATALOG_LIMIT: { status: 422, messageAr: 'تم بلوغ الحد الأقصى لعدد المنتجات في الكتالوج (5000 منتج).' },
  IMPORT_REJECTED: { status: 422, messageAr: 'لم يُستورد أي سجل: الملف يحتوي على أخطاء. صحّحها ثم أعد المعاينة.' },
  RECENT_AUTH_REQUIRED: { status: 428, messageAr: 'لأمان العملية، يلزم تسجيل الدخول مرة أخرى بكلمة المرور ورمز التحقق.' },
  RATE_LIMITED: { status: 429, messageAr: 'عدد المحاولات كبير. حاول مرة أخرى لاحقًا.' },
  INTERNAL: { status: 500, messageAr: 'حدث خطأ غير متوقع في الخادم. حاول مرة أخرى لاحقًا.' },
  UNAVAILABLE: { status: 503, messageAr: 'الخدمة غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.' },
  IMPORT_BUSY: { status: 503, messageAr: 'عمليات استيراد أخرى قيد المعالجة الآن. حاول بعد لحظات.' },
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
