# إصلاح ذمم فواتير المبيعات التاريخية

الأداة آمنة افتراضياً وتعمل بوضع **Dry Run** من دون تعديل أي سجل:

```powershell
pnpm run repair:customer-receivables -- --all
```

الفلاتر المدعومة:

```powershell
pnpm run repair:customer-receivables -- --from=2026-01-01 --to=2026-06-30
pnpm run repair:customer-receivables -- --customer=20
pnpm run repair:customer-receivables -- --invoice=94
pnpm run repair:customer-receivables -- --limit=500
pnpm run repair:customer-receivables -- --all --output=receivables-dry-run.json
```

قبل التنفيذ الفعلي يجب تطبيق migration الإضافي:

`lib/db/migrations/0063_historical_customer_receivables.sql`

ثم ينفذ مدير مخوّل الأمر التالي بعد مراجعة تقرير Dry Run:

```powershell
pnpm run repair:customer-receivables -- --all --execute --confirm=REPAIR-CUSTOMER-RECEIVABLES --actor-id=1 --actor-name="مدير النظام"
```

لا تنشئ الأداة حركة صندوق أو إيراداً جديداً. كل فاتورة تعالج داخل transaction مستقلة، ويمنع المفتاح
`sales-invoice-ledger:{invoiceId}` والفهرس الفريد تكرار الذمة عند إعادة التشغيل.

الفواتير ذات العميل المفقود أو المطابقة المتعددة أو الدفعات غير القابلة للربط أو القيود المكررة تبقى في
قائمة المراجعة اليدوية ولا تُرحّل تلقائياً.

