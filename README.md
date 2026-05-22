# AJN Platform

منصة عربية RTL لمجموعة علي جان: واجهة خدمات ومتجر، سلة وطلبات، تتبع، لوحة إدارة، حسابات، واتساب، وحسابات مالية.

## التشغيل السريع

1. ثبت الحزم:

```bash
pnpm install
```

2. انسخ ملف البيئة وعدل القيم:

```bash
cp .env.example .env
```

3. جهز قاعدة البيانات:

```bash
pnpm run db:push
pnpm run db:seed
```

4. شغل الـ API والواجهة:

```bash
pnpm run dev
```

الواجهة الافتراضية: `http://localhost:20796`  
الـ API الافتراضي: `http://localhost:8080/api/healthz`

## أوامر مهمة

```bash
pnpm run typecheck
pnpm run build
pnpm run codegen
pnpm run audit
```

## متغيرات البيئة

راجع `.env.example`. أهم القيم المطلوبة:

- `DATABASE_URL`: رابط PostgreSQL.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`: حساب المدير الأول.
- `PUBLIC_BASE_URL`: رابط الموقع المستخدم في رسائل واتساب.
- `ULTRAMSG_*` أو `WASSENGER_*` أو `TWILIO_*` أو `META_WA_*`: مزود واتساب.

## ملاحظات نشر

- لا ترفع `node_modules`, `.cache`, `.local`, `dist`, `.git`, أو ملفات البيئة.
- بعد تغيير `lib/api-spec/openapi.yaml` شغل `pnpm run codegen`.
- بعد تغيير جداول Drizzle شغل `pnpm run db:push` ثم `pnpm run typecheck`.
- في الإنتاج لا تعتمد على كلمة مرور افتراضية، اضبط `ADMIN_PASSWORD` قبل أول تشغيل.
