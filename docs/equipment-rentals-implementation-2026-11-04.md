# تقرير إدارة إيجارات المعدات — AJN

حالة التنفيذ قبل طلب النشر: 2026/11/04. كان العمل محلياً على الفرع `codex/equipment-rentals-booking-center`، دون commit أو push أو نشر. لم تُعدل بيانات أو قاعدة الإنتاج أثناء التنفيذ والاختبارات. طلب صاحب المشروع الرفع والنشر لاحقاً؛ حالة النشر والترقية تُراجع من سجل الإصدار وGitHub/Vercel.

## 1. الوظائف المنفذة

- إيجارات المعدات داخل مركز الحجوزات، مع قائمة بحث وفلاتر وترقيم صفحات وخمس بطاقات فعلية: النشطة، بانتظار التسليم، إرجاعات اليوم، المتأخرة، والمتبقي.
- اختيار العميل الحالي أو إنشاء سجل عند عدم وجود هاتفه؛ إعادة استخدام دليل العملاء ومنع تكراره برقم الهاتف.
- اختيار الأصول الحالية وصورها ومخزن المصدر وكمياتها وأسعارها: ثابت، يومي، بالساعة، أو مخصص عندما تسمح إعدادات الأصل والصلاحية. حساب واحد مشترك للسطر والإجمالي.
- مسودات وتعديلها وإرسال للاعتماد وتأكيد وحجز وإلغاء آمن. أرقام `RNT-YYYY-NNNNNN` متزامنة وآمنة، وطلبات قابلة لإعادة المحاولة دون تكرار الحركة.
- مساحة أصلية لكل إيجار: التفاصيل، المعدات، التسليم والإرجاع، الحسابات، المرفقات، السجل. إجراءات سريعة من القائمة ومن داخل المساحة.
- تسليم جزئي ومتعدد الدفعات؛ إرجاع جيد/تالف/مفقود/معلق للفحص؛ متابعة ما لدى العميل، والتأخر حسب الموعد الفعلي. لا تُتاح الكمية التالفة أو غير المفحوصة.
- مسؤولية الموظف وصلاحية إسناد موظف آخر، وصلاحية نقل الإرجاع إلى مخزن مختلف، واعتماد الفقدان، وسجل العمليات.
- ربط الإيجار بحجز مناسبة أصلي، وعرض الإيجارات المرتبطة داخل مساحة الحجز وملف العميل. رفض حجز نفس الأصل مرة ثانية عندما يحتجزه الحجز المرتبط.
- دفعات واسترداد وتأمين مسترد وتطبيق التأمين على الرصيد ورسوم تحتاج اعتماداً، عبر صندوق وموافقات AJN الحالية.
- عقود A4 ووصل 80mm وكشف الحساب؛ إعادة الطباعة لا تنشئ فاتورة أو حركة مالية أخرى. واتساب يفتح رسالة للمراجعة والإرسال اليدوي.
- تقارير العقود والمعدات والمخازن والإيراد والتحصيل والتأمين والمتبقي، والتكاليف المباشرة من مصروف أصلي مربوط. المساهمة المباشرة لا تُعرض كصافي ربح محاسبي.
- واجهة RTL باستخدام مكونات AJN، وبطاقات وأزرار مدمجة وفلاتر التاريخ الحالية، مع تحقق بصري على الجوال والتابلت والكمبيوتر.

## 2. المسارات والربط بمركز الحجوزات

| الاستخدام | المسار |
|---|---|
| قائمة الإيجارات | `/admin/bookings/rentals` |
| إيجار جديد | `/admin/bookings/rentals/new` |
| مساحة الإيجار الأصلية | `/admin/bookings/rentals/[id]` |
| التسليم والإرجاع | `/admin/bookings/rentals/returns` |
| المتأخرة | `/admin/bookings/rentals/overdue` |
| التقارير | `/admin/bookings/rentals/reports` |

الروابط تابعة لمركز الحجوزات في التنقل الحالي، وليست وحدة جانبية مستقلة. هذه المسارات في الكود المحلي؛ لم تُنشر إلى الموقع الحي.

## 3. إعادة استخدام الأنظمة الحالية

- أصل العقد هو `rental_orders` الموجود. سطور المعدات والفترة وأدلة التشغيل محفوظة على العقد نفسه.
- الأصول والعملاء والموظفون والمخازن والمستندات والسجل هي سجلات AJN الحالية.
- محركات الكمية والعهدة وحركة المخزون والتخصيص بين المخازن هي المحركات الأصلية، مع إضافة مرجع الإيجار إلى قراءاتها.
- التقويم الحالي يعرض موعدي التسليم والإرجاع بنفس مرجع الإيجار. عداد الإيجارات مستقل عن عدد المناسبات، ولا يحسب الموعدين كعقدين.
- المالية تستخدم `financial_transactions` والموافقات والصندوق والقيود وسندات القبض وكشف العميل ومحرك مصالحة الدفع الحالي.

## 4. قاعدة البيانات

ملف واحد: `lib/db/migrations/0134_equipment_rentals.sql`.

| الإضافة | الغرض |
|---|---|
| `products.rental_settings` | إعدادات الأصل الحالي |
| `rental_orders.rental_kind` و`equipment_details` | تمييز عقد المعدات وتفاصيله، مع بقاء العقود القديمة |
| `expenses.rental_order_id` اختياري | ربط مصروف أصلي دون إنشاء مصروف آخر |
| فهارس وsequence | البحث والترقيم وحماية إعادة الطلب |
| الحساب `ER-DEPOSIT` | التزام التأمين المسترد |

الترقية إضافية ومتوافقة مع السجلات السابقة. نُفذت وتحققت في قاعدة اختبار محلية منفصلة فقط؛ لم تُطبق على الإنتاج. لا يوجد حذف أو إعادة كتابة لقيم تاريخية.

## 5. المخزون والمخازن والمالية

- تحقق الخادم من كامل الفترة والمخزن، مع أقفال على العقد والأصول ومعاملات ذرية. اختُبر منع تأكيدين متزامنين يتجاوزان المتاح.
- حجوزات المناسبات والإيجارات ترى الحجوزات المتبادلة، ولا تحجز المسودة المعدات.
- التسليم ينقل الكمية إلى العهدة؛ الإرجاع يذهب إلى المخزن المعتمد. الفحص والتلف يحتفظان بالكمية خارج المتاح. الأصول الفردية تستخدم سجل العهدة الأصلي.
- لا تتحرك أموال الصندوق من حفظ المسودة أو طلب الدفع. التنفيذ يتبع موافقة المدير الحالية.
- التأمين التزام مستقل، وتطبيقه على الإيجار تسوية غير نقدية. لا يخصم من المتبقي إلا بعد اعتماد التطبيق.
- الدفعات الرسمية والمعلق والرصيد مشتقة من نفس مصادر المصالحة. لا يجوز استرداد دفعة سند قبض مرة أخرى عبر حركة إيجار؛ تسترد من سندها الأصلي.
- ربط المصروف لا ينشئ حركة ثانية؛ التقرير يقرأ المصروف المعتمد نفسه. ويشمل التحصيل تخصيصات سندات القبض وعكسها مرة واحدة.

## 6. الاختبارات والنتائج

| الفحص | النتيجة |
|---|---|
| `pnpm run verify:critical --strict` | PASS — 82 مرحلة، نفس المشغّل الصارم لـ `verify:strict` |
| TypeScript | PASS ضمن البوابة |
| `pnpm run build` | PASS ضمن البوابة |
| `test:payment-state` | PASS ضمن البوابة |
| `test:save-smoke` | PASS — المراحل الثلاث على قاعدة اختبار منفصلة |
| اختبارات الحجوزات والتقويم والكمية والمخازن والعهدة والمالية الحالية | PASS ضمن البوابة |
| `test:equipment-rentals` | PASS — التسعير، الصلاحيات، التأمين، الحجز والطباعة |
| `test:equipment-rentals-db` | PASS — المحركات الأصلية على PostgreSQL وقواعد مؤقتة مملوكة للاختبار |
| `test:equipment-rentals-browser` | PASS — 390/768/1440px، RTL، عدم تجاوز عرض الصفحة، التسليم والإرجاع والدفعة المعلقة |
| `git diff --check` | PASS |
| lint | SKIPPED — لا يوجد أمر lint مهيأ في المشروع |

اختبار PostgreSQL يغطي المسودة وتعديلها وإعادة الطلب، تعارض المناسبات والإيجارات في الاتجاهين، المخزنين، التزامن، التسليم والإرجاع الجزئي، الفحص والتلف والفقدان المعتمد، الموافقات والصندوق، التأمين وتسويته وعكسه، سند القبض وعكسه، هوية العميل، التكاليف المباشرة، السجلات السابقة، والتقارير وتطابق الصندوق. أخطاء 403/409 المسجلة في الاختبار هي حالات رفض متوقعة يجري التأكد منها.

قاعدة التحقق: PostgreSQL محلي على loopback، باسم اختبار منفصل. شروط الكتابة: `AJN_ENV=test` و`ALLOW_TEST_WRITES=true` و`TEST_DATABASE_URL`؛ لا يوجد رجوع إلى اتصال الإنتاج.

## 7. حدود التحقق والتشغيل

- النشر وترقية قاعدة الإنتاج غير منفذين بطلبك. الكود متروك دون commit أو push.
- الإيجارات القديمة للمنتج الفردي تبقى بسجلاتها وإجراءاتها السابقة، ولا تُحوّل تلقائياً إلى عقود معدات متعددة.
- المرفقات تستخدم مركز المستندات الحالي وروابطه المحمية؛ لم يُنشأ bucket أو نظام رفع آخر. لم تجر تجربة كتابة على Supabase الإنتاج.
- الاختبار البصري يشغّل مكونات AJN الأصلية مع HTTP اصطناعي؛ اختبارات الخادم تنفذ المحركات الأصلية على PostgreSQL منفصل. لم تجر تجربة تشغيل على بيانات حية أو طابعة فعلية.
- اختيار الأصل يقبل الباركود الحالي في البحث. لم تُضف شاشة تصوير بالكاميرا للمسح؛ ميزات المسح الحالية تبقى في واجهات AJN الأصلية.
- مراجعة الكود أعطت ملاحظات مالية وتشغيلية عولجت باختبارات. تعذر إكمال جلسة المراجع المستقل بسبب سعة الخدمة، لذلك لا تُعرض كموافقة مستقلة نهائية.

## 8. الملفات المتغيرة

- [docs/equipment-rentals-implementation-2026-11-04.md](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/docs/equipment-rentals-implementation-2026-11-04.md>)
- [docs/superpowers/plans/2026-11-03-equipment-rentals.md](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/docs/superpowers/plans/2026-11-03-equipment-rentals.md>)
- [lib/db/migrations/0134_equipment_rentals.sql](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/lib/db/migrations/0134_equipment_rentals.sql>)
- [lib/db/src/schema/accounting.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/lib/db/src/schema/accounting.ts>)
- [lib/db/src/schema/products.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/lib/db/src/schema/products.ts>)
- [package.json](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/package.json>)
- [scripts/lib/equipment-rental-financial-guard-test.mjs](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/lib/equipment-rental-financial-guard-test.mjs>)
- [scripts/run-critical-verification.mjs](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/run-critical-verification.mjs>)
- [scripts/test-booking-calendar-integration.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-booking-calendar-integration.ts>)
- [scripts/test-booking-calendar-logic.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-booking-calendar-logic.ts>)
- [scripts/test-equipment-rental-finance.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-equipment-rental-finance.ts>)
- [scripts/test-equipment-rental-inventory.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-equipment-rental-inventory.ts>)
- [scripts/test-equipment-rental-print.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-equipment-rental-print.ts>)
- [scripts/test-equipment-rentals-browser.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-equipment-rentals-browser.ts>)
- [scripts/test-equipment-rentals-integration.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-equipment-rentals-integration.ts>)
- [scripts/test-equipment-rentals.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-equipment-rentals.ts>)
- [scripts/test-graduation-approval-fresh.mjs](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-graduation-approval-fresh.mjs>)
- [scripts/test-graduation-financial-cancel-race.mjs](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-graduation-financial-cancel-race.mjs>)
- [scripts/test-source-financial-executor.mjs](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-source-financial-executor.mjs>)
- [scripts/test-vehicle-partnership-approval-admission.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-vehicle-partnership-approval-admission.ts>)
- [scripts/test-vehicle-partnership-cash-reversal-master.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-vehicle-partnership-cash-reversal-master.ts>)
- [scripts/test-vehicle-partnership-distribution-cash.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-vehicle-partnership-distribution-cash.ts>)
- [scripts/test-vehicle-partnership-financial-ingress.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-vehicle-partnership-financial-ingress.ts>)
- [scripts/test-vehicle-partnership-lifecycle-admission.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-vehicle-partnership-lifecycle-admission.ts>)
- [scripts/test-vehicle-partnership-report-classification.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-vehicle-partnership-report-classification.ts>)
- [src/components/equipment-rental-panels.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/components/equipment-rental-panels.tsx>)
- [src/lib/booking-calendar.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/lib/booking-calendar.ts>)
- [src/lib/booking-resource-conflicts.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/lib/booking-resource-conflicts.ts>)
- [src/lib/equipment-rental-finance.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/lib/equipment-rental-finance.ts>)
- [src/lib/equipment-rentals.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/lib/equipment-rentals.ts>)
- [src/lib/financial-transaction-totals.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/lib/financial-transaction-totals.ts>)
- [src/lib/quantity-asset-period.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/lib/quantity-asset-period.ts>)
- [src/lib/quantity-assets.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/lib/quantity-assets.ts>)
- [src/server/api.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/api.ts>)
- [src/server/booking-calendar.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/booking-calendar.ts>)
- [src/server/booking-resource-availability.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/booking-resource-availability.ts>)
- [src/server/booking-resource-period.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/booking-resource-period.ts>)
- [src/server/customer-account-summary.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/customer-account-summary.ts>)
- [src/server/customer-account.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/customer-account.ts>)
- [src/server/daily-cash.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/daily-cash.ts>)
- [src/server/employee-performance.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/employee-performance.ts>)
- [src/server/equipment-rental-classification.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/equipment-rental-classification.ts>)
- [src/server/equipment-rental-finance.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/equipment-rental-finance.ts>)
- [src/server/equipment-rental-inventory.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/equipment-rental-inventory.ts>)
- [src/server/equipment-rentals.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/equipment-rentals.ts>)
- [src/server/event-brain.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/event-brain.ts>)
- [src/server/hr-intelligence.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/hr-intelligence.ts>)
- [src/server/integration-health.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/integration-health.ts>)
- [src/server/master-cash-box.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/master-cash-box.ts>)
- [src/server/payment-state.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/payment-state.ts>)
- [src/server/quantity-assets.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/server/quantity-assets.ts>)
- [src/views/admin/_layout.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/_layout.tsx>)
- [src/views/admin/_lib.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/_lib.ts>)
- [src/views/admin/asset-new.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/asset-new.tsx>)
- [src/views/admin/booking-center.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/booking-center.tsx>)
- [src/views/admin/booking-operations-workspace.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/booking-operations-workspace.tsx>)
- [src/views/admin/calendar.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/calendar.tsx>)
- [src/views/admin/customers.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/customers.tsx>)
- [src/views/admin/equipment-rental-print.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/equipment-rental-print.ts>)
- [src/views/admin/equipment-rentals.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/equipment-rentals.tsx>)
- [src/views/admin/index.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/index.tsx>)
- [src/views/admin/master-cash.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/master-cash.tsx>)
- [src/views/admin/products.tsx](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/src/views/admin/products.tsx>)

- [scripts/test-customer-followup-booking-browser.ts](<C:/Users/ALIJAN/.codex/worktrees/booking-photo-access/yoalnd-tuz-main/scripts/test-customer-followup-booking-browser.ts>)

ملاحظة دمج الإصدار: أُبقيت إضافة متابعة العملاء المنشورة أثناء تجهيز الإصدار. اختُبر فتح الحجز عبر تغيير الاستعلام في نفس الصفحة مرتين، مع إبقاء أولوية المتابعة وحماية العميل والحجز الموجود.
