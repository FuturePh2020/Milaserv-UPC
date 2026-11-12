# بوابة الخير للتجار — الهيكل الكامل ودليل التنفيذ عبر Claude Fable

تاريخ الإعداد: 12 نوفمبر 2026.

## اقرأ هذه النقاط أولًا

- هذا **هيكل مقترح لتنفيذ النظام بصورة منظمة**، وليس ادعاءً بأن ملفات الإصدار 2.0.1 موزعة حاليًا بهذه الأسماء. الإصدار السابق جمع أجزاء كبيرة من الواجهة والخادم في ملفات قليلة؛ الخطة التالية تفصلها إلى وحدات قابلة للاختبار.
- النظام مستقل بمنتجاته وأسعاره ومخزونه وطلبات تجاره. البيع في برنامج آخر لا يغيّر رصيده تلقائيًا. الربط مع ERP مرحلة اختيارية منفصلة.
- نقطة الضعف الأساسية في البداية: SQLite مع خادم تطبيق واحد مناسبة لتجربة محدودة، وتحتاج تغييرًا مدروسًا عند التوسع إلى عدة خوادم. لا يوجد وعد بسعة مستخدمين دون قياس حمل فعلي.
- لا توجد ضمانات أمان مطلقة. نتائج فحص الإصدار السابق ليست نتيجة تلقائية لأي كود جديد ينفذه Claude؛ يجب تشغيل الاختبارات والفحوص من جديد.
- لا نفترض إمكانات غير مؤكدة لـClaude Fable. البرومبت 00 يطلب التحقق من قدرة بيئته على تشغيل Backend وقاعدة بيانات دائمة، أو تصدير مشروع صالح لاستضافة خارجية.
- **تقديري لهذا الهيكل: 9/10 كنطاق واضح لبناء بوابة جملة مستقلة.** الاعتماد النهائي للتشغيل يحتاج اختبار استضافة وحمل وأمان فعلي.

## طريقة الاستخدام

1. افتح مشروعًا واحدًا في Claude Fable. إذا كان يقبل المرفقات، ارفع هذا الملف، وارفع مصدر 2.0.1 إذا أردت تطويره بدل البدء من جديد.
2. أرسل البرومبت 00 أولًا. لا ترسل كل مراحل التنفيذ مرة واحدة.
3. بعد انتهاء كل مرحلة ونجاح شروطها، أرسل البرومبت التالي بنفس ترتيب الأرقام: 01 ثم 02 حتى 18.
4. إذا انقطع السياق أو فتحت محادثة جديدة، استخدم برومبت الاستكمال في نهاية الملف مع ملفات المشروع و`docs/PROJECT_STATE.md`.
5. أي مرحلة لا تستطيع البيئة تشغيلها تُسجَّل «لم تُختبر»، ولا تُعد مكتملة لمجرد ظهور واجهة جميلة.

البرومبتات بالإنجليزية لتقليل التباس المواصفات التقنية. واجهة المنتج ورسائل الاستخدام بالعربية، واتجاهها RTL.

## 1. النطاق المتفق عليه

| الجزء | مطلوب في الإصدار الأساسي |
|---|---|
| تسجيل ودخول التجار | اسم مستخدم وكلمة مرور، وموافقة الإدارة قبل الأسعار والطلبات |
| الإدارة | حساب يُنشأ محليًا من CLI، مع TOTP، دون حساب أو كلمة مرور افتراضية |
| الكتالوج | منتجات وصور HTTPS وبراندات وأقسام وباركود وأسعار جملة |
| وحدات البيع | الطلب بالكرتونة؛ عدد القطع وسعر القطعة للمعلومة |
| المخزون | إجمالي، محجوز، متاح؛ إضافة/تسوية مخزون بسبب موثّق |
| الطلبات | سلة، إرسال، مراجعة، تأكيد، تجهيز، شحن، تسليم أو إلغاء قبل الشحن |
| الاستيراد والتصدير | CSV UTF-8، تحقق كامل، وحماية من معادلات Excel |
| إعدادات الشركة | الاسم والعنوان والتواصل والشحن الثابت والضريبة والحد الأدنى |
| التقارير | مؤشرات طلبات ومخزون، مع تمييز الاختبارات عن العمليات الفعلية |
| الطباعة | ملخص طلب واضح؛ لا يُسمى فاتورة ضريبية |
| الحماية | صلاحيات، جلسات وCookies وCSRF وحدود طلبات وتدقيق وMFA للإدارة |
| التشغيل | Docker/Node، HTTPS، فحص صحة، نسخ مشفّر واستعادة ودليل نشر |

خارج الإصدار الأساسي: محاسبة كاملة، مشتريات موردين، ذمم التجار، حدود ائتمان، أرباح وتكلفة، فواتير ضريبية معتمدة، دفعات صلاحية، مستودعات متعددة، مرتجعات بعد الشحن، بوابات دفع، تطبيقات متاجر، وربط ERP أو WhatsApp/SMS. تُدرج في Backlog ولا تظهر أزرار توهم بتفعيلها.

## 2. الفرق بين النسخة السابقة والتحسينات المطلوبة هنا

| الموضوع | مرجع النسخة 2.0.1 | المطلوب في التنفيذ المنظّم |
|---|---|---|
| تخزين تفاصيل الطلب | Snapshot داخل JSON في الطلب | الحفاظ على التوافق عند التطوير؛ وجدول `order_items` موحّد في المشروع الجديد |
| واجهة API | Endpoint جامع مع `action` | REST تحت `/api/v1`؛ ومحوّل توافق مؤقت إذا كان هناك عميل قديم |
| تحديث المخزون | تعديل الإجمالي مع سجل حركة | مسار تسوية/استلام مستقل، سبب إلزامي، ونسخة سجل لمنع الكتابة من شاشة قديمة |
| تقسيم الكود | خادم وواجهة كبيران | Routes وServices وRepositories وواجهات منفصلة |
| المصدر القديم | يمكن استخدامه أساسًا | لا حذف لقاعدة أو ترحيل هدّام؛ Migration موثق ومختبر أولًا |

هذه تحسينات مقترحة، وليست ادعاءً بأن الجداول أو العقود الجديدة أُضيفت بالفعل إلى الإصدار السابق.

## 3. المعمارية

**المتصفح ← HTTPS/Reverse Proxy ← Node API + ملفات React المجمعة ← SQLite على قرص دائم.**

- تطبيق React/TypeScript عربي، يعرض الكتالوج والإدارة.
- خادم Node.js يقرر الهوية والصلاحيات والأسعار والمخزون؛ لا تُعتمد قيم مالية أو أدوار من المتصفح.
- قاعدة SQLite بوضع WAL، على خادم واحد وباتصال معاملات مضبوط. لا NFS ولا نسخ تطبيق متعددة على نفس الملف.
- الحسابات والجلسات والبيانات مستقلة عن ChatGPT وأي برنامج بيع.
- النسخ الاحتياطي أداة تشغيل محلية؛ لا Endpoint عام لتنزيل القاعدة أو استعادتها.
- حد بداية موثق: 5000 منتج، 1000 صف/1 MiB للاستيراد، 100 صنف مميز في الطلب. هذه حدود منتج وليست نتيجة اختبار حمل.

### هيكل الملفات المستهدف

```text
alkhayr-b2b/
  package.json
  package-lock.json
  tsconfig.json
  .env.example
  .gitignore
  .dockerignore
  Dockerfile
  compose.yml
  Caddyfile
  src/
    server/
      main.ts
      app.ts
      config.ts
      http/
        router.ts
        request-body.ts
        errors.ts
        response.ts
        security-headers.ts
        static-files.ts
      auth/
        passwords.ts
        totp.ts
        encryption.ts
        cookies.ts
        sessions.ts
        csrf.ts
        rate-limit.ts
        authorization.ts
      database/
        connection.ts
        migrations.ts
        transaction.ts
        repositories/
          users.ts
          merchants.ts
          products.ts
          inventory.ts
          orders.ts
          sessions.ts
          audit.ts
          settings.ts
      services/
        registration.ts
        authentication.ts
        merchants.ts
        products.ts
        inventory.ts
        pricing.ts
        orders.ts
        fulfillment.ts
        csv-import.ts
        reports.ts
        audit.ts
      routes/
        auth.ts
        merchant.ts
        products.ts
        orders.ts
        admin-merchants.ts
        admin-products.ts
        admin-inventory.ts
        admin-orders.ts
        admin-settings.ts
        admin-reports.ts
        admin-audit.ts
      cli/
        index.ts
        setup-admin.ts
        reset-password.ts
        reset-mfa.ts
        backup.ts
        restore.ts
    web/
      main.tsx
      App.tsx
      router.tsx
      api/
        client.ts
        contracts.ts
      auth/
        AuthProvider.tsx
        LoginPage.tsx
        RegistrationPage.tsx
        PendingApprovalPage.tsx
        ChangePasswordPage.tsx
      layouts/
        AuthLayout.tsx
        MerchantLayout.tsx
        AdminLayout.tsx
      components/
        Button.tsx
        FormField.tsx
        DataTable.tsx
        Modal.tsx
        EmptyState.tsx
        ErrorState.tsx
        StatusBadge.tsx
        Pagination.tsx
        ProductCard.tsx
        QuantityControl.tsx
        OrderTimeline.tsx
      merchant/
        CatalogPage.tsx
        CartPage.tsx
        OrdersPage.tsx
        OrderDetailsPage.tsx
        ProfilePage.tsx
      admin/
        DashboardPage.tsx
        ProductsPage.tsx
        ProductEditor.tsx
        ProductImportPage.tsx
        InventoryPage.tsx
        MerchantsPage.tsx
        OrdersPage.tsx
        SettingsPage.tsx
        AuditPage.tsx
      print/
        OrderSummary.tsx
      styles/
        tokens.css
        globals.css
        print.css
    shared/
      constants.ts
      schemas.ts
      money.ts
      csv.ts
      order-status.ts
  migrations/
    0001_initial.sql
  scripts/
    build.mjs
    package-release.mjs
    verify-release.mjs
  tests/
    unit/
    integration/
    security/
    fixtures/
  docs/
    PROJECT_STATE.md
    SPEC.md
    DATABASE.md
    API_CONTRACT.md
    SECURITY.md
    THREAT_MODEL.md
    DECISIONS.md
    MIGRATION.md
    DEPLOYMENT_AR.md
    OPERATIONS_AR.md
    TEST_REPORT.md
    RELEASE_CHECKLIST.md
  public/
    index.html
    assets/
  dist/
  data/
  backups/
```

`dist` مخرجات بناء؛ `data` و`backups` بيانات تشغيل خاصة لا تُحفظ في Git ولا تدخل ملفات الإصدار. يمكن جمع ملفات صغيرة عند الحاجة، لكن لا تجمع منطق الحسابات والمخزون كله داخل Route واحد.

## 4. قاعدة البيانات المستهدفة

الجداول الاثنا عشر التالية تخص مشروعًا جديدًا. لو طُوّر المصدر القديم، يحافظ Claude على الأعمدة والبيانات ويكتب ترحيلًا بدل إسقاط الجداول.

| الجدول | الحقول الأساسية والقواعد |
|---|---|
| `auth_users` | UUID، username فريد غير حساس لحالة الأحرف، password_hash، role=`admin/trader`، totp_ciphertext، last_otp_step، created_at |
| `merchants` | user_id فريد وFK، اسم المنشأة، email اختياري، phone، address، status=`pending/approved/suspended`، version، timestamps |
| `sessions` | token_hash فقط، user_id وFK، created_at، last_seen_at، expires_at؛ لا رمز خام في القاعدة |
| `products` | UUID، name، brand، category، barcode نصي فريد عند عدم فراغه، image_url، price_cents، on_hand، reserved، pack_size، minimum_cartons، active، is_demo، version، timestamps |
| `orders` | UUID/رقم عرض فريد، merchant_id، state، subtotal/tax/shipping/total بالقروش، tax_bps، عنوان واسم جهة الشراء Snapshot، note، is_demo، request_key، request_digest، version، timestamps |
| `order_items` | order_id، product_id، اسم وبراند وباركود وحجم عبوة وسعر وقت الطلب، cartons، line_total_cents؛ فريد لكل منتج داخل الطلب |
| `order_events` | order_id، actor_id، old_state، new_state، created_at؛ سجل غير قابل للتعديل من الواجهة |
| `inventory_ledger` | product_id، actor_id، on_hand_delta، reserved_delta، reason، order_id اختياري، operation_key وبصمة لتكرار التسوية، created_at |
| `audit_logs` | actor_id أو anonymous، action، target، metadata مسموح فقط، ip_hmac، request_id، created_at |
| `rate_limits` | مفتاح مشتق من IP/الحساب، count، window_ends_at؛ تنظيف محدود ودوري |
| `business_settings` | صف إعدادات أو key/value مضبوط: بيانات الشركة، shipping_cents، tax_bps، minimum_order_cents، version |
| `schema_migrations` | version فريد، checksum، applied_at؛ سجل ترحيلات لا يُعاد كتابته |

### قواعد لا تقبل التفاوض

- كل الأموال أعداد صحيحة بالقروش؛ لا أسعار من المتصفح ولا Float كمصدر للحسابات المالية.
- `on_hand >= reserved >= 0`، والمتاح = الإجمالي − المحجوز.
- الكميات بالكرتونة، أعداد صحيحة، واحترام الحد الأدنى.
- لا حذف فعلي لمنتج أو حساب له طلبات أو سجل حركة؛ استخدم التعطيل.
- فهارس للباركود واسم المستخدم والجلسات، وطلبات التاجر حسب التاريخ وID، وأحداث الطلب وحركة المنتج.
- `UNIQUE(merchant_id, request_key)`، ومعه بصمة محتوى الطلب.
- Snapshot الطلب القديم لا يتغير عند تحديث اسم المنتج أو السعر أو عنوان التاجر أو إعدادات الشحن والضريبة.

## 5. الشاشات والصلاحيات

| الوظيفة | زائر | تاجر قيد المراجعة | تاجر معتمد | إدارة |
|---|---|---|---|---|
| تسجيل منشأة | نعم | — | — | عبر إنشاء تاجر عادي ثم اعتماده |
| دخول/خروج | نعم | نعم | نعم | نعم + TOTP |
| عرض حالة حسابه وتحديث بياناته | لا | نعم | نعم | نعم لحسابه |
| رؤية الكتالوج والأسعار | لا | لا | نعم | نعم |
| إرسال طلب | لا | لا | نعم لنفسه | نعم لحسابه للاختبار/التشغيل وفق السياسة |
| رؤية الطلبات | لا | لا | طلباته فقط | جميع الطلبات |
| تأكيد/شحن/إلغاء إداري | لا | لا | لا | نعم حسب آلة الحالات |
| إدارة منتجات ومخزون وتجار وإعدادات | لا | لا | لا | نعم |
| تقارير وسجل تدقيق | لا | لا | لا | نعم |
| استرداد كلمات المرور أو MFA من CLI | لا | لا | لا | مسؤول الخادم فقط بعد التحقق من الهوية |

الحساب الموقوف لا يملك جلسة فعالة. إخفاء زر في React ليس تطبيقًا للصلاحية؛ الخادم يرفض كل عملية غير مسموحة.

## 6. عقد API المقترح

كل مسارات الأعمال تحت `/api/v1`. استخدم JSON ورسائل عربية آمنة مع `requestId`. لا يتضمن أي رد password_hash أو OTP secret أو session token.

| الطريقة والمسار | الغرض |
|---|---|
| GET `/healthz` | صحة مختصرة دون بيانات حساسة |
| GET `/api/v1/auth/csrf` | رمز CSRF للجلسة أو تحدٍّ مؤقت قبل الدخول |
| POST `/api/v1/auth/register` | طلب حساب تاجر فقط |
| POST `/api/v1/auth/login` | كلمة مرور، وTOTP للإدارة |
| POST `/api/v1/auth/logout` | إبطال الجلسة والخروج |
| GET `/api/v1/auth/me` | الهوية والصلاحية وحالة المنشأة |
| POST `/api/v1/auth/password` | تغيير كلمة المرور وإبطال جميع الجلسات |
| GET/PATCH `/api/v1/merchant/profile` | بيانات صاحب الجلسة فقط |
| GET `/api/v1/products` | كتالوج معتمد مع بحث وفلاتر وترقيم |
| GET `/api/v1/products/:id` | تفاصيل منتج مسموح |
| POST `/api/v1/orders` | إنشاء طلب صاحب الجلسة بشكل idempotent |
| GET `/api/v1/orders` | قائمة طلباته ومؤشر الصفحة التالية |
| GET `/api/v1/orders/:id` | تفاصيل طلبه فقط |
| GET `/api/v1/orders/:id/summary` | بيانات طباعة مصرح بها؛ ليست فاتورة ضريبية |
| GET/PATCH `/api/v1/admin/merchants/:id` | مراجعة منشأة وتغيير حالتها وفق Schema |
| GET `/api/v1/admin/merchants` | طابور التجار وبحث وفلاتر |
| GET/POST `/api/v1/admin/products` | إدارة المنتجات |
| PATCH `/api/v1/admin/products/:id` | بيانات/سعر المنتج مع expectedVersion |
| POST `/api/v1/admin/products/import` | استيراد CSV محلل ومتحقق منه |
| GET `/api/v1/admin/inventory` | الإجمالي والمحجوز والمتاح |
| POST `/api/v1/admin/inventory/:id/adjustments` | استلام/تسوية بسبب وexpectedVersion |
| GET `/api/v1/admin/inventory/:id/ledger` | سجل حركة المنتج |
| GET `/api/v1/admin/orders` | جميع الطلبات مع فلاتر ومؤشرات |
| GET `/api/v1/admin/orders/:id` | تفاصيل الطلب والأحداث |
| POST `/api/v1/admin/orders/:id/transitions` | انتقال حالة مضبوط ومعاملة مخزون ذرية |
| GET/PATCH `/api/v1/admin/settings` | إعدادات الشركة وإصداراتها |
| GET `/api/v1/admin/reports/overview` | مؤشرات من القاعدة كلها، لا الصفحة الحالية فقط |
| GET `/api/v1/admin/exports/orders.csv` | تصدير مصرح به وآمن من المعادلات |
| GET `/api/v1/admin/audit` | سجل تدقيق مرقم |

خريطة الحالات: `pending → confirmed → preparing → shipped → delivered`، والإلغاء من `pending/confirmed/preparing` فقط. لا رجوع من `shipped/delivered/cancelled` داخل الإصدار الأساسي.

## 7. قواعد المخزون والطلبات

| العملية | الإجمالي | المحجوز | النتيجة |
|---|---:|---:|---|
| إنشاء طلب pending | لا تغيير | لا تغيير | حفظ Snapshot ومراجعة التوافر فقط |
| تأكيد confirmed | لا تغيير | + كميات الطلب | معاملة واحدة لكل الأصناف أو تراجع كامل |
| تجهيز preparing | لا تغيير | لا تغيير | استمرار الحجز |
| شحن shipped | − كميات الطلب | − كميات الطلب | خصم وفك حجز مرة واحدة |
| إلغاء طلب مؤكد/قيد التجهيز | لا تغيير | − كميات الطلب | تحرير الحجز مرة واحدة |
| إلغاء pending | لا تغيير | لا تغيير | تسجيل الحدث فقط |
| تسليم delivered | لا تغيير | لا تغيير | إغلاق مرحلة التشغيل |
| استلام مخزون | + الكمية | لا تغيير | سبب وسجل ونسخة متوقعة |
| تسوية المخزون | التغيير الموثق | لا تغيير | ممنوع أن يصبح الإجمالي أقل من المحجوز |

تأكيد طلبين متنافسين على نفس الكمية يجب أن ينجح لأحدهما فقط إذا كانت الكمية لا تكفيهما، دون حجز جزئي أو رصيد سالب.

## 8. سياسة الأمان المرجعية

- لا Guest، ولا default admin، ولا first-user-is-admin، ولا review-mode في حزمة الاستضافة، ولا قبول لترويسات هوية ChatGPT.
- scrypt عبر Node crypto بمعلمات مرجعية N=131072/r=8/p=1 وملح عشوائي، وذاكرة مضبوطة وحد لتزامن التجزئة.
- كلمات مرور التجار 12 حرفًا على الأقل، والإدارة 15، وحد أقصى 128 حرفًا و512 byte. لا فرض قواعد شكلية تعوّض كلمة مرور ضعيفة.
- TOTP للإدارة: 6 أرقام/30 ثانية، نافذة ±1، وفحص منع إعادة استخدام الفترة بشكل ذري.
- جلسات عشوائية 256-bit، وتخزين hash فقط، وCookie باسم `__Host-...` مع Secure وHttpOnly وSameSite=Strict في الإنتاج.
- انتهاء خمول 15 دقيقة للإدارة و30 للتاجر، وحد مطلق 8 ساعات، وبحد أقصى 5 جلسات. العمليات الإدارية تطلب دخولًا خلال آخر 15 دقيقة، مع مسار إعادة دخول واضح.
- CSRF مرتبط بالجلسة وبالطلب قبل الدخول، وOrigin دقيق. لا CORS مفتوح مع Cookies.
- حد فعلي لجسم JSON أثناء قراءته، وفحص عدد عناصر المجموعات قبل Validation المفصّل، ومهل اتصال وحدود محاولات.
- Host/Origin من إعداد ثابت موثوق. لا تثق بـX-Forwarded-For إلا من Proxy موثوق لا يمكن تجاوزه.
- معاملات SQL وربط المعاملات، وقيود القاعدة، والتحقق من ملكية كل سجل وصلاحية كل عملية.
- CSP، وnosniff، ومنع framing للنسخة المستقلة، وسياسة إحالة مقيدة. لا unsafe-eval ولا inline scripts؛ أي سماح للـinline styles مبرر ومحدود.
- سجلات خالية من كلمات المرور والرموز والأسرار وأجسام الدخول. IP عبر HMAC مع مدة احتفاظ موثقة.
- أسرار MFA مشفرة بمفتاح مشتق لغرضها، ونسخ احتياطية AES-256-GCM بمفتاح مستقل. لا تدّعِ أن SQLite نفسها مشفرة.
- فحص تبعيات فعلي ومؤرخ، وملف Lock، وSBOM/إشعارات تراخيص، وفحص الحاويات على الاستضافة. لا ادعاء «صفر ثغرات» من غير تشغيل الفحص.

النسخ Node 24.22.1 وReact 19.3.1 وZod 4.6.7 وesbuild 0.28.2 مرجع من إصلاح 2.0.1 السابق، وليست إعلانًا أنها الأحدث أو آمنة دائمًا. يجب التحقق من التوافق والتنبيهات وقت التنفيذ وتثبيت نسخ مصلحة في Lock.

## 9. ترتيب التنفيذ

| رقم | المهمة |
|---:|---|
| 00 | البرومبت الرئيسي، فحص الإمكانات، وتثبيت المواصفات |
| 01 | هيكل المشروع والبناء وصفحة البداية |
| 02 | القاعدة والترحيلات والمعاملات |
| 03 | أساس الأمان وCLI إنشاء الإدارة |
| 04 | الدخول والجلسات وCSRF وحدود المحاولات |
| 05 | التجار والاعتماد وبيانات المنشأة |
| 06 | المنتجات والكتالوج والتزامن |
| 07 | المخزون وحركاته والتسويات |
| 08 | حساب الطلب وإنشاؤه ومنع التكرار |
| 09 | تأكيد وتجهيز وشحن وإلغاء الطلبات |
| 10 | التصميم العربي والمكونات المشتركة |
| 11 | واجهة التاجر كاملة |
| 12 | واجهة الإدارة كاملة |
| 13 | استيراد وتصدير CSV |
| 14 | الإعدادات والمؤشرات والطباعة |
| 15 | النسخ والاستعادة والاسترداد التشغيلي |
| 16 | الاختبارات الأمنية والتحقق من التوافق |
| 17 | النشر والحاويات والمراقبة |
| 18 | اختبار القبول وحزمة التسليم النهائية |

كل برومبت أدناه مستقل للنسخ، لكنه يعتمد على عقد المشروع المثبت في المرحلة 00 والنتائج المحفوظة في ملف الحالة.

---

# PROMPT 00 — MASTER CONTRACT & CAPABILITY CHECK

```text
You are the implementation owner for ALKHAYR, an independent Arabic B2B wholesale ordering portal for an Egyptian sweets and chocolate importer. Build working software, not a visual-only prototype.

Read the entire attached blueprint. Treat its scope, permissions, inventory equations, API contract, limits and security rules as the project contract. The UI is Arabic RTL; technical identifiers and internal documentation may be English. Business documentation and user-facing errors must be clear Arabic.

First determine the execution mode:
A. EXTEND_EXISTING if an actual source repository/archive is supplied: inventory its real implementation, preserve business data and compatible behavior, and plan additive migrations. Never assume the old code has already implemented this blueprint's proposed enhancements.
B. BUILD_NEW if no source is supplied: implement the modular structure and normalized database described here.

Check this environment's capabilities before implementing business features: filesystem persistence, a real Node backend, process execution, persistent SQLite storage, test execution, and source/release export. Verify capabilities where possible with small harmless checks. Do not claim that Claude Fable supports a capability without evidence. If its hosting cannot run this backend, produce portable source and Docker/Node artifacts for external hosting; explicitly mark hosted execution unverified. Never replace server authentication, orders or inventory with localStorage or mock APIs to make the UI appear functional.

Use one deployment process and SQLite WAL for the initial limited pilot. The portal owns its catalog, prices, inventory, merchant accounts and orders. No dependency on ChatGPT, a POS, ERP, a browser session from another service, or a vendor's private database. No guest ordering. Do not add payments, full accounting or tax-invoice claims.

Create docs/SPEC.md, DATABASE.md, API_CONTRACT.md, SECURITY.md, THREAT_MODEL.md, DECISIONS.md and PROJECT_STATE.md. Define all schemas, status transitions, authorization rules, currency rules, response errors and migration policy before the feature stages. Record any conflicts and resolve ordinary implementation details consistently. A fundamental unsupported platform or data migration decision must be surfaced; do not silently change the product.

For every following stage: inspect current state, implement only the requested stage, write appropriate tests, run available checks, fix observed failures, and update PROJECT_STATE.md. Finish with changed files, exact checks and results, remaining blockers, and the next stage number. Never fabricate passing tests, audit results, screenshots, API responses or production readiness. The old 22-test/zero-advisory result is historical, not a result for your implementation. Do not install demo users or shared admin bypasses in production.

Implement this specification/capability stage now. Do not execute the later feature stages until their prompts are supplied.
```

# PROMPT 01 — PROJECT FOUNDATION & REPRODUCIBLE BUILD

```text
Continue ALKHAYR from docs/PROJECT_STATE.md and the stage-00 contract. Implement the project foundation only.

Create the modular src/server, src/web, src/shared, migrations, scripts, tests and docs structure. Use a minimal maintained Node.js toolchain with TypeScript/React for the browser. Use the tested baseline versions only as a starting point; verify supported compatible patched versions, pin dependencies in the lockfile, and document the choices. Do not bring the old Next/Vinext/ChatGPT preview stack into the independent production server merely to build a small SPA.

Provide development and production build commands, a Node entry point, a minimal real HTTP router, a React entry point and Arabic index.html. Prefer hash-based UI navigation for this SPA unless the contract explicitly specifies another tested routing strategy. Serve a deliberate static asset allowlist; never expose arbitrary filesystem paths or fall back to index.html for unknown API routes. Production assets must not depend on development servers or remote script CDNs.

Implement typed configuration validation, a non-sensitive GET /healthz, a consistent Arabic error envelope with requestId, graceful shutdown and HTTP request/header timeouts. Create public .env.example placeholders, .gitignore and .dockerignore. Keep actual .env, databases, backups, private keys, node_modules and temporary test state out of source and release archives. Never inject server environment secrets into the browser build.

Acceptance: the empty application builds; the server returns the real static page and health response; unknown endpoints return appropriate errors; .env/source/database traversal attempts are rejected; development limitations are stated. Do not add fake catalog metrics or a pretend successful login. Record exact commands and the reproducible startup procedure. Update PROJECT_STATE.md for stage 02.
```

# PROMPT 02 — DATABASE, CONSTRAINTS & SAFE MIGRATIONS

```text
Implement ALKHAYR's database foundation according to DATABASE.md and the blueprint.

For a new database, create auth_users, merchants, sessions, products, orders, order_items, order_events, inventory_ledger, audit_logs, rate_limits, business_settings and schema_migrations. Use explicit foreign keys, unique/check constraints and indexes. Money is integer minor units. Enforce on_hand >= reserved >= 0 and positive integral carton/pack/minimum quantities. Make usernames case-insensitively unique, nonempty barcodes unique, and (merchant_id, request_key) unique. Retain order snapshots independent of later master-data edits.

Use SQLite on a persistent local disk with WAL, foreign_keys enabled, busy timeout and appropriate durability settings. Expose a transaction helper using BEGIN IMMEDIATE for writes that must serialize. A transaction must contain only synchronous database work: no network calls, password hashing or awaited operations that leave a write transaction open.

Implement versioned, checksum-verified, ordered migrations and a schema version guard. Never modify applied migration history. Do not create/alter migration-owned tables during HTTP request handling. Repeated startup must not reseed or reset real data. Do not ship a production seed administrator.

If extending 2.0.1, inspect its actual columns and orders.items JSON snapshots. Plan and test additive migration/backfill to normalized order_items without dropping the original data or changing totals. Detect unsupported legacy states; require a restorable backup before migration. Document compatibility adapters for existing API clients.

Acceptance: fresh initialization, repeat migration, foreign-key failures, invalid inventory, duplicate username/barcode/request-key cases, transaction rollback and newer-schema rejection are tested. If an existing database is supplied, test a copy and compare counts and financial snapshots before/after. Never run destructive migration against the only copy. Update database docs and PROJECT_STATE.md.
```

# PROMPT 03 — SECURITY PRIMITIVES & ADMINISTRATOR BOOTSTRAP

```text
Implement the cryptographic/security foundation and local administrator CLI, not the login endpoints yet.

Use Node's standard cryptographic APIs: CSPRNG session material, scrypt for passwords, constant-time verifier comparison, and authenticated encryption for recoverable secrets. Use unique salts; the reference password parameters are N=131072, r=8, p=1 with adequate maxmem. Bound expensive hashing concurrency and queued work so authentication cannot consume unlimited RAM. Passwords must never be logged, returned or stored in plaintext.

Require at least 12 password characters for traders, 15 for administrators, maximum 128 characters and 512 UTF-8 bytes. Implement standard TOTP with a 20-byte random secret, 6 digits, 30-second steps and a +/-1 step window. Test an independent RFC 6238 reference vector. Anti-replay enforcement will use an atomic last accepted step update in stage 04.

Use a high-entropy APP_SECRET for purpose-separated server keys; encrypt MFA secrets with AES-256-GCM and unique nonces. Derive keys with explicit domain separation. BACKUP_KEY must be independent. Validate secret configuration at startup; placeholders and missing production secrets must fail closed. Never generate a shared fallback secret.

Create an interactive CLI setup-admin command with hidden password entry, confirmation and no password in process arguments. Create exactly the intended admin and approved merchant profile transactionally. Show the MFA enrollment secret/URI once to the trusted operator, with no browser/API route to retrieve it. Refuse accidental duplicate bootstrap. No first-user-is-admin rule, preinstalled accounts, hardcoded test logins or review-mode production access.

Acceptance: correct/incorrect password verification, bounded hashing, encryption round-trip/tamper/wrong-key rejection, TOTP vector/window/replay helper behavior, missing-secret failure and bootstrap guards are tested with disposable fixtures. Mark any untested interactive terminal behavior explicitly. Update SECURITY.md and PROJECT_STATE.md.
```

# PROMPT 04 — AUTHENTICATION, SESSIONS, CSRF & ABUSE LIMITS

```text
Implement the real /api/v1/auth endpoints and authorization middleware.

Registration may create only a pending trader. Reject unexpected role/status/security fields. Normalize usernames, validate merchant contact details and return a generic duplicate-registration response. Login must use the real password verifier and generic failure messages; unknown users must not receive a cheap path that reveals account existence. Require TOTP for admins and update the accepted time step atomically to prevent concurrent replay. Recheck the current password/status after expensive verification and before issuing a session, so concurrent suspension/reset cannot be bypassed.

Generate random 256-bit session tokens and persist only their hash. Rotate sessions on login; use __Host-prefixed, Secure, HttpOnly, SameSite=Strict, Path=/ cookies in production without a Domain attribute. No authentication tokens in browser local/session storage. Enforce 15-minute admin/30-minute trader idle expiry, 8-hour absolute expiry and at most five sessions per account. Require recent administrative authentication and provide a clear re-login response.

Implement GET csrf with a session-bound token and an expiring signed pre-login challenge. Enforce the token, exact configured Origin and allowed content type for mutations, including login/registration/logout. Reject cross-site requests and forged ChatGPT/role headers. Do not enable wildcard credentialed CORS.

Add durable bounded rate limits for IP/account login, registration and general APIs. Trust forwarded IPs only through the documented trusted proxy boundary. Record generic audit events without credentials. Bound the actual request bytes while reading, timeouts, collection counts and hashing work. Document rate-limit availability tradeoffs.

Implement logout and password change. Password changes must reverify current credentials/MFA, conditionally update against the current stored password and revoke every session atomically. Do not claim logout succeeded if revocation failed.

Acceptance: valid/invalid login, MFA replay races, missing/forged CSRF, Origin attacks, forged session/header roles, expiry, five-session cap, fixation, password-reset/suspension races and secret-free responses/logs are tested. Update PROJECT_STATE.md.
```

# PROMPT 05 — MERCHANT REGISTRATION, APPROVAL & PROFILE OWNERSHIP

```text
Implement merchant lifecycle and profile routes using the established authentication and permission checks.

A new merchant begins pending. Pending authenticated merchants may see their own approval state, edit their own validated business/contact information and change their password; they cannot read prices, inventory, order data or submit orders. Suspended accounts must lose active sessions and be denied normal access. Approved traders may use their own account only. Never accept a merchant/user ID from the browser as the authority for a self-service operation.

Implement GET/PATCH /api/v1/merchant/profile and the admin merchant list/detail/status endpoints. Keep name, optional email, phone and address validation consistent between registration and profile editing. Restrict state values to pending/approved/suspended. The status mutation must require administrator authorization/recent authentication, apply atomically and revoke sessions when access is removed. Do not let this interface alter administrator roles or suspend the only administrator.

Use a merchant version for conflicting profile updates, with explicit 409 handling instead of silent stale overwrites. Record approval/suspension/profile events with actor and target, but exclude unnecessary personal details from audit metadata. Expose personal contact information only to the owner of the merchant profile and authorized administration.

Existing order snapshots must retain their original merchant name/address when the profile changes. Do not implement public password-reset promises, email verification or SMS delivery without a configured, tested service; document operator-assisted recovery instead.

Acceptance: two traders cannot read/update one another's profiles; request-body IDs/role fields cannot bypass ownership; pending accounts remain restricted; approval unlocks catalog; suspension invalidates existing sessions; a profile update does not alter old orders. Add repository/service/integration tests and update API_CONTRACT.md and PROJECT_STATE.md.
```

# PROMPT 06 — PRODUCT MANAGEMENT & APPROVED CATALOG

```text
Implement administrator product management and the approved merchant catalog.

Products include name, brand, controlled category, optional text barcode preserving leading zeros, HTTPS image URL, carton price in integer cents, pieces per carton, minimum cartons, active/demo flags and a version. Enforce the blueprint's four initial categories, a catalog cap of 5000 products and validation limits. The displayed piece price is informational; order quantities remain integral cartons. Images are user-supplied HTTPS URLs without embedded credentials and use a no-referrer policy. Do not create server-side arbitrary URL fetching or file-upload execution surfaces.

Expose admin list/create/patch and merchant catalog/detail endpoints with server-side authorization, bounded search, filter/sort allowlists and pagination. Treat user search as data; never interpolate arbitrary sort columns or SQL fragments. Merchants must not see inactive products or unnecessary internal records. Pending/anonymous/suspended visitors receive no catalog prices.

Separate product metadata/price updates from stock adjustments; stage 07 owns inventory mutations. New-product initial stock must create a traceable opening ledger entry transactionally. Require expectedVersion for edits and return 409 on stale forms. Any stock/reservation change must advance the version to protect administration against concurrent stale overwrites.

Do not delete products referenced by orders or ledger entries. Use deactivation. Existing order items retain original snapshots. Disable sample/demo seeding in production by default; do not mix fabricated product packaging or supplier claims into real product data.

Acceptance: exact cents validation, barcode uniqueness/leading zeros, malicious names as inert data, unsafe image schemes/credentials, inactive visibility, unauthorized edits, bounded catalog queries, stale-version conflicts and snapshot preservation are tested. Update PRODUCT/API docs and PROJECT_STATE.md.
```

# PROMPT 07 — INVENTORY, RECEIPTS, ADJUSTMENTS & LEDGER

```text
Implement the standalone inventory service and administrator inventory screens' API contracts.

Define on_hand as the physical total tracked by this portal, reserved as confirmed/preparing commitments, and available = on_hand - reserved. Do not read or silently synchronize a separate sales program. If another channel sells the same goods, the operator must allocate stock to this portal or reconcile it explicitly; document this operational boundary.

Implement administrator inventory listing, a product ledger and a stock-adjustment endpoint. Support opening stock, receipt and correction as controlled reason types. Require an explanation, nonzero integral change (or an explicit set-total operation), expected product version and authorized recent admin identity. For set-total, calculate the delta from current state inside the transaction. Reject any result below reserved or below zero. Do not let an inventory adjustment mutate reserved directly.

Every committed adjustment must write an append-only ledger record with actor, deltas, reason, timestamp and optional external reference, plus a minimal audit event. Do not allow UI deletion/editing of historical ledger entries. Use a compensating adjustment to correct an operator mistake. Make a repeated adjustment request idempotent or otherwise guard accidental resubmission with a scoped operation key.

Provide a clear distinction between total, reserved and available in responses. Never accept the browser's available value. Reservation and shipment movements will be called only by stage 09, through the same inventory service and database transaction.

Acceptance: receipt, positive/negative correction, stale-version rejection, repeated request protection, reserved-floor enforcement and rollback of both balance and ledger on failure are tested. Test a concurrent metadata edit versus inventory/reservation update. Explain that this is quantity inventory, not full purchasing, costing, warehouse or expiry-batch accounting. Update PROJECT_STATE.md.
```

# PROMPT 08 — AUTHORITATIVE PRICING & IDEMPOTENT ORDER CREATION

```text
Implement the order creation service and authorized trader order queries.

POST /api/v1/orders takes a scoped idempotency request key, note and distinct product IDs with integral carton quantities. It may include expected unit prices for stale-price detection, but never trusts client prices, totals, tax, shipping, merchant ownership or status. Reject duplicate product lines, more than 100 distinct items, invalid minimum quantities, unavailable/inactive products and mixed demo/real merchandise. Check simple collection size before detailed validation; also enforce the wire-body limit.

Read the authenticated merchant's current approval and address at the authorization boundary. Inside a serialized transaction, verify product availability and current prices, compute authoritative line/subtotal amounts in integer cents, apply the configured minimum subtotal, tax basis points and fixed shipping, and save immutable item/merchant/address/settings snapshots. Use exact integer/BigInt intermediate tax calculations and a documented rounding rule. Enforce safe financial limits and reject overflow. Creating a pending order must not reserve or deduct stock.

Scope UNIQUE(merchant_id, request_key) to the caller. Canonicalize meaningful request content into a digest. An identical retry must return the same order; reuse of the key with different content returns 409. Handle concurrent identical requests transactionally. Generate collision-resistant order IDs, not short predictable sequence-based authorization tokens.

Implement paginated own-order list/detail/summary routes with stable created_at + ID ordering. Check ownership on detail and pagination cursors; an unguessable ID does not replace authorization. The order total and address must remain unchanged after catalog/profile/settings updates.

Acceptance: authoritative prices, price tampering, stale-price conflict, invalid quantities, minimum order, tax rounding/overflow, mixed demo rejection, concurrent idempotency, changed-content conflicts, ownership/IDOR and stable snapshots are tested. Update PROJECT_STATE.md for fulfillment.
```

# PROMPT 09 — ORDER STATE MACHINE & ATOMIC FULFILLMENT

```text
Implement administrator fulfillment using the already-tested orders and inventory services.

Allowed transitions are pending -> confirmed -> preparing -> shipped -> delivered, with cancellation only from pending, confirmed or preparing. No skipped, backward or repeated final transitions. Administrators require recent authentication. Validate the current order version/state inside the same write transaction as all effects; concurrent requests must not both succeed.

Rules:
- pending creation has no reservation.
- confirmed reserves every order line only if sufficient available stock exists for all lines. Use guarded updates and verify affected rows. If any line fails, roll back the entire order transition, all reservations, versions, events and ledger entries.
- preparing retains reservations.
- shipped deducts both on_hand and reserved for the committed quantities once.
- delivered adds no further stock movement.
- cancelling confirmed/preparing releases reservations once; cancelling pending changes no inventory.

Write append-only order events, relevant inventory ledger deltas and an audit event in the same atomic operation. Never perform email, external API calls or other awaited work inside the transaction. Do not allow later price changes to silently reprice an existing order. Do not permit product editing or import to reduce total stock below commitments.

Return explicit conflicts that let the administrator refresh and see why an order could not be confirmed. Do not partially confirm an order without a separately specified partial-fulfillment feature. Returned merchandise and post-shipment cancellation are out of this release; do not fake them by changing a status.

Acceptance: two competing orders for insufficient stock; multi-line rollback when a later item is short; repeated/crossed transitions; cancellation release once; shipment deduction once; preserved snapshots and ledger/event consistency. Test actual concurrent HTTP requests, not just isolated mocked service calls. Update PROJECT_STATE.md.
```

# PROMPT 10 — PREMIUM ARABIC RTL DESIGN SYSTEM

```text
Implement ALKHAYR's reusable visual system and application shells, connected to the real state contracts but without pretending unfinished features work.

Brand direction: refined cream and red, suitable for a sweets/chocolate importer serving business traders. Use off-white/cream surfaces, deep warm red primary actions, dark readable text and restrained candy-color category accents. Avoid excessive pink or a childish layout. Keep Arabic spelling correct, RTL reading order, Egyptian-pound formatting and a professional wholesale tone. Use an authentic supplied logo if available; otherwise use a clearly provisional typographic wordmark. Do not invent supplier packaging, certifications, sales numbers or testimonials.

Build AuthLayout, MerchantLayout and AdminLayout plus accessible buttons/fields, tables, modal/dialog, status badges, pagination, loading/error/empty states, product cards, quantity controls and order timeline. Product artwork must use actual provided image URLs or explicit illustrative placeholders. Expose total/reserved/available clearly to administration and only permitted availability data to traders.

Ensure mobile navigation, scrollable tables, readable prices, visible logout, keyboard access, focus handling, semantic labels and reduced-motion support. Use restrained hover transitions; no animation that blocks ordering. Define consistent design tokens rather than scattered arbitrary colors. Support narrow phone widths without clipped Arabic labels or hidden critical controls.

Keep auth tokens out of browser storage. Use a typed API client abstraction with distinct loading, unauthenticated, pending, forbidden, conflict and network-failure states. Do not make a failed API call look like an empty successful catalog. No fake notification, payment or export buttons.

Acceptance: build/type checks pass; inspect representative mobile and desktop screens where tools permit. Fix overflow, contrast and focus problems. If browser QA cannot run, state it plainly and provide exact manual checks rather than invented screenshots. Update PROJECT_STATE.md.
```

# PROMPT 11 — COMPLETE MERCHANT EXPERIENCE

```text
Connect the trader interface to the real API and business policies.

Implement registration, login, pending-approval status, suspended/expired access handling, catalog search/category/brand/sort/pagination, product details, carton quantities, cart, current-price review, note, order submission, order history/detail/timeline, authorized print summary, reordering, profile editing, password change and visible logout on mobile and desktop.

Registration must never offer administrator roles. Login requests TOTP only where necessary for administration without exposing secrets. Pending merchants may correct their own validated profile but cannot see prices or place orders. Handle 401/403/409/428 and network failures distinctly. An administrative reauthentication requirement must not route users into ChatGPT or an unsupported external login page.

The cart stores only validated draft/cart data, never authentication credentials. Filter malformed storage values and handle unavailable browser storage gracefully. Keep a stable idempotency key for retries of the same submission, including refresh recovery within the documented scope. Clear appropriate draft data on successful submission/logout. Do not claim logout succeeded if server revocation failed.

When price or availability changes, refresh authoritative data and explain the conflict. Allow decreasing/removing an item whose old quantity now exceeds availability. Show carton price, pieces per carton, minimum cartons, subtotal, current configured tax/shipping and final estimate. The server remains authoritative. Reordering uses current products/prices and explicitly reports missing/inactive items; it does not resurrect old snapshots as a new authoritative price.

Acceptance: registration -> pending -> approval -> catalog -> submit -> history works against the real backend. Test an expired session, changed price, stock shortage, duplicate click/network retry, profile update and cross-account logout/login. Use disposable test accounts only; never seed test credentials into production. Update PROJECT_STATE.md.
```

# PROMPT 12 — COMPLETE ADMINISTRATION EXPERIENCE

```text
Implement the administrator interface against the real admin endpoints and current permission checks.

Provide a useful dashboard, merchant review queue/detail/status controls, product list/editor/activation, catalog and barcode search, inventory total/reserved/available listing, receipt/correction form with mandatory reason, per-product movement ledger, order queue/detail with event timeline and only legal state transitions, business settings, audit viewer, security/password page and logout.

Never expose password hashes, active session tokens, MFA enrollment secrets or APP_SECRET. Admin creation and MFA recovery remain local trusted-operator CLI operations, not browser shortcuts. A trader preview feature may change UI presentation for the authenticated admin, but it must not create a guest endpoint, disable backend checks or become a shared admin bypass.

Use expectedVersion and the authoritative state for product/settings/profile/inventory/order edits. A conflict must preserve the user's draft where practical, explain that the record changed and offer refresh; never silently overwrite another operator's receipt or a new reservation. Deactivation must not erase historical orders. Do not allow merchant controls to promote roles or suspend the only admin.

Display the consequences before an order transition or stock correction: confirmation reserves, shipment deducts and cancellation releases. Do not invent partially shipped/paid/refunded states. Audit pages should translate controlled action/status identifiers into useful Arabic and show safe references without dumping secret request data.

Acceptance: finish a real admin workflow with two approved test traders and competing stock requests. Verify unauthorized APIs remain forbidden even if a trader manually calls the admin URL. Confirm mobile logout, reauthentication, conflict handling and inventory reasons are usable. Mark anything not browser-tested. Update PROJECT_STATE.md.
```

# PROMPT 13 — CSV IMPORT, SAFE EXPORT & BULK TRANSACTIONS

```text
Implement production-usable CSV import/export, not a decorative upload control.

Provide a downloadable UTF-8 BOM template with documented fixed headers: name, brand, category, price, stock, pack, min, barcode, image. Prices in the file are EGP decimal strings converted exactly to cents; stock/min/pack are integral carton/pack counts. Preserve barcode leading zeros. Support valid quoted commas, quotes and line endings with a tested CSV parser. Reject unsupported/duplicate headers, malformed records, invalid numeric notation, more than 1000 rows or a file/request larger than 1 MiB. Do not claim XLS/XLSX support unless separately implemented and tested.

Use a bounded browser CSV parser and submit normalized JSON rows, import mode, operation key and declared stock policy to the import API. The server must independently validate all rows, field types and limits; browser validation is never authoritative. Check both CSV file size and serialized JSON request size. Show validation errors with useful row references before commit. The administrator selects an explicit import mode: create-only or upsert-by-nonempty-barcode. Define stock behavior explicitly: default skip stock changes for existing products; an intentional set-total mode requires a reason, current-version/conflict policy and reserved-floor enforcement. Never let a stale spreadsheet silently overwrite real stock or reservations.

Validate the whole batch and commit all records/ledger/audit effects inside one transaction, or roll it all back. Detect duplicate identifiers/barcodes within the file. Do not create a product twice on a simple retry; use a scoped import operation key/digest or equivalent documented protection.

Implement an authorized orders CSV export whose scope is enforced server-side. Escape quotes and protect spreadsheet cells against formula execution, including leading whitespace/BOM/control characters before =, +, -, or @. Do not export credentials or unnecessary merchant data. Bound export size or provide an explicit paging/streaming strategy.

Acceptance: UTF-8 Arabic, embedded commas/quotes/newlines, barcode zeros, numeric validation, invalid middle-row rollback, existing reserved-stock conflicts, retry behavior and formula injection cases are tested. Update import docs and PROJECT_STATE.md.
```

# PROMPT 14 — BUSINESS SETTINGS, ACCURATE REPORTS & PRINT SUMMARY

```text
Implement settings, database-wide operational reporting and a truthful printable order summary.

Settings include company name/contact/address, fixed shipping cents, tax basis points and minimum order subtotal. Validate bounded integers and require authorized recent admin identity plus expectedVersion for updates. Do not hardcode a statutory tax rate or assert legal invoice compliance. The operator must configure business-appropriate values. New settings affect new orders only; stored order snapshots remain immutable.

Compute reports from the full authorized database scope, not from whichever order page is currently loaded in React. Include real-order count, pending count, approved trader count excluding admin, order-state distribution, confirmed operational order value, and low available stock. Exclude demo/test orders and cancelled orders from value metrics as specified. Label confirmed order value honestly: it is not cash collected, net profit or audited accounting revenue. Handle empty data without fabricated growth metrics.

Provide stable paginated order history and independently authorized detail/summary access. Printing must show the actual company information, order number/date/status, merchant/address snapshot, item snapshot names/pack/quantities/unit prices, subtotal, tax, shipping, total and note. Use an explicit Arabic label that it is an order summary, not a tax invoice. Print styles must hide navigation and action buttons and avoid clipped Arabic tables.

Acceptance: add more orders than one page and prove dashboard totals still match database queries; verify ownership and cursor checks, tax rounding and order snapshots after settings/profile changes. Test print rendering where available, or document the remaining visual inspection precisely. Do not add a fake PDF export button. Update PROJECT_STATE.md.
```

# PROMPT 15 — ENCRYPTED BACKUP, RESTORE & OPERATOR RECOVERY

```text
Implement trusted-operator maintenance commands and a tested recovery procedure.

Use SQLite's supported online backup API to create a consistent snapshot even with WAL activity. Encrypt backup artifacts using AES-256-GCM, fresh random nonces and an independently generated BACKUP_KEY. Define a versioned file header. Protect any temporary plaintext files/directories, remove them on both success and failure, and write the final encrypted artifact atomically so incomplete files cannot masquerade as valid backups. Do not expose backup/download/restore endpoints on the public HTTP server.

Restore must require an explicit stopped-server acknowledgement and a NEW, nonexistent target path. Authenticate/decrypt before accepting content, check schema compatibility, integrity_check and foreign_key_check, and revoke all restored sessions before switching databases. Never overwrite the only live database or combine a restored database with an old WAL file. Wrong keys/tampering/truncated files must fail without leaving an accepted restored database.

Provide interactive local reset-password and reset-mfa commands restricted to the trusted host operator. Verify the target, use hidden new password entry, preserve admin password policy, invalidate all target sessions, audit the action and never create a public recovery backdoor. Document manual identity verification before resetting a trader. Do not claim email recovery is configured.

Document a practical off-host backup schedule, retention, independent key recovery and restore drill. A script is not an actual configured external backup: distinguish implemented mechanism from hosting tasks the operator still must perform.

Acceptance: backup during database activity; successful restore with matching business totals; zero restored sessions; wrong key/tampered/truncated file rejection; refusal to overwrite an existing target; cleanup of plaintext temporaries. No production keys/data in fixtures or release archives. Update PROJECT_STATE.md.
```

# PROMPT 16 — ADVERSARIAL SECURITY & REGRESSION TEST GATE

```text
Act as an independent application security reviewer of the code actually implemented so far. This stage must run tests and fix demonstrated defects, not simply restate a checklist.

Inspect authentication, authorization, query construction, state transitions, request parsing, secrets, static file serving, CSV handling and deployment assumptions. Create a severity-ranked findings table with evidence and exact files. Do not invent vulnerabilities or equate a package version alert with a proven exploit. Address confirmed critical/high risks before release, then assess the remaining issues explicitly.

Run unit and real HTTP integration tests covering: unknown/incorrect login; admin TOTP and replay races; username/role mass assignment; pending/suspended access; forged identity headers and session fixation; secure cookies; CSRF before/after login and Origin/Host attacks; idle/absolute expiry, session cap and revocation races; cross-merchant IDOR and cursors; SQL/XSS input; oversized bodies and collection counts; authoritative prices and exact money; idempotency races; competing stock confirmations, multi-line rollback, cancellation/shipment once; stale versions; import rollback; CSV formulas; secret-free logs; backup corruption and recovery; and unsupported review-mode rejection.

Check the exact dependency graph, including development/build tools, with the configured registry and explicit disclosure awareness: npm audit sends dependency metadata to a registry. Respect authorization already provided in this execution environment. Fix patched versions with compatibility tests; do not blindly use --force, downgrade vulnerable frameworks or suppress findings. Record registry/date/scope, before/after counts and lockfile. A zero report is not a guarantee and does not scan container OS images or all bundled code.

Never weaken scrypt, disable MFA/CSRF, fake identities or delete a failing test to get a green result. Use disposable databases/credentials only. Save exact test results and remaining limitations in TEST_REPORT.md and SECURITY.md. Do not claim the old project's 22 tests ran for this project. Update PROJECT_STATE.md.
```

# PROMPT 17 — PORTABLE DEPLOYMENT, HTTPS & OPERATIONS

```text
Prepare ALKHAYR for external hosting with a reproducible production release.

Build the React assets and Node server/CLI into a small release that starts without a development server. Bundle runtime dependencies where appropriate, include licenses and exact version metadata, and retain lockfiles/source separately. Do not include actual .env, database/WAL files, backups, test accounts, private keys, credentials or unrelated source-platform artifacts. Include a release manifest and integrity verifier, while stating that a bundled checksum alone does not prove publisher identity.

Provide a Dockerfile using a maintained pinned supported Node version, a non-root user, persistent data/backup mounts and read-only application filesystem. Compose should expose only the trusted reverse proxy to the Internet, not the API port; add resource limits and safe shutdown. Configure Caddy or an equivalent supported proxy for HTTPS and request-size limits. Do not assert that DNS/TLS or image security is configured until actually tested on the target host.

APP_ORIGIN must be exact and production HTTPS. Validate Host/Origin, carefully document TRUST_PROXY and prevent bypass of that proxy. Health checks must use a real request with the expected Host header; verify that the chosen HTTP client actually transmits it. Keep health responses non-sensitive. Document log redaction, audit retention, process monitoring, update/rollback and off-host backup configuration.

Write DEPLOYMENT_AR.md and OPERATIONS_AR.md covering DNS, environment/key generation locally, admin/MFA bootstrap, data permissions, start/stop, health checks, import, reset, backup/restore and limited pilot acceptance. Explain that PHP-only/shared static hosting cannot run this Node backend. SQLite supports one application instance here, not horizontal scaling or NFS.

Acceptance: validate release contents and checksums; run container/production-start checks if supported, otherwise mark them NOT RUN with concrete target-host steps. Do not deploy to an external account or change audiences without the user's deployment authorization. Update PROJECT_STATE.md.
```

# PROMPT 18 — END-TO-END ACCEPTANCE, HANDOFF & READINESS REPORT

```text
Complete ALKHAYR's release handoff using evidence from the current repository, not earlier promises.

Run the actual build, type checks and relevant security/business tests after all changes. Where available, use real browser checks at narrow mobile and desktop sizes. Execute a disposable acceptance workflow: initialize the real database; create the admin through the supported secure procedure; log in with MFA; register two traders; prove pending restrictions; approve them; add/import real-shaped test products; submit competing orders; confirm one under insufficient stock; verify complete rollback for the other; test cancellation and shipment accounting; verify trader isolation; change price/profile/settings and prove old order snapshots remain fixed; suspend an active trader; reset a password and prove sessions are revoked; back up and restore into a new database with matching counts/totals and no active sessions.

Verify the exact deliverable's dependency lock and artifact contents, not merely the development folder. Keep synthetic test data outside production artifacts. Resolve observed failures and rerun affected checks. Do not mark a missing browser, Docker engine, target-host TLS test, external image scan or load test as passed.

Deliver:
1. A deployable runtime archive.
2. A separate complete source archive with lockfiles and reproducible build/test commands.
3. Arabic deployment, daily operations and recovery guides.
4. A security/test report with exact commands, dates, results, scope and untested items.
5. A migration/data-retention report if extending an existing version.
6. A short release checklist with GO/CONDITIONAL GO/NO GO for a limited pilot versus public production.

State every required remaining operator action: hosting/domain/TLS, keys and MFA enrollment, actual products/prices/opening stock, off-host backup scheduling, monitoring, and any unconfigured optional integrations. Preserve independent ownership of merchant/order/inventory data. Do not call this a full accounting/ERP system or an approved fiscal-invoicing solution.

Finalize PROJECT_STATE.md with implemented features, known limitations, test evidence, release version and how the next developer can continue. Do not claim unlimited capacity or absolute security. Provide files and a concrete handoff, not just a plan.
```

---

## 10. برومبت استكمال بعد انقطاع السياق

```text
Resume the existing ALKHAYR implementation. Do not start over or create a second project.

Read docs/PROJECT_STATE.md, SPEC.md, DATABASE.md, API_CONTRACT.md, SECURITY.md, DECISIONS.md and the actual current code/tests. Verify which stages are implemented and which checks were really run. Preserve all business data, immutable migrations and established contracts. Do not trust old chat claims as proof of current functionality.

Continue the first incomplete authorized stage using its prompt from the attached blueprint. Fix observed regressions before adding unrelated features. Do not replace the backend with browser storage or reintroduce demo/shared administrator access. If context is missing, recover it from repository files before asking me for information already recorded there.

Finish by updating PROJECT_STATE.md with changed files, exact verification results, remaining limitations and the next stage number. Never claim success for commands that could not run.
```

## 11. برومبت مراجعة تنفيذ Claude قبل الانتقال للمرحلة التالية

```text
Review only the stage you just implemented against its acceptance criteria and the ALKHAYR master contract.

Inspect real files and exercise the relevant backend/UI behavior where possible. Identify missing or fake features, authorization gaps, unhandled error/conflict states, data loss risks and untested claims. Rank findings by severity, fix defects within this stage, and rerun the affected checks. Do not rewrite unrelated modules, disable security controls or delete meaningful failing tests.

Provide a compact result: PASS / CONDITIONAL / FAIL, evidence, changed files, exact tests run, what was not run, and whether the next stage can safely begin. Save this in docs/PROJECT_STATE.md.
```

## 12. بياناتك المطلوبة عند التشغيل

| البيانات | مصدرها وطريقة التعامل معها |
|---|---|
| المنتجات والباركود والبراند والصور | قائمتك الفعلية؛ راجع أسماء ووحدات وصور الموردين |
| سعر الكرتونة وعدد القطع والحد الأدنى | قرار الشركة، وليس قيمة يستنتجها الذكاء الاصطناعي |
| رصيد الافتتاح | جرد/رصيد موثوق مخصص للبوابة، مع تاريخ وسبب |
| بيانات الشركة والشحن والضريبة | إعدادات فعلية يراجعها المسؤول المالي والتشغيلي |
| التجار | طلب تسجيل ومراجعة واعتماد؛ لا حسابات تخمينية |
| الدومين والخادم | تضبطهما وقت الاستضافة وتختبر HTTPS والصلاحيات |
| مفاتيح التشفير وكلمة مرور المدير وMFA | تُنشأ وتُحفظ محليًا على خادمك/مدير أسرارك؛ لا تُرسل داخل المحادثة |
| النسخ خارج الخادم والمراقبة | تُضبط وتُختبر على مزودك الفعلي؛ الملف وحده لا ينشئها |

## 13. معيار الاستلام منك للمطور أو لـClaude

لا تعتمد عبارة «خلصت». اطلب تشغيل مسار واحد من البداية للنهاية أمامك: حساب تاجر جديد → موافقة الإدارة → منتج برصيد معلوم → طلب → حجز → تجهيز → شحن → تسليم، ثم جرّب منافسة طلبين على كمية واحدة، ومحاولة رؤية طلب تاجر آخر، واستعادة نسخة احتياطية.

القبول التجريبي لا يساوي الاعتماد العام. ابدأ بنطاق محدود وبيانات حقيقية مضبوطة، وسجّل الأخطاء والفروقات، ثم قرر التوسع بناءً على النتائج.
