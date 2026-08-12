import {
  fileToDataUrl,
  processImageFile,
  type ImageProcessOptions,
} from "@/lib/image-tools";
import { queryClient } from "@/lib/query-client";
export { formatCurrency, formatMoney } from "@/lib/money";

// ───── Cookie-based admin auth client ─────
export const ALL_PERMISSIONS = [
  "dashboard",
  "orders",
  "bookings",
  "booking_operations_view",
  "booking_edit",
  "booking_status_change",
  "booking_products_manage",
  "inventory_shortage_override",
  "booking_assets_manage",
  "asset_reserve",
  "asset_release",
  "warehouse_issue",
  "booking_return_confirm",
  "asset_damage_record",
  "asset_damage_approve",
  "asset.sell",
  "asset.view_sales",
  "asset.print_sales",
  "asset.export_sales",
  "custody_groups_view",
  "custody_groups_create",
  "custody_groups_edit",
  "custody_groups_assign_employee",
  "custody_groups_manage_assets",
  "custody_groups_reserve",
  "custody_groups_checkout",
  "custody_groups_return",
  "custody_groups_damage_report",
  "custody_groups_history_view",
  "depreciation_view",
  "depreciation_usage_edit",
  "depreciation_print_a4",
  "depreciation_print_80mm",
  "depreciation_export_pdf",
  "booking_finance_view",
  "booking_payment_receive",
  "booking_finance_approve",
  "booking_payment_reverse",
  "booking_tasks_manage",
  "booking_documents_manage",
  "booking_close",
  "booking_cancel",
  "services",
  "products",
  "asset_depreciation_remove",
  "depreciation_categories_view",
  "depreciation_categories_create",
  "depreciation_categories_edit",
  "depreciation_categories_archive",
  "depreciation_categories_apply",
  "depreciation_categories_audit_view",
  "gallery",
  "delivery",
  "customers",
  "staff",
  "salary_settings_view",
  "salary_settings_edit",
  "salary_settings_approve",
  "settings",
  "invoices",
  "print.sales_invoice",
  "print.reprint",
  "print.queue.view",
  "print.queue.manage",
  "print.printers.manage",
  "print.agents.manage",
  "sales_invoice.cancel",
  "sales_invoice.view_cancelled",
  "sales_invoice.print_cancelled",
  "sales_invoice.approve_cancellation",
  "sales_invoice.customer.link",
  "sales_invoice.customer.relink",
  "sales_invoice.customer.repair",
  "whatsapp",
  "accounting",
  "voucher_view",
  "voucher_create",
  "voucher_edit",
  "voucher_delete",
  "voucher_approve",
  "voucher_reverse",
  "backup",
  "tasks",
  "task_create",
  "task_edit",
  "task_delete",
  "task_assign",
  "task_approve",
  "koshas",
  "photography",
  "photography.portal.view",
  "photography.booking.view",
  "photography.assignment.manage",
  "photography.job.accept",
  "photography.status.update",
  "photography.checklist.update",
  "photography.upload.create",
  "photography.files.manage",
  "photography.editing.manage",
  "photography.delivery.confirm",
  "photography.financials.view",
  "photography.reports.view",
  "graduation",
  "graduation_production",
  "graduation_printing",
  "graduation_embroidery",
  "graduation_cashier",
  "graduation_manager",
  "graduation_warehouse",
  "graduation.view",
  "graduation.create",
  "graduation.edit",
  "graduation.delete",
  "graduation.group.create",
  "graduation.group.edit",
  "graduation.group.manage",
  "graduation.student.add",
  "graduation.student.delete",
  "graduation.student.manage",
  "graduation.template.view",
  "graduation.template.manage",
  "graduation.package.manage",
  "graduation.price.edit",
  "graduation.discount.apply",
  "graduation.payment.receive",
  "graduation.receipt.print",
  "graduation.measurement.update",
  "graduation.preview.manage",
  "graduation.approval.manage",
  "graduation.production.update",
  "graduation.packaging.scan",
  "graduation.packaging.override",
  "graduation.delivery.confirm",
  "graduation.inventory.view",
  "graduation.report.view",
  "graduation.reports.view",
  "graduation.settings.manage",
  "representative.portal.access",
  "representative.group.view",
  "representative.students.manage",
  "representative.payments.create",
  "representative.receipts.print",
  "representative.measurements.edit",
  "representative.reminders.send",
  "representative.delivery.confirm",
  "representative.issues.create",
  "representative.reports.export",
  "installments",
  "installments.view",
  "installments.create",
  "installments.convert_invoice",
  "installments.receive_payment",
  "installments.edit_schedule",
  "installments.reschedule",
  "installments.pause",
  "installments.cancel",
  "installments.approve_changes",
  "installments.send_reminders",
  "installments.export",
  "installments.view_credit_score",
  "installments.manage_representative_custody",
  // Tailors Portal (بوابة الخياطين) — mirrors the server registry.
  "tailoring",
  "tailoring.portal.access",
  "tailoring.assigned_orders.view",
  "tailoring.measurements.create",
  "tailoring.measurements.edit",
  "tailoring.measurements.submit",
  "tailoring.production.update",
  "tailoring.alterations.manage",
  "tailoring.photos.upload",
  "tailoring.measurements.print",
  "research",
  "research.view",
  "research.create",
  "research.edit",
  "research.archive",
  "research.assign",
  "research.sources.manage",
  "research.ai.use",
  "research.chapters.manage",
  "research.files.manage",
  "research.plagiarism.manage",
  "research.citations.manage",
  "research.financials.view",
  "research.payment.receive",
  "research.reports.view",
  "research.settings.manage",
  "hr",
  "payroll_view",
  "payroll_edit",
  "payroll_delete",
  "payroll_recalculate",
  "payroll_submit",
  "payroll_reopen",
  "payroll_cancel",
  "payroll_approve",
  "payroll_reject",
  "payroll_pay",
  "employee_salaries_view",
  "employee_salaries_create",
  "employee_salaries_edit",
  "employee_salaries_delete_draft",
  "employee_salaries_view_historical",
  "employee_salaries_repair_historical",
  "employee_salaries_add_amount",
  "employee_salaries_reduce_amount",
  "employee_salaries_approve",
  "employee_salaries_pay",
  "employee_salaries_reverse",
  "employee_salaries_cancel",
  "employee_salaries_print",
  "employee_salaries_export",
  "employee_salaries_view_accounting",
  "employee_salaries_view_cashbox",
  "bonus_view",
  "bonus_create",
  "bonus_edit",
  "bonus_submit",
  "bonus_approve",
  "bonus_reject",
  "bonus_delete",
  "bonus_apply",
  "bonus_reverse",
  "executive",
  "ai_dashboard_view",
  "ai_recommendations_view",
  "ai_alerts_view",
  "ai_settings_manage",
  "production_view",
  "production_create",
  "production_edit",
  "production_delete",
  "production_approve",
  // Province delivery — granular. The legacy coarse "delivery" permission still
  // grants all of these server-side so existing staff keep their access.
  "delivery_view",
  "delivery_add",
  "delivery_edit",
  "delivery_fee_override",
  "delivery_status_update",
  "delivery_label_print",
  "delivery_provinces_manage",
  "delivery_pricing_manage",
  "delivery_cod_settle",
  "delivery_cancel",
  "delivery_return",
  "delivery_accounting_manage",
  // Cross-module oversight — health monitor, reconciliation center, recycle bin.
  "system_health",
  "reconciliation_repair",
  "recycle_bin_view",
  "recycle_bin_restore",
  "recycle_bin_purge",
  // ID document scanner.
  "doc_scanner_view",
  "doc_scanner_scan",
  "doc_scanner_edit",
  "doc_scanner_print",
  "doc_scanner_export",
  "doc_scanner_save",
  "doc_scanner_view_saved",
  "doc_scanner_delete",
  "doc_scanner_view_original",
  "catering_view",
  "catering_manage",
  "catering_kitchen",
  "catering_delivery",
  "catering_cashier",
  "catering_supervisor",
  "catering_warehouse",
  "catering_items_manage",
  "catering_categories_manage",
  "catering_orders_manage",
  "catering_payments_receive",
  "catering_cost_view",
  "catering_profit_view",
  "catering_suppliers_manage",
  "catering_inventory_manage",
  "catering_reports_view",
  "catering_settings_manage",
  "approvals.view",
  "approvals.approve",
  "approvals.reject",
  "approvals.return_for_edit",
  "approvals.forward_to_main_manager",
  "approvals.comment",
  "approvals.audit.view",
  "approvals.reverse",
  "bouquet.admin.view",
  "bouquet.components.create",
  "bouquet.components.edit",
  "bouquet.components.delete",
  "bouquet.accessories.manage",
  "bouquet.templates.manage",
  "bouquet.ready_made.manage",
  "bouquet.preview.manage",
  "bouquet.prices.manage",
  "bouquet.stock.manage",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "approvals.view": "مشاهدة طلبات الموافقة",
  "approvals.approve": "اعتماد الطلبات",
  "approvals.reject": "رفض الطلبات",
  "approvals.return_for_edit": "إعادة الطلب للتعديل",
  "approvals.forward_to_main_manager": "تحويل الطلب للمدير الرئيسي",
  "approvals.comment": "كتابة ملاحظات الموافقة",
  "approvals.audit.view": "مشاهدة سجل الموافقات",
  "approvals.reverse": "عكس اعتماد بموجب سبب",
  "bouquet.admin.view": "عرض إدارة مصمم الباقات",
  "bouquet.components.create": "إضافة عناصر مصمم الباقات",
  "bouquet.components.edit": "تعديل عناصر مصمم الباقات",
  "bouquet.components.delete": "أرشفة عناصر مصمم الباقات",
  "bouquet.accessories.manage": "إدارة إكسسوارات الباقات",
  "bouquet.templates.manage": "إدارة قوالب الباقات",
  "bouquet.ready_made.manage": "إدارة الباقات الجاهزة",
  "bouquet.preview.manage": "إدارة معاينة الباقات",
  "bouquet.prices.manage": "تعديل أسعار الباقات",
  "bouquet.stock.manage": "تعديل مخزون الباقات",
  research: "إدارة مركز الأبحاث",
  "research.view": "عرض مركز الأبحاث",
  "research.create": "إنشاء طلب بحث",
  "research.edit": "تعديل طلبات الأبحاث",
  "research.archive": "أرشفة الأبحاث",
  "research.assign": "توزيع فريق البحث",
  "research.sources.manage": "إدارة مصادر الأبحاث",
  "research.ai.use": "استخدام مساعد البحث الذكي",
  "research.chapters.manage": "إدارة فصول البحث",
  "research.files.manage": "إدارة ملفات الأبحاث",
  "research.plagiarism.manage": "إدارة فحوصات الاستلال",
  "research.citations.manage": "إدارة التوثيق والمراجع",
  "research.financials.view": "عرض مالية الأبحاث",
  "research.payment.receive": "استلام دفعات الأبحاث",
  "research.reports.view": "عرض تقارير الأبحاث",
  "research.settings.manage": "إعدادات مركز الأبحاث",
  catering_view: "عرض مركز تجهيز حفلات الطعام",
  catering_manage: "إدارة حجوزات وتجهيز الطعام",
  catering_kitchen: "إدارة المطبخ والتحضير",
  catering_delivery: "إدارة توصيل تجهيز الطعام",
  catering_cashier: "مالية وفواتير تجهيز الطعام",
  catering_supervisor: "إشراف تجهيز حفلات الطعام",
  catering_warehouse: "مخزن ومشتريات تجهيز الطعام",
  catering_items_manage: "إدارة أصناف الطعام",
  catering_categories_manage: "إدارة أقسام الطعام",
  catering_orders_manage: "إنشاء وتعديل طلبات التجهيزات",
  catering_payments_receive: "استلام دفعات التجهيزات",
  catering_cost_view: "عرض كلف التجهيزات",
  catering_profit_view: "عرض أرباح التجهيزات",
  catering_suppliers_manage: "إدارة مجهزي التجهيزات",
  catering_inventory_manage: "إدارة مخزون التجهيزات",
  catering_reports_view: "عرض تقارير التجهيزات",
  catering_settings_manage: "إدارة إعدادات التجهيزات",
  "sales_invoice.cancel": "إلغاء وعكس فاتورة مبيعات",
  "sales_invoice.view_cancelled": "عرض الفواتير الملغاة",
  "sales_invoice.print_cancelled": "طباعة فاتورة ملغاة",
  "sales_invoice.approve_cancellation": "اعتماد إلغاء فاتورة مبيعات",
  "sales_invoice.customer.link": "ربط فاتورة مبيعات بعميل",
  "sales_invoice.customer.relink": "إعادة ربط فاتورة مبيعات بعميل",
  "sales_invoice.customer.repair": "إصلاح ربط فواتير المبيعات التاريخية",
  custody_groups_view: "عرض مجموعات عهدة الموظفين",
  custody_groups_create: "إنشاء مجموعات العهدة",
  custody_groups_edit: "تعديل مجموعات العهدة",
  custody_groups_assign_employee: "تعيين موظف للعهدة",
  custody_groups_manage_assets: "إضافة وإزالة أصول العهدة",
  custody_groups_reserve: "حجز معدات العهدة",
  custody_groups_checkout: "تسليم معدات العهدة",
  custody_groups_return: "استلام معدات العهدة",
  custody_groups_damage_report: "تسجيل تلف معدات العهدة",
  custody_groups_history_view: "عرض سجل عهدة الموظف",
  ai_dashboard_view: "عرض لوحة عقل الفعاليات",
  ai_recommendations_view: "عرض توصيات عقل الفعاليات",
  ai_alerts_view: "عرض تنبيهات عقل الفعاليات",
  ai_settings_manage: "إدارة إعدادات عقل الفعاليات",
  voucher_view: "عرض السندات المالية",
  voucher_create: "إنشاء السندات المالية",
  voucher_edit: "تعديل السندات المالية",
  voucher_delete: "إلغاء السندات غير المرحلة",
  voucher_approve: "اعتماد السندات المالية",
  voucher_reverse: "عكس السندات المرحلة",
  salary_settings_view: "عرض إعدادات الراتب",
  salary_settings_edit: "تعديل إعدادات الراتب",
  salary_settings_approve: "اعتماد تغييرات الراتب",
  hr: "الموارد البشرية والرواتب",
  payroll_view: "عرض الرواتب",
  payroll_edit: "تعديل الرواتب",
  payroll_delete: "حذف الرواتب",
  payroll_recalculate: "إعادة احتساب الرواتب",
  payroll_submit: "إرسال الرواتب للاعتماد",
  payroll_reopen: "إعادة فتح الرواتب",
  payroll_cancel: "إلغاء الرواتب",
  payroll_approve: "اعتماد الرواتب",
  payroll_reject: "رفض الرواتب",
  payroll_pay: "دفع الرواتب",
  employee_salaries_view: "عرض رواتب الموظفين",
  employee_salaries_create: "إنشاء راتب موظف",
  employee_salaries_edit: "تعديل راتب موظف",
  employee_salaries_delete_draft: "حذف راتب مسودة",
  employee_salaries_view_historical: "عرض الرواتب القديمة",
  employee_salaries_repair_historical: "إصلاح روابط راتب قديم",
  employee_salaries_add_amount: "إضافة مبلغ إلى الراتب",
  employee_salaries_reduce_amount: "تقليل مبلغ من الراتب",
  employee_salaries_approve: "اعتماد راتب موظف",
  employee_salaries_pay: "صرف راتب موظف",
  employee_salaries_reverse: "عكس راتب مصروف",
  employee_salaries_cancel: "إلغاء راتب موظف",
  employee_salaries_print: "طباعة قسيمة راتب",
  employee_salaries_export: "تصدير الرواتب",
  employee_salaries_view_accounting: "عرض محاسبة الرواتب",
  employee_salaries_view_cashbox: "عرض روابط صندوق الرواتب",
  bonus_view: "عرض المكافآت",
  bonus_create: "إضافة مكافآت",
  bonus_edit: "تعديل المكافآت",
  bonus_submit: "إرسال المكافآت للاعتماد",
  bonus_approve: "اعتماد المكافآت",
  bonus_reject: "رفض المكافآت",
  bonus_delete: "إلغاء المكافآت",
  bonus_apply: "تطبيق المكافآت على الرواتب",
  bonus_reverse: "عكس المكافآت",
  executive: "لوحة القيادة التنفيذية",
  dashboard: "مشاهدة لوحة التحكم",
  orders: "إدارة الطلبات",
  bookings: "إدارة الحجوزات",
  booking_operations_view: "عرض مساحة عمليات الحجز",
  booking_edit: "تعديل الحجز",
  booking_status_change: "تغيير حالة الحجز",
  booking_products_manage: "إدارة منتجات الحجز",
  inventory_shortage_override: "تجاوز عجز المخزون",
  booking_assets_manage: "إدارة أصول الحجز",
  asset_reserve: "حجز الأصول",
  asset_release: "تحرير الأصول",
  warehouse_issue: "إخراج مواد المستودع",
  booking_return_confirm: "تأكيد إرجاع الحجز",
  asset_damage_record: "تسجيل تلف الأصل",
  asset_damage_approve: "اعتماد تلف أو نقص الأصل",
  "asset.sell": "بيع الأصل",
  "asset.view_sales": "عرض مبيعات الأصول",
  "asset.print_sales": "طباعة تقرير مبيعات الأصول",
  "asset.export_sales": "تصدير تقرير مبيعات الأصول",
  depreciation_view: "عرض إهلاك الأصول",
  depreciation_usage_edit: "تحديث استخدام الأصل",
  depreciation_print_a4: "طباعة إهلاك الأصول A4",
  depreciation_print_80mm: "طباعة إهلاك الأصول 80mm",
  depreciation_export_pdf: "تصدير تقرير إهلاك الأصول PDF",
  booking_finance_view: "عرض مالية الحجز",
  booking_payment_receive: "استلام دفعة الحجز",
  booking_finance_approve: "اعتماد مالية الحجز",
  booking_payment_reverse: "عكس دفعة الحجز",
  booking_tasks_manage: "إدارة مهام الحجز",
  booking_documents_manage: "إدارة مستندات الحجز",
  booking_close: "إغلاق الحجز",
  booking_cancel: "إلغاء الحجز",
  services: "إدارة الخدمات",
  products: "إدارة المتجر والمنتجات",
  asset_depreciation_remove: "إزالة سجل إهلاك الأصل",
  depreciation_categories_view: "عرض فئات الإهلاك",
  depreciation_categories_create: "إضافة فئة إهلاك",
  depreciation_categories_edit: "تعديل فئة إهلاك",
  depreciation_categories_archive: "أرشفة فئة إهلاك",
  depreciation_categories_apply: "تطبيق تغييرات الفئة على الأصول",
  depreciation_categories_audit_view: "عرض تدقيق فئات الإهلاك",
  gallery: "إدارة الصور والملفات",
  delivery: "إدارة التوصيل",
  delivery_view: "عرض تفاصيل التوصيل",
  delivery_add: "إضافة تفاصيل التوصيل",
  delivery_edit: "تعديل تفاصيل التوصيل",
  delivery_fee_override: "تعديل أجور التوصيل يدوياً",
  delivery_status_update: "تحديث حالة التوصيل",
  delivery_label_print: "طباعة ملصق التوصيل",
  delivery_provinces_manage: "إدارة المحافظات",
  delivery_pricing_manage: "إدارة تسعير التوصيل",
  delivery_cod_settle: "تأكيد تحصيل الدفع عند الاستلام",
  delivery_cancel: "إلغاء طلب التوصيل",
  delivery_return: "تحديد التوصيل كمرتجع",
  delivery_accounting_manage: "إدارة محاسبة التوصيل",
  system_health: "مراقبة صحة النظام والتسويات",
  reconciliation_repair: "تنفيذ التسويات التصحيحية",
  recycle_bin_view: "عرض سلة المحذوفات",
  recycle_bin_restore: "استعادة السجلات المحذوفة",
  recycle_bin_purge: "الحذف النهائي",
  doc_scanner_view: "عرض ماسح المستمسكات",
  doc_scanner_scan: "مسح المستمسكات",
  doc_scanner_edit: "تعديل المسح",
  doc_scanner_print: "طباعة المستمسكات",
  doc_scanner_export: "تصدير PDF للمستمسكات",
  doc_scanner_save: "حفظ المستمسكات",
  doc_scanner_view_saved: "عرض المستمسكات المحفوظة",
  doc_scanner_delete: "حذف المستمسكات",
  doc_scanner_view_original: "عرض الصورة الأصلية",
  customers: "إدارة العملاء",
  staff: "إدارة الموظفين",
  settings: "إدارة الإعدادات",
  invoices: "طباعة الفواتير",
  "print.sales_invoice": "الطباعة المباشرة لفواتير المبيعات",
  "print.reprint": "إعادة طباعة الفواتير",
  "print.queue.view": "عرض طابور الطباعة",
  "print.queue.manage": "إدارة طابور الطباعة",
  "print.printers.manage": "إدارة الطابعات",
  "print.agents.manage": "إدارة أجهزة الطباعة",
  whatsapp: "إرسال واتساب",
  accounting: "الحسابات والقيود المالية",
  backup: "النسخ الاحتياطي والتصدير",
  tasks: "إدارة المهام",
  task_create: "إنشاء مهام الموظفين",
  task_edit: "تعديل مهام الموظفين",
  task_delete: "حذف مهام الموظفين",
  task_assign: "إسناد مهام الموظفين",
  task_approve: "اعتماد مهام الموظفين",
  koshas: "بوابة كادر الكوشات",
  photography: "بوابة المصورين",
  "photography.portal.view": "التصوير: عرض البوابة",
  "photography.booking.view": "التصوير: عرض الحجوزات",
  "photography.assignment.manage": "التصوير: إدارة توزيع الكادر",
  "photography.job.accept": "التصوير: قبول أو رفض المهمة",
  "photography.status.update": "التصوير: تحديث مرحلة التنفيذ",
  "photography.checklist.update": "التصوير: تحديث قوائم الفحص",
  "photography.upload.create": "التصوير: رفع ملفات التنفيذ",
  "photography.files.manage": "التصوير: إدارة الملفات والبطاقات",
  "photography.editing.manage": "التصوير: إدارة المونتاج",
  "photography.delivery.confirm": "التصوير: تأكيد التسليم",
  "photography.financials.view": "التصوير: عرض الملخص المالي",
  "photography.reports.view": "التصوير: عرض التقارير",
  graduation: "إدارة تجهيزات التخرج",
  graduation_production: "تخرج: الإنتاج",
  graduation_printing: "تخرج: الطباعة",
  graduation_embroidery: "تخرج: التطريز",
  graduation_cashier: "تخرج: الصندوق والفواتير",
  graduation_manager: "تخرج: مدير المركز",
  graduation_warehouse: "تخرج: المخزن",
  "graduation.view": "التخرج: عرض المركز",
  "graduation.create": "التخرج: إنشاء طلب",
  "graduation.edit": "التخرج: تعديل طلب",
  "graduation.delete": "التخرج: أرشفة طلب",
  "graduation.group.create": "التخرج: إنشاء مجموعة",
  "graduation.group.edit": "التخرج: تعديل مجموعة",
  "graduation.group.manage": "التخرج: إدارة المجموعات",
  "graduation.student.add": "التخرج: إضافة طالب",
  "graduation.student.delete": "التخرج: أرشفة طالب",
  "graduation.student.manage": "التخرج: إدارة الطلاب",
  "graduation.template.view": "التخرج: عرض النماذج",
  "graduation.template.manage": "التخرج: إدارة النماذج",
  "graduation.package.manage": "التخرج: إدارة الباقات",
  "graduation.price.edit": "التخرج: تعديل الأسعار",
  "graduation.discount.apply": "التخرج: تطبيق الخصم",
  "graduation.payment.receive": "التخرج: استلام دفعة",
  "graduation.receipt.print": "التخرج: طباعة الوصولات",
  "graduation.measurement.update": "التخرج: تحديث القياسات",
  "graduation.preview.manage": "التخرج: إدارة المعاينات",
  "graduation.approval.manage": "التخرج: إدارة الموافقات",
  "graduation.production.update": "التخرج: تحديث الإنتاج",
  "graduation.packaging.scan": "التخرج: مسح التغليف",
  "graduation.packaging.override": "التخرج: تجاوز قيود التغليف",
  "graduation.delivery.confirm": "التخرج: تأكيد التسليم",
  "graduation.inventory.view": "التخرج: عرض المخزون والمواد",
  "graduation.report.view": "التخرج: عرض التقارير",
  "graduation.reports.view": "التخرج: عرض تقارير المؤسسة",
  "graduation.settings.manage": "التخرج: إدارة الإعدادات",
  "representative.portal.access": "ممثل الشعب: الدخول إلى البوابة",
  "representative.group.view": "ممثل الشعب: عرض المجموعة",
  "representative.students.manage": "ممثل الشعب: إدارة الطلبة",
  "representative.payments.create": "ممثل الشعب: تسجيل دفعات",
  "representative.receipts.print": "ممثل الشعب: طباعة الوصولات",
  "representative.measurements.edit": "ممثل الشعب: إدخال القياسات",
  "representative.reminders.send": "ممثل الشعب: إرسال التذكيرات",
  "representative.delivery.confirm": "ممثل الشعب: تأكيد التسليم",
  "representative.issues.create": "ممثل الشعب: الإبلاغ عن مشكلة",
  "representative.reports.export": "ممثل الشعب: تصدير التقارير",
  installments: "نظام الأقساط (وصول كامل)",
  "installments.view": "الأقساط: عرض العقود",
  "installments.create": "الأقساط: إنشاء العقود",
  "installments.convert_invoice": "الأقساط: تحويل الفاتورة",
  "installments.receive_payment": "الأقساط: استلام قسط",
  "installments.edit_schedule": "الأقساط: تعديل الجدول",
  "installments.reschedule": "الأقساط: إعادة الجدولة",
  "installments.pause": "الأقساط: إيقاف واستئناف",
  "installments.cancel": "الأقساط: إلغاء الخطة",
  "installments.approve_changes": "الأقساط: اعتماد التغييرات",
  "installments.send_reminders": "الأقساط: إرسال التذكيرات",
  "installments.export": "الأقساط: تصدير التقارير",
  "installments.view_credit_score": "الأقساط: عرض التقييم الائتماني",
  "installments.manage_representative_custody": "الأقساط: إدارة عهدة الممثلين",
  tailoring: "بوابة الخياطين (وصول كامل)",
  "tailoring.portal.access": "الخياطين: الدخول للبوابة",
  "tailoring.assigned_orders.view": "الخياطين: عرض الطلبات المخصصة",
  "tailoring.measurements.create": "الخياطين: إدخال القياسات",
  "tailoring.measurements.edit": "الخياطين: تعديل القياسات",
  "tailoring.measurements.submit": "الخياطين: إرسال القياسات للاعتماد",
  "tailoring.production.update": "الخياطين: تحديث مراحل الإنتاج",
  "tailoring.alterations.manage": "الخياطين: إدارة التعديلات",
  "tailoring.photos.upload": "الخياطين: رفع الصور",
  "tailoring.measurements.print": "الخياطين: طباعة القياسات",
  production_view: "عرض الإنتاج",
  production_create: "إنشاء أوامر الإنتاج",
  production_edit: "تعديل أوامر الإنتاج",
  production_delete: "حذف أوامر الإنتاج",
  production_approve: "اعتماد أوامر الإنتاج",
};

export type AdminMe = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  isActive: boolean;
};

let adminMeCache: AdminMe | null | undefined;
let adminMePromise: Promise<AdminMe | null> | null = null;

function apiPath(path: string): string {
  return `/api${path.startsWith("/") ? path : `/${path}`}`;
}

const DEVICE_ID_KEY = "ajn_device_id";

// Stable, NON-SECRET per-browser identifier. Lets the Active Devices list group
// "this phone" vs "that laptop". It is not used for authentication, so storing
// it in localStorage is safe.
export function getDeviceId(): string {
  if (typeof window === "undefined" || !window.localStorage) return "";
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// Which portal the current route belongs to, sent as x-portal so a session row
// records where it was opened from (shown in the device list). Display-only.
export function currentPortal(): string {
  if (typeof window === "undefined") return "";
  const path = window.location.pathname;
  if (path.startsWith("/staff/photography")) return "photography";
  // Sound operations live under the kosha portal today; a future dedicated
  // /staff/sound route is detected here so device rows label it correctly.
  if (path.startsWith("/staff/sound")) return "sound";
  if (path.startsWith("/staff/koshas") || path.startsWith("/staff")) return "kosha";
  if (path.startsWith("/representative")) return "representative";
  if (path.startsWith("/admin")) return "admin";
  return "";
}

export type AjNApiErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE"
  | "FOREIGN_KEY_CONFLICT"
  | "STOCK_INSUFFICIENT"
  | "PAYMENT_INVALID"
  | "INVOICE_INVALID"
  | "BOOKING_INVALID"
  | "DATABASE_ERROR"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "STALE_DATA"
  | "UNKNOWN_ERROR";

export class AjNApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: AjNApiErrorCode = "UNKNOWN_ERROR",
    readonly requestId?: string,
    readonly retryable = false,
    readonly fieldErrors?: Record<string, string>,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "AjNApiError";
  }
}

const inFlightWrites = new Map<string, Promise<any>>();

function browserRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `REQ-${crypto.randomUUID()}`;
  return `REQ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function adminFetch<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  if (!headers.has("x-device-id")) {
    const deviceId = getDeviceId();
    if (deviceId) headers.set("x-device-id", deviceId);
  }
  if (!headers.has("x-portal")) {
    const portal = currentPortal();
    if (portal) headers.set("x-portal", portal);
  }
  if (!headers.has("x-request-id")) headers.set("x-request-id", browserRequestId());
  const method = (init.method ?? "GET").toUpperCase();
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(method);
  // This is a browser-side guard only. Financial endpoints retain their own
  // durable idempotency keys on the server, which protects retries/reloads.
  const writeKey = isWrite
    ? `${method}:${apiPath(path)}:${typeof init.body === "string" ? init.body : ""}`
    : "";
  const pending = writeKey ? inFlightWrites.get(writeKey) : undefined;
  if (pending) return pending as Promise<T>;
  const request = (async (): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(apiPath(path), {
    ...init,
    headers,
    credentials: "include",
    });
  } catch {
    throw new AjNApiError(
      "تعذر الاتصال بالخادم",
      0,
      "NETWORK_ERROR",
      headers.get("x-request-id") ?? undefined,
      true,
    );
  }
  if (!res.ok) {
    let msg = res.statusText;
    let payload: any = null;
    try {
      const j = await res.json();
      payload = j;
      const details = Array.isArray(j?.details)
        ? j.details
            .slice(0, 4)
            .map(
              (item: any) =>
                `${item?.field ?? "body"}: ${item?.message ?? "قيمة غير صحيحة"}`,
            )
            .join("، ")
        : "";
      msg = j?.message ?? j?.error ?? (details || msg);
    } catch {
      /* ignore */
    }
    throw new AjNApiError(
      msg,
      res.status,
      payload?.code ?? "UNKNOWN_ERROR",
      payload?.requestId ?? res.headers.get("x-request-id") ?? undefined,
      payload?.retryable === true,
      payload?.fieldErrors,
      payload,
    );
  }
  if (res.status === 204) return null as T;
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("json") ? res.json() : (res.text() as any);
  })();
  if (!writeKey) return request;
  inFlightWrites.set(writeKey, request);
  try {
    return await request;
  } finally {
    inFlightWrites.delete(writeKey);
  }
}

// adminFetch throws Error("HTTP <status>: <arabic message>"). Never show that raw string to a
// user — strip the technical prefix so toasts read as a clean Arabic sentence.
export function apiErrorMessage(
  err: unknown,
  fallback = "حدث خطأ غير متوقع، حاول مرة أخرى",
): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const cleaned = raw.replace(/^HTTP\s+\d+:\s*/i, "").trim();
  return cleaned || fallback;
}

// The HTTP status code (409, 404, …) so callers can branch on it (e.g. show a recovery action).
export function apiErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

// Thrown when the single-session login policy detects an existing active
// session. The login UIs catch this, confirm with the Arabic prompt, then retry
// with { forceReplace: true }.
export class SessionDecisionRequired extends Error {
  readonly requiresSessionDecision = true;
  constructor(message: string) {
    super(message);
    this.name = "SessionDecisionRequired";
  }
}

export function isSessionDecision(
  err: unknown,
): err is { requiresSessionDecision: true; message: string } {
  return Boolean(
    err && (err as { requiresSessionDecision?: unknown }).requiresSessionDecision,
  );
}

export async function loginAdmin(
  username: string,
  password: string,
  opts: { forceReplace?: boolean } = {},
): Promise<AdminMe> {
  try {
    const r = await adminFetch<{ user: AdminMe }>("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        forceReplace: opts.forceReplace === true,
      }),
    });
    adminMeCache = r.user;
    adminMePromise = null;
    return r.user;
  } catch (err) {
    const data = (err as { data?: { requiresSessionDecision?: boolean; message?: string } })?.data;
    if (apiErrorStatus(err) === 409 && data?.requiresSessionDecision) {
      throw new SessionDecisionRequired(
        data.message ||
          "يوجد جلسة نشطة لهذا الحساب، هل تريد تسجيل الخروج من الجهاز السابق؟",
      );
    }
    throw err;
  }
}

// Login policy (System Settings): multiple concurrent sessions vs a single
// active session per account.
export type AuthPolicy = { singleSession: boolean };
export async function fetchAuthPolicy(): Promise<AuthPolicy> {
  return adminFetch<AuthPolicy>("/admin/settings/auth-policy");
}
export async function saveAuthPolicy(policy: AuthPolicy): Promise<AuthPolicy> {
  return adminFetch<AuthPolicy>("/admin/settings/auth-policy", {
    method: "PATCH",
    body: JSON.stringify(policy),
  });
}

// Wipe all client-side private state tied to the signed-out identity. This is
// the core isolation fix: without clearing the React Query cache, the previous
// employee's cached bookings/dashboards would still render after a switch.
// The offline write-queue is cleared too so their unsynced ops never replay
// under the next employee. Dynamic import avoids a static import cycle
// (offline.ts imports adminFetch from this module).
// localStorage/sessionStorage keys that hold PRIVATE, session-scoped data and
// must be cleared on logout. Public/device keys (theme, device id, cart id,
// public settings) are deliberately preserved so unrelated state and other
// browser profiles are never disturbed.
const PRIVATE_STORAGE_PREFIXES = ["ajn:", "ajn-draft", "ajn-portal", "ajn-photography", "ajn-kosha"];
const PRIVATE_STORAGE_EXACT = ["ajn_auth_token"];

function clearPrivateStorage(): void {
  if (typeof window === "undefined") return;
  for (const store of [window.localStorage, window.sessionStorage]) {
    if (!store) continue;
    try {
      const remove: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (!key) continue;
        if (
          PRIVATE_STORAGE_EXACT.includes(key) ||
          PRIVATE_STORAGE_PREFIXES.some((p) => key.startsWith(p))
        )
          remove.push(key);
      }
      remove.forEach((k) => store.removeItem(k));
    } catch {
      /* storage access is best-effort */
    }
  }
}

async function clearPrivateClientState(): Promise<void> {
  adminMeCache = null;
  adminMePromise = null;
  try {
    queryClient.clear();
  } catch {
    /* cache clear is best-effort */
  }
  clearPrivateStorage();
  try {
    const offline = await import("@/views/staff/offline");
    await offline.clearQueue();
  } catch {
    /* offline queue may not exist in this bundle */
  }
}

// Ordinary logout — current session only. Server soft-revokes just this token;
// other devices and other employees are untouched.
export async function logoutAdmin(
  opts: { intent?: "switch" } = {},
): Promise<void> {
  const qs = opts.intent === "switch" ? "?intent=switch" : "";
  try {
    await adminFetch(`/admin/auth/logout${qs}`, { method: "POST" });
  } catch {
    /* swallow */
  }
  await clearPrivateClientState();
}

// "تبديل الموظف" — save any pending offline drafts first, then perform a normal
// current-session logout and clear this session's private cache so the next
// employee starts clean. The portal then re-renders its own inline login.
// Audited server-side as employee_switch via the intent flag.
export async function switchEmployee(): Promise<void> {
  try {
    const offline = await import("@/views/staff/offline");
    await offline.flushQueue();
  } catch {
    /* draft flush is best-effort */
  }
  await logoutAdmin({ intent: "switch" });
}

export type DeviceSession = {
  sessionId: string | null;
  portal: string | null;
  deviceId: string | null;
  browser: string;
  device: string;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  expiresAt: string;
  current: boolean;
  status: "active" | "revoked" | "expired";
  revokedAt: string | null;
};

// List sessions for the current user, or (managers only) a target employee.
export async function fetchSessions(staffId?: number): Promise<DeviceSession[]> {
  const qs = staffId ? `?staffId=${staffId}` : "";
  const r = await adminFetch<{ sessions: DeviceSession[] }>(
    `/admin/auth/sessions${qs}`,
  );
  return r.sessions ?? [];
}

// Revoke one specific session (own device, or an employee's for managers).
export async function revokeDeviceSession(sessionId: string): Promise<void> {
  await adminFetch(`/admin/auth/sessions/${encodeURIComponent(sessionId)}/revoke`, {
    method: "POST",
  });
}

// "تسجيل الخروج من جميع الأجهزة" for the current user. Revokes every one of the
// current user's sessions (including this one), then clears local private state.
export async function logoutAllDevices(reason: string): Promise<number> {
  const r = await adminFetch<{ revoked: number }>("/admin/auth/logout-all", {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  await clearPrivateClientState();
  return r.revoked ?? 0;
}

// Manager action: revoke all sessions for ONE employee. Requires the `staff`
// permission server-side and a reason (audited). Does not affect the manager.
export async function managerLogoutEmployee(
  staffId: number,
  reason: string,
): Promise<number> {
  const r = await adminFetch<{ revoked: number }>(
    `/admin/staff/${staffId}/sessions/logout-all`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
  return r.revoked ?? 0;
}

export async function fetchAdminMe(
  options: { force?: boolean } = {},
): Promise<AdminMe | null> {
  if (!options.force && adminMeCache !== undefined) return adminMeCache;
  if (!options.force && adminMePromise) return adminMePromise;
  adminMePromise = adminFetch<{ user: AdminMe }>("/admin/auth/me")
    .then((r) => {
      adminMeCache = r.user;
      return r.user;
    })
    .catch((e: any) => {
      if (e?.status === 401 || e?.status === 403) {
        adminMeCache = null;
        return null;
      }
      adminMeCache = null;
      return null;
    })
    .finally(() => {
      adminMePromise = null;
    });
  return adminMePromise;
}

export function getCachedAdminMe(): AdminMe | null | undefined {
  return adminMeCache;
}

export function hasPerm(
  user: AdminMe | null,
  perm: Permission | null,
): boolean {
  if (!user || !user.isActive) return false;
  if (user.role === "admin") return true;
  if (!perm) return true;
  if (user.permissions.includes(perm)) return true;
  // Mirror the server: the "graduation" module gate implies its granular
  // sub-permissions so existing holders keep access after the split.
  if ((perm.startsWith("graduation_") || perm.startsWith("graduation.")) && user.permissions.includes("graduation"))
    return true;
  // Tailoring module gate; graduation managers also inherit tailoring access.
  if (
    perm.startsWith("tailoring") &&
    (user.permissions.includes("tailoring") ||
      user.permissions.includes("graduation") ||
      user.permissions.includes("graduation_production") ||
      user.permissions.includes("graduation_manager"))
  )
    return true;
  return false;
}

/**
 * Sales-invoice printing is delegated through a granular permission, while
 * the two top-level administration roles retain their existing full access.
 * Keep this deliberately scoped instead of broadening every permission check
 * for role aliases that may exist in imported staff data.
 */
export function canPrintSalesInvoice(user: AdminMe | null | undefined): boolean {
  if (!user || !user.isActive) return false;
  const role = String(user.role ?? "").trim().toLowerCase();
  return ["admin", "super_admin", "main_manager"].includes(role)
    || user.permissions.includes("print.sales_invoice");
}

export { fileToDataUrl };

export async function compressImageFile(
  file: File,
  maxSize = 1600,
  quality = 0.82,
  options: ImageProcessOptions = {},
): Promise<string> {
  return processImageFile(file, { ...options, maxSize, quality });
}
