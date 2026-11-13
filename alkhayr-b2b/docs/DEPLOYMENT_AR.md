# دليل النشر والتشغيل (المرحلة 17)

> **ما الذي يثبته هذا الدليل وما الذي لا يثبته**
> - **ملفات النشر جاهزة:** `Dockerfile`، و`deploy/compose.yaml`، و`deploy/caddy/Caddyfile`، و`deploy/env.example`.
> - **اختُبرت محليًا بيئة مشابهة للإنتاج** على جهاز تطوير، داخل حاوية، بشهادة من **جهة Caddy المحلية** (غير موثوقة
>   عامة)، واسم نطاق تجريبي (`staging.alkhayr.test`).
> - **لم يجرِ** نشر على خادم مستضاف، ولا إصدار شهادة عامة (ACME)، ولا نسخ خارجي حقيقي، ولا إطلاق للتجار.
> - **لا يُفتح البوابة للتجار** قبل حسم قرارات الإطلاق (B-1 وB-4 وB-5) وإغلاق B-2 (نسخ خارجي مُتحقَّق) وB-3 (TLS عام).

---

## 1. المعمارية

```
الإنترنت ──443/80──► Caddy (proxy) ──شبكة داخلية app_net──► التطبيق (app, نسخة واحدة) ──► SQLite على قرص محلي (volume)
                                                                ▲
                                     backup (جدولة النسخ) ──────┘ ──شبكة backup_net──► تخزين خارجي S3 (عند إعداده)
```
- **التطبيق:**
  - نسخة واحدة فقط؛ لا تزد عدد النسخ أبدًا.
  - Node.js 24.22.3 داخل صورة distroless بلا shell، تعمل بالمستخدم 1000.
  - نظام ملفات للقراءة فقط، وبلا صلاحيات (`cap_drop: ALL`).
  - لا يقبل اتصالًا إلا من عنوان Caddy الثابت (`ACCEPT_ONLY_FROM_PROXY`).
- **قاعدة البيانات:**
  - SQLite في volume دائم على **قرص محلي** (ليس NFS/SMB)، ولا تُخزَّن داخل الحاوية.
  - لا يُركَّب مجلد المصدر أبدًا.
- **Caddy 2.11.9:**
  - شهادة ACME في الإنتاج، وتحويل HTTP إلى HTTPS.
  - يستبدل ترويسات X-Forwarded-For ولا يثق بما يرسله العميل.
  - يرفض أي Host لا يطابق اسم TLS (421)، ويحدّ حجم الطلب بـ 3MB.
  - سجلاته بلا كوكيز أو رموز CSRF أو query.
- **خدمة backup:**
  - تنفّذ `backup:run` في مواعيد محددة.
  - هي وحدها تملك مفتاح النسخ وبيانات التخزين الخارجي؛ خدمة التطبيق لا تراها.
- **خدمة cli:** أوامر التشغيل، بلا شبكة إطلاقًا.

### متطلبات الخادم
- Linux x86_64 بقرص محلي دائم (SSD)، وDocker Engine حديث مع Compose v2.
- اسم نطاق يشير إلى الخادم (A و/أو AAAA)، والمنفذان 80 و443 مفتوحان من الإنترنت (لإصدار الشهادة وتجديدها).
- مقترح ابتدائي (ليس قياسًا لسعة التجار): 2 vCPU، و2–4GB ذاكرة، ومساحة قرص تكفي ضعف حجم القاعدة + النسخ المحلية (14 نسخة افتراضيًا).
- ساعة النظام متزامنة (NTP)، لأن رموز التحقق TOTP تعتمد على الوقت.

### إعداد DNS
| السجل | القيمة |
|---|---|
| `A portal.example.com` | عنوان IPv4 العام للخادم |
| `AAAA portal.example.com` | عنوان IPv6 (إن وُجد ومفتوح) |
| (اختياري) `CAA example.com` | `0 issue "letsencrypt.org"` |

لا تُستخدم `includeSubDomains` ولا preload في HSTS: النطاقات الفرعية الأخرى ليست جزءًا من هذا النظام.

---

## 2. الأسرار وحفظها

| السر | الملف | من يقرؤه | ملاحظات |
|---|---|---|---|
| APP_SECRET | `deploy/secrets/app_secret` | app، backup، cli | 32 بايت عشوائية base64url. **لا يُدوَّر.** ضياعه = إعادة تسجيل المُصادِقات (الحالة هـ). |
| مفتاح النسخ | `deploy/secrets/backup.key` | backup فقط | لا يُركَّب في app. ضياعه = النسخ المشفرة به غير قابلة للاستعادة. |
| بيانات التخزين الخارجي | `deploy/secrets/offsite_access_key`، `offsite_secret_key` | backup فقط | صلاحية «كتابة وقراءة» على البادئة فقط، ويُفضَّل بلا حذف. |

- كل ملف: **المالك uid 1000**، والصلاحية **0400**. يرفض التطبيق الملفات المقروءة للآخرين أو القابلة للكتابة، ويرفض
  ضبط `APP_SECRET` و`APP_SECRET_FILE` معًا.
- **لا تُوضع الأسرار** في الصورة أو المستودع أو `.env` أو سطر الأوامر.
- **احفظ نسخة خارج الخادم** من `app_secret` ومن `backup.key`، **كلٌّ في مكان مختلف**، وليس مع ملفات النسخ في التخزين
  الخارجي نفسه وبالصلاحيات نفسها.
- **لا تُستخدم أسرار بيئة الاختبار أو حساباتها في الإنتاج أبدًا.** أنشئ كل شيء من جديد للإنتاج.

إنشاء الأسرار (على الخادم):
```sh
cd alkhayr-b2b/deploy
install -d -m 0700 -o 1000 -g 1000 secrets
umask 077
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' > secrets/app_secret
: > secrets/offsite_access_key; : > secrets/offsite_secret_key      # فارغة حتى يُعدّ التخزين الخارجي
chown 1000:1000 secrets/*; chmod 0400 secrets/*                    # قبل أي أمر في الحاويات
docker compose --env-file .env run --rm -v "$PWD/secrets:/k" cli backup:keygen --out /k/backup.key
chmod 0400 secrets/backup.key
```

---

## 3. أول نشر (بالترتيب، والخادم متوقف)

```sh
docker build -t alkhayr-b2b:17.0.0 .                      # من مجلد alkhayr-b2b
cd deploy && cp env.example .env && nano .env              # PUBLIC_HOST, ACME_EMAIL, ALKHAYR_VERSION=17.0.0
docker compose --env-file .env config --quiet              # التحقق من الإعداد
docker compose --env-file .env run --rm cli db:init        # مرة واحدة فقط
docker compose --env-file .env run --rm -it cli setup-admin   # المدير الأول (طرفية تفاعلية)
docker compose --env-file .env up -d app proxy backup
```
- **قبل** `db:init` يرفض التطبيق البدء (`DATABASE_MISSING`)، فلا تُفتح خدمة غير مُعدّة.
- لا يُنشئ التطبيق القاعدة ولا يُرحّلها تلقائيًا أبدًا.
- **بيئة اختبار محلية فقط:** `TLS_MODE=internal` مع جهة Caddy المحلية (`staging.alkhayr.test`).

مدير إضافي، وإعادة تعيين كلمة مرور أو مُصادِق، وإنهاء الجلسات (الخادم متوقف):
```sh
docker compose --env-file .env stop app
docker compose --env-file .env run --rm -it cli admin:create              # أو account:reset-password / account:reset-mfa / account:revoke-sessions
docker compose --env-file .env start app
```

## 4. الحالة والسجلات
```sh
docker compose --env-file .env ps
docker compose --env-file .env logs --tail 200 app        # JSON بلا كلمات مرور أو رموز أو كوكيز أو محتوى CSV
docker compose --env-file .env run --rm cli db:status
docker compose --env-file .env run --rm cli db:check       # فحص الاتساق (قراءة فقط)
docker compose --env-file .env run --rm cli recovery:status
docker compose --env-file .env run --rm cli ops:status     # JSON؛ 0 سليم، 3 تحذير، 1 حرِج
```
- السجلات: `json-file` بحد 10MB × 5 ملفات لكل خدمة.
- `/healthz` = العملية حية. `/readyz` = جاهزة، مع `writes: open|closed`.
- **وضع الاستعادة أو التوقف بسبب عدم الاتساق لا يعني إعادة تشغيل الحاوية.** فحص الصحة في الحاوية يراقب الحياة فقط،
  فلا توجد حلقة إعادة تشغيل.

---

## 5. النسخ الاحتياطي والنسخ الخارجي
- `backup` تشغّل `backup:run` يوميًا في `BACKUP_SCHEDULE` (مثل `02:17`) بتوقيت `BACKUP_TZ` (افتراضيًا Africa/Cairo).
  **هذا جدول مؤقت مقترح، وليس هدفًا معتمدًا من الإدارة (B-4).**
- **كل تشغيل:**
  - قفل يمنع التداخل؛
  - النسخة المشفرة نفسها والتحقق منها (لا صيغة ثانية، ولا نسخ ملف القاعدة الحي)؛
  - تدوير يحتفظ بآخر `BACKUP_KEEP` نسخة، وبآخر نسخة متحقَّق منها دائمًا؛
  - ثم النسخ الخارجي إن أُعدّ.
- **التحقق من النسخة الخارجية** يتطلب كل ما يلي، ولا يكفي رد «تم الرفع» وحده:
  - رفعها، ثم مطابقة الحجم والـ checksum؛
  - تنزيلها إلى ملف مؤقت محمي ومطابقة SHA-256؛
  - فك تشفيرها وفحص الاتساق الكامل.
- **محاولات محدودة:** `BACKUP_RETRIES` (افتراضيًا 2) للأعطال المؤقتة فقط.
- **الحالة:** `/backups/status/backup-job.json`، وتظهر في `ops:status`.
- نسخة يدوية فورية:
  ```sh
  docker compose --env-file .env run --rm --entrypoint /nodejs/bin/node backup dist/server/cli.js backup:run
  ```

### إعداد التخزين الخارجي (S3 أو متوافق معه) — B-2 ما زال مفتوحًا
اضبط في `.env`، مع ملفي بيانات الاعتماد:
- `OFFSITE_S3_ENDPOINT` (https فقط)، و`OFFSITE_S3_REGION`، و`OFFSITE_S3_BUCKET`، و`OFFSITE_S3_PREFIX` (ينتهي بـ `/`)؛
- `OFFSITE_S3_PATH_STYLE`؛
- `OFFSITE_S3_ACCESS_KEY_FILE=/run/secrets/offsite_access_key` و`OFFSITE_S3_SECRET_KEY_FILE=/run/secrets/offsite_secret_key`.

- **المطلوب من صاحب العمل:** مزوّد وحساب، واسم bucket في منطقة جغرافية مختلفة عن الخادم، ومفاتيح بصلاحية محدودة
  على البادئة. يُفضَّل تفعيل versioning وObject Lock، وسياسة احتفاظ (lifecycle).
- **لم يُختبر:** versioning، وObject Lock، ومنع الحذف. **لا تَعِد بها قبل إعدادها واختبارها.**
- النظام لا يحذف شيئًا من التخزين الخارجي؛ الاحتفاظ هناك تحدده سياسة المزوّد.

---

## 6. الاستعادة (خادم بديل أو مجلد بيانات منفصل)
لا تُستعاد فوق القاعدة الوحيدة الحية. اعمل على مشروع Compose منفصل أو volume جديد.
```sh
# 1) تنزيل النسخة من التخزين الخارجي (عند فقد الخادم)
docker compose --env-file .env run --rm --entrypoint /nodejs/bin/node backup dist/server/cli.js backup:offsite-get alkhayr-YYYYMMDD-HHMMSS-xxxxxxxx.akbk
# 2) التحقق ثم الاستعادة (الخادم متوقف)
docker compose --env-file .env run --rm -v "$PWD/secrets/backup.key:/k/backup.key:ro" cli backup:verify  /backups/<الملف> --key-file /k/backup.key
docker compose --env-file .env run --rm -v "$PWD/secrets/backup.key:/k/backup.key:ro" cli backup:restore /backups/<الملف> --key-file /k/backup.key
# 3) تشغيل في وضع الاستعادة، ثم المصالحة، ثم إعادة الفتح
docker compose --env-file .env up -d app proxy
docker compose --env-file .env run --rm -it cli recovery:reopen
```
التفاصيل وحالات الفقد (أ–و) في [`BACKUP_RECOVERY_AR.md`](BACKUP_RECOVERY_AR.md).

---

## 7. الترقية والرجوع

**الترقية:**
```sh
docker build -t alkhayr-b2b:<الإصدار-الجديد> .           # ثم تحقق: docker image inspect، وTrivy إن توفر
docker compose --env-file .env run --rm --entrypoint /nodejs/bin/node backup dist/server/cli.js backup:run   # نسخة متحقَّق منها
docker compose --env-file .env stop backup app       # backup أولًا ثم التطبيق
sed -i 's/^ALKHAYR_VERSION=.*/ALKHAYR_VERSION=<الإصدار-الجديد>/' .env
docker compose --env-file .env run --rm cli db:migrate --confirm-backup   # إن وُجدت ترحيلات (صريح، والخادم متوقف)
docker compose --env-file .env up -d app backup
docker compose --env-file .env run --rm cli db:check
```
ثم: `/readyz`، ودخول مدير، ودخول تاجر وعرض طلباته.

**التوقف أثناء الترقية:** لا يوجد «بلا توقف». القيمة المقاسة في التمرين المحلي في قسم 10.

**الرجوع:**
- **بلا ترحيل:** أعد `ALKHAYR_VERSION` السابق، ثم `up -d app`.
- **بعد ترحيل:**
  - الإصدار القديم يرفض القاعدة الأحدث (`SCHEMA_TOO_NEW`). الرجوع يعني استعادة نسخة ما قبل الترحيل،
    و**يفقد كل ما كُتب بعدها**.
  - لا تفعل ذلك تلقائيًا، ولا بعد أن استأنف المستخدمون العمل.
- **لا تحذف volume أبدًا لـ«إصلاح» النشر.** واحتفظ بـ APP_SECRET كما هو.

---

## 8. المراقبة
شغّل `ops:status` كل 5–15 دقيقة من أداة مراقبة على الخادم.
- **ما يقيسه:**
  - وضع الكتابة / الاستعادة، والاتساق؛
  - عمر آخر نسخة متحقَّق منها، وعمر آخر نسخة خارجية متحقَّق منها؛
  - فشل المهمة المجدولة، والمساحة الحرة، والملفات المؤقتة غير المشفرة المتروكة؛
  - محاولات الدخول الفاشلة في الساعة.
- **شهادة TLS:** من مضيف له وصول للشبكة:
  ```sh
  echo | openssl s_client -connect portal.example.com:443 -servername portal.example.com 2>/dev/null | openssl x509 -noout -enddate
  ```
- **أحداث للتنبيه في السجلات:**
  - `consistency_failed`، `recovery_mode`، `write_refused`؛
  - `capacity_exceeded`، `rate_limited` (بأعداد كبيرة)؛
  - `backup_job_failed`، `abandoned_staging_removed`؛
  - `connection_refused` (اتصال تجاوز الـ proxy).
- **لم يُعَدّ أي قناة تنبيه** (بريد أو رسائل). اربط مخرجات `ops:status` بالقناة التي تعتمدها الإدارة واختبرها بنفسك.

---

## 9. الحوادث (مختصر)

**القرص ممتلئ**
- يفشل النسخ بـ `DISK_FULL` دون ترك ملفات.
- حرّر مساحة: النسخ الأقدم بـ `backup:prune --keep N` بعد التأكد من نسخة خارجية، وسجلات Docker.
- لا تحذف volume البيانات.

**فشل الترحيل**
- الترحيل داخل معاملة. لا تشغّل الخادم.
- احتفظ بالرسالة، وأعد المحاولة بعد الإصلاح، أو استعد نسخة ما قبل الترحيل (ما لم تُكتب بيانات بعدها).

**فشل الشهادة**
- تحقق من DNS والمنفذين 80/443، ومن `docker compose logs proxy`، ومن حدود Let's Encrypt.
- لا تعطّل TLS، ولا تضع `http` بدلًا من `https` في `APP_ORIGIN`.

**تعذّر الوصول للتخزين الخارجي**
- تبقى النسخ المحلية متحقَّقًا منها، و`ops:status` يحذّر.
- أصلح الوصول وشغّل `backup:run` يدويًا وتحقق من `offsite_copy`.

**اختراق حساب مدير**
- `account:revoke-sessions`، ثم `account:reset-password` و`account:reset-mfa` (الخادم متوقف)، ثم راجع سجل التدقيق.

**فشل فحص الاتساق عند البدء**
- يعمل الموقع للقراءة فقط.
- شغّل `db:check` للتفاصيل. لا تعدّل التاريخ يدويًا. استعد نسخة متحقَّقًا منها عند الحاجة. لا يوجد إصلاح تلقائي.

---

## 10. نتائج التمارين المحلية (بيانات اصطناعية، جهاز التطوير)
**بيئة القياس:** 4 vCPU (Intel Xeon 2.1GHz)، و16GB، وتخزين overlay داخل حاوية على جهاز تطوير. ليست بيئة إنتاج.

**تمرين الاستعادة** — قاعدة 61MB (2000 منتج، و20000 طلب بـ 60000 سطر، و5000 طلب مشحون)، ونسخة مشفرة 61MB:

| الخطوة | الزمن |
|---|---|
| مهمة النسخ (نسخ، تحقق، تشفير، رفع إلى خادم S3 محلي للاختبار، تنزيل، فك، فحص) | 7.1 ث |
| تنزيل النسخة | 1.1 ث |
| التحقق | 2.0 ث |
| الاستعادة | 1.8 ث |
| التشغيل حتى الخدمة للقراءة في وضع الاستعادة | 1.4 ث |
| الإجمالي حتى الخدمة | 6.3 ث |
| الإجمالي مع إعادة الفتح بالأمر | 9.1 ث |

لا يشمل ذلك وقت المصالحة البشرية، ولا تجهيز خادم جديد، ولا DNS/TLS، ولا استرجاع الأسرار من الحفظ الخارجي.
**ليس RTO للإنتاج.**

**تمرين الترقية** (17.0.0-rc7 إلى rc8، بالبيانات نفسها):
- من إيقاف التطبيق إلى جاهزية الإصدار الجديد: **1.9 ث**، وفحص صحة واحد فشل (502).
- قبل إصلاح المجدول كان إيقاف خدمة backup يستغرق 14–40 ث؛ أُصلح، وصار 0.27 ث.

**حمل اصطناعي:**
- 50 تاجرًا افتراضيًا لمدة 60 ث على نسخة من البيانات نفسها، بحدود 2 CPU و1GB.
- نحو 177 طلب/ث، وp95 من 10 إلى 12 ms، وأعلى CPU نحو 195%، وأعلى ذاكرة 227MB.
- **ليس وعدًا بعدد تجار.**

**قائمة فحص النشر** (من مراجعة المرحلة 16 §8):

| البند | النتيجة |
|---|---|
| HTTPS، وHSTS، وكوكيز `__Host-` (Secure وHttpOnly وSameSite=Strict وPath=/ وبلا Domain)، وتحويل HTTP | **PASS** محليًا (جهة Caddy المحلية). الشهادة العامة **NOT RUN** |
| TRUST_PROXY مضبوط على عنوان الـ proxy فقط، ولا وصول مباشر لمنفذ التطبيق، وX-Forwarded-For المزوّر يُتجاهل | **PASS** محليًا |
| حدود الجسم والمهل، وعدم تخزين ردود API مؤقتًا | **PASS** محليًا |
| `/readyz` و`/healthz` لا تكشفان تفاصيل | **PASS** |
| المراقبة: الأحداث وأمر `ops:status` | جاهزة. قناة التنبيه **NOT RUN** |
| الصلاحيات بمستخدم غير root | **PASS** (uid 1000؛ كل حالات الرفض برموز واضحة) |
| تمرين استعادة على حجم إنتاجي ونسخة خارجية حقيقية | **NOT RUN** (بيانات اصطناعية وخادم S3 محلي فقط) |

## 11. المسؤوليات والصيانة الدورية

| المهمة | المسؤول | الدورية |
|---|---|---|
| مراجعة `ops:status` والتنبيهات | المشغّل | يوميًا |
| التحقق من نسخة خارجية بالتنزيل (تلقائي) ومراجعة الحالة | المشغّل | يوميًا |
| تمرين استعادة كامل على مشروع منفصل | المشغّل + صاحب العمل | شهريًا |
| تحديث الصورة (إصدار Node/Caddy الأمني، وإعادة الفحص) | المشغّل | شهريًا أو عند إعلان أمني |
| تجديد الشهادة | Caddy تلقائيًا، والمشغّل يراقب | تلقائي / متابعة أسبوعية |
| مراجعة سجل التدقيق والحسابات الإدارية | صاحب العمل | شهريًا |
| قرارات B-1 وB-4 وB-5 | صاحب العمل | قبل الإطلاق |
