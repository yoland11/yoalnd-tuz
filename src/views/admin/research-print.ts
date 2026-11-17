import { buildBrandedReceiptHtml, receiptEsc, type ReceiptSection } from "@/lib/branded-receipt";
import { ACADEMIC_LEVELS, RESEARCH_CATEGORIES } from "@/lib/research-contract";
import { RESEARCH_STATUSES, RESEARCH_TYPES } from "./research/shared";
import {
  buildReportDocumentHtml,
  downloadReportPdf,
  isMobilePdfEnvironment,
  openReportPrintWindow,
  type ReportColumn,
  type ReportDocumentOptions,
} from "@/lib/pdf-report";
import { printStandaloneDocument } from "@/lib/pdf";
import { formatCurrency } from "@/lib/money";

type Row = Record<string, any>;
export const researchOrderColumns: ReportColumn<Row>[] = [
  { key: "researchNo", header: "رقم البحث", width: 12, kind: "code" },
  { key: "title", header: "عنوان البحث", width: 26 },
  { key: "customerName", header: "الطالب", width: 18 },
  { key: "assignedEmployeeName", header: "المسؤول", width: 14 },
  { key: "deadline", header: "التسليم", width: 10, kind: "date" },
  { key: "totalAmount", header: "القيمة", width: 10, kind: "money" },
  { key: "paidAmount", header: "المقبوض", width: 10, kind: "money" },
  { key: "remainingAmount", header: "المتبقي", width: 10, kind: "money" },
];
export function researchReportOptions(
  title: string,
  from?: string,
  to?: string,
  subtitle?: string,
): ReportDocumentOptions {
  return {
    title,
    company: "مجموعة علي جان نهاد",
    companySubtitle: "قسم البحوث العلمية",
    orientation: "landscape",
    dateRange: { from, to },
    subtitle,
    footerNote:
      "المبالغ المقبوضة تشمل الحركات المعتمدة فقط. الطلبات المعلقة ليست إثبات تسديد.",
  };
}
export function buildResearchReportHtml(options: ReportDocumentOptions, columns: ReportColumn<Row>[], rows: Row[]) {
  // Keep the footer's Arabic descenders inside the raster capture. The shared
  // table builder and PDF/print engines still own the document layout.
  return buildReportDocumentHtml(options, columns, rows).replace('</body>', '<div aria-hidden="true" style="height:16px"></div></body>');
}
export async function exportResearchTable(input: {
  title: string;
  rows: Row[];
  mode: "print" | "download" | "excel";
  from?: string;
  to?: string;
  financial?: boolean;
  columns?: ReportColumn<Row>[];
  subtitle?: string;
}) {
  const columns =
    input.columns ||
    researchOrderColumns.filter(
      (column) => input.financial || column.kind !== "money",
    );
  if (input.mode === "excel") {
    const XLSX = await import("xlsx");
    const data = input.rows.map((row) =>
      Object.fromEntries(
        columns.map((column) => [
          column.header,
          column.value ? column.value(row) : (row[column.key] ?? ""),
        ]),
      ),
    );
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet["!cols"] = columns.map((column) => ({
      wch: Math.max(14, column.width),
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, "الأبحاث");
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["التقرير", input.title],
        ["من", input.from || "كل التواريخ"],
        ["إلى", input.to || "كل التواريخ"],
        ["النطاق", input.subtitle || "الصفوف المختارة"],
        ["عدد السجلات", input.rows.length],
      ]),
      "نطاق التقرير",
    );
    XLSX.writeFile(
      workbook,
      `research-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    return;
  }
  const options = researchReportOptions(
      input.title,
      input.from,
      input.to,
      input.subtitle,
    );
  const html = buildResearchReportHtml(options, columns, input.rows);
  if (input.mode === 'print' || isMobilePdfEnvironment()) openReportPrintWindow(html);
  else await downloadReportPdf(html, `research-${new Date().toISOString().slice(0, 10)}.pdf`, options.orientation);
}
export function researchReceiptHtml(
  order: Row,
  financials: Row,
  transaction?: Row,
) {
  const approved = transaction?.approvalStatus === "executed";
  const rejected =
    transaction?.approvalStatus === "rejected" ||
    transaction?.approvalStatus === "cancelled";
  const reversed =
    transaction?.netAmount !== undefined &&
    Number(transaction.netAmount) < Number(transaction.amount);
  const outgoing = transaction?.direction === "expense";
  return buildBrandedReceiptHtml(
    {
      documentTitle: `${transaction ? "وصل بحث" : "ملخص بحث"} ${order.researchNo}`,
      title: transaction
        ? approved
          ? outgoing
            ? "حركة عكس دفعة بحث"
            : "وصل قبض بحث علمي"
          : rejected
            ? "طلب دفعة مرفوض أو ملغى"
            : "طلب دفعة بانتظار الموافقة"
        : "ملخص حساب بحث علمي",
      icon: "graduation",
      compact: true,
      state:
        transaction && !approved
          ? {
              text: rejected
                ? "طلب مرفوض أو ملغى — لا يعد إثبات قبض"
                : "طلب معلق — لا يعد إثبات قبض ولا يخفض المديونية",
              tone: rejected ? "danger" : "warn",
            }
          : reversed
            ? {
                text: "تم عكس كل أو جزء من هذه الدفعة. راجع صافي الدفعة والرصيد الحالي.",
                tone: "warn",
              }
            : null,
      facts: [
        { label: "البحث", value: order.researchNo, icon: "hash" },
        { label: "الطالب", value: order.customerName, icon: "user" },
        { label: "الهاتف", value: order.customerPhone, icon: "phone" },
        {
          label: "التاريخ",
          value:
            transaction?.date?.slice(0, 10) ||
            new Date().toISOString().slice(0, 10),
          icon: "calendar",
        },
      ],
      sections: [{ title: "عنوان البحث", text: order.title }],
      totals: [
        { label: "قيمة البحث", value: formatCurrency(financials.totalAmount) },
        ...(transaction
          ? [
              {
                label: approved
                  ? outgoing
                    ? "قيمة الحركة العكسية"
                    : "قيمة الدفعة المسجلة"
                  : rejected
                    ? "قيمة الطلب المرفوض"
                    : "قيمة الطلب المعلق",
                value: formatCurrency(transaction.amount),
              },
              ...(reversed
                ? [
                    {
                      label: "صافي الدفعة بعد العكس",
                      value: formatCurrency(transaction.netAmount),
                    },
                  ]
                : []),
            ]
          : []),
        {
          label: "المقبوض المعتمد",
          value: formatCurrency(financials.paidAmount),
        },
        {
          label: "المتبقي",
          value: formatCurrency(financials.remainingAmount),
          tone: "due",
        },
      ],
      totalsNote:
        "الرصيد من سجل الدفعات المعتمد. الطلبات المعلقة لا تعد تسديداً.",
      notes: transaction?.notes || null,
      hideQr: true,
    },
    "80mm",
  );
}
export function printResearchThermal(
  order: Row,
  financials: Row,
  transaction?: Row,
) {
  printStandaloneDocument(
    researchReceiptHtml(order, financials, transaction),
    380,
  );
}
export function researchStudentStatementThermalHtml(statement:Row){
 return buildBrandedReceiptHtml({documentTitle:'كشف حساب أبحاث الطالب',title:'كشف حساب الطالب — البحوث العلمية',icon:'graduation',compact:true,hideQr:true,
  facts:[{label:'الطالب',value:statement.customer?.fullName||statement.customer?.name,icon:'user'},{label:'الهاتف',value:statement.customer?.phone,icon:'phone'},{label:'من',value:statement.from||'البداية'},{label:'إلى',value:statement.to||'اليوم'}],
  items:{title:'الحركات المعتمدة',columns:[{key:'reference',label:'المرجع',role:'name'},{key:'debit',label:'مدين',role:'number'},{key:'credit',label:'دائن',role:'number'}],rows:(statement.entries||[]).map((entry:Row)=>({cells:{reference:entry.reference,debit:formatCurrency(entry.debit),credit:formatCurrency(entry.credit)},sub:[entry.date,entry.receivedByName?`المستلم: ${entry.receivedByName}`:null].filter(Boolean).join(' · ')}))},
  totals:[{label:'الرصيد الافتتاحي',value:formatCurrency(statement.openingBalance)},{label:'الرصيد الختامي',value:formatCurrency(statement.closingBalance),tone:'due'}],notes:'كشف حساب البحوث فقط؛ يعرض الحركات المعتمدة ولا يمثل إيصال قبض جديد.'},'80mm');
}
export function printResearchStudentStatementThermal(statement:Row){printStandaloneDocument(researchStudentStatementThermalHtml(statement),380);}
export function researchStatementShareText(statement:Row){
 return [`مجموعة علي جان نهاد — قسم البحوث العلمية`,`كشف حساب الطالب: ${statement.customer?.fullName||statement.customer?.name||''}`,`الفترة: ${statement.from||'البداية'} — ${statement.to||'اليوم'}`,`الرصيد الافتتاحي: ${formatCurrency(statement.openingBalance)}`,
  ...(statement.entries||[]).map((entry:Row)=>`${String(entry.date||'').slice(0,10)} | ${entry.reference||''} | ${entry.description||''} | مدين: ${formatCurrency(entry.debit)} | دائن: ${formatCurrency(entry.credit)}`),`الرصيد الختامي: ${formatCurrency(statement.closingBalance)}`].join('\n');
}
/** Saved, authorized order fields only; never fall back to financial snapshots. */
function researchOrderPrintSections(order: Row, financials?: Row, assignments: readonly Row[] = []): ReceiptSection[] {
  const label = (labels: Record<string, string>, value: unknown) => value == null ? "—" : labels[String(value)] || String(value);
  const date = (value: unknown) => value ? String(value).slice(0, 10) : "—";
  const sections: ReceiptSection[] = [
    { title: "بيانات الطالب", facts: [
      { label: "الطالب", value: order.customerName || "—" },
      { label: "رقم الهاتف", value: order.customerPhone || "—" },
      { label: "الجامعة", value: order.universityName || "—" },
      { label: "الكلية", value: order.college || "—" },
      { label: "القسم / التخصص", value: order.department || "—" },
      { label: "المرحلة الأكاديمية", value: label(ACADEMIC_LEVELS, order.academicLevel) },
      { label: "المشرف الأكاديمي", value: order.supervisorName || "—" },
    ] },
    { title: "تفاصيل البحث", facts: [
      { label: "العنوان بالعربية", value: order.title || "—" },
      { label: "العنوان بالإنجليزية", value: order.titleEnglish || "—" },
      { label: "نوع البحث", value: label(RESEARCH_TYPES, order.researchType) },
      { label: "تصنيف البحث", value: label(RESEARCH_CATEGORIES, order.researchCategory) },
      { label: "المجال العلمي", value: order.researchField || "—" },
      { label: "لغة البحث", value: label({ ar: "العربية", en: "الإنجليزية", ku: "الكردية", other: "أخرى", mixed: "العربية والإنجليزية" }, order.language) },
      { label: "الصفحات المطلوبة", value: order.requiredPages ?? "—" },
      { label: "نمط التوثيق", value: order.citationStyle || "—" },
      { label: "الكلمات المفتاحية", value: (Array.isArray(order.keywords) ? order.keywords.join("، ") : order.keywords) || "—" },
    ] },
    { title: "التنفيذ والمواعيد", facts: [
      { label: "الحالة", value: label(RESEARCH_STATUSES, order.status) },
      { label: "نسبة الإنجاز", value: order.progress == null ? "—" : `${order.progress}%` },
      { label: "الأولوية", value: label({ normal: "اعتيادي", urgent: "مستعجل", critical: "عاجل جداً" }, order.urgency) },
      { label: "تاريخ الطلب", value: date(order.createdAt) },
      { label: "موعد التسليم", value: date(order.deadline) },
    ] },
  ];
  const employeeFacts = [
    ["assignedWriterId", "الكاتب / المسؤول"], ["assignedReviewerId", "المراجع"],
    ["assignedProofreaderId", "المدقق اللغوي"], ["assignedFormatterId", "المنسق"],
    ["assignedSupervisorId", "المشرف الداخلي"],
  ].flatMap(([key, title]) => {
    const assigned = order[key] && assignments.find(row => String(row.assignment?.staffId) === String(order[key]));
    const name = assigned?.staffName || assigned?.username || (key === "assignedWriterId" ? order.assignedEmployeeName : null);
    return name ? [{ label: title, value: name }] : [];
  });
  if (employeeFacts.length) sections.push({ title: "فريق العمل", facts: employeeFacts });
  if (financials) {
    const paid = financials.approvedPaidAmount ?? financials.paidAmount;
    const amounts = [financials.totalAmount, paid, financials.remainingAmount,
      ...(financials.pendingAmount == null ? [] : [financials.pendingAmount])];
    if (amounts.some(value => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0))
      throw new Error("تعذرت قراءة المعلومات المالية للبحث");
    sections.push({ title: "الملخص المالي", facts: [
      { label: "المبلغ المتفق عليه", value: formatCurrency(financials.totalAmount) },
      { label: "المقبوض المعتمد", value: formatCurrency(paid) },
      { label: "المتبقي", value: formatCurrency(financials.remainingAmount) },
      ...(financials.pendingAmount == null ? [] : [{ label: "الدفعات المعلقة (ليست تسديداً)", value: formatCurrency(financials.pendingAmount) }]),
      { label: "موعد استحقاق الدفع", value: date(order.paymentDueDate) },
    ] });
  }
  return sections;
}

export function researchOrderSheetHtml(order: Row, financials?: Row, assignments: readonly Row[] = []) {
  const sections = researchOrderPrintSections(order, financials, assignments);
  const rows = sections.flatMap(section => (section.facts || []).map((fact, index) => ({
    section: index === 0 ? section.title : "", label: fact.label, value: fact.value,
  })));
  const html = buildResearchReportHtml({
    ...researchReportOptions("تفاصيل طلب بحث علمي"),
    orientation: "portrait", meta: [{ label: "رقم الطلب", value: String(order.researchNo || "—") }],
    footerNote: financials ? "تفاصيل الطلب المحفوظة. المقبوض من سجل الدفعات المعتمد؛ المعلق لا يعد تسديداً. ليست إيصال قبض جديداً." : "تفاصيل الطلب المحفوظة — قسم البحوث العلمية.",
  }, [
    { key: "section", header: "القسم", width: 19 },
    { key: "label", header: "البيان", width: 26 },
    { key: "value", header: "التفاصيل", width: 55 },
  ], rows);
  // Long requirements may span pages. Keep them outside non-splitting table rows.
  const notes = `<section class="research-requirements"><h2>المتطلبات والملاحظات</h2><p>${receiptEsc(order.notes || "لم تسجل متطلبات أو ملاحظات.")}</p></section>`;
  return html.replace("</style>", `
    @font-face{font-family:"AJN Cairo";src:url("/fonts/Cairo-Variable.ttf") format("truetype");font-weight:200 1000;font-display:block}
    html,body{font-family:"AJN Cairo",Cairo,Tahoma,Arial,sans-serif}
    .rpt-table td:first-child,.rpt-table td:nth-child(2){font-weight:700}
    .rpt-table td:last-child{white-space:pre-wrap;unicode-bidi:plaintext}
    .research-requirements{margin-top:14px;overflow-wrap:anywhere}
    .research-requirements h2{font-size:13px;border-bottom:1px solid #111827;padding-bottom:5px;break-after:avoid}
    .research-requirements p{white-space:pre-wrap;margin:0;line-height:1.8;orphans:3;widows:3}
  </style>`).replace('<div class="rpt-doc-footer">', `${notes}<div class="rpt-doc-footer">`);
}

/** Dedicated 80mm composition, sharing the same saved fields as A4. */
export function researchOrderThermalHtml(order: Row, financials?: Row, assignments: readonly Row[] = []) {
  return buildBrandedReceiptHtml({
    documentTitle: `تفاصيل طلب البحث ${order.researchNo || ""}`, title: "تفاصيل طلب بحث علمي",
    icon: "graduation", compact: true, hideQr: true,
    facts: [{ label: "رقم الطلب", value: order.researchNo || "—", icon: "hash" }],
    sections: [...researchOrderPrintSections(order, financials, assignments),
      { title: "المتطلبات والملاحظات", text: order.notes || "لم تسجل متطلبات أو ملاحظات." }],
    footNote: financials ? "المعلق ليس تسديداً. تفاصيل طلب وليست إيصال قبض جديداً." : "تفاصيل الطلب المحفوظة.",
  }, "80mm").replace("<body>", '<body class="research-order-thermal">').replace("</head>", `<style>
    .research-order-thermal .ajn-r .section{break-inside:auto}
    .research-order-thermal .ajn-r .block-title{break-after:avoid}
    .research-order-thermal .ajn-r .fact{grid-template-columns:minmax(0,45%) minmax(0,55%);break-inside:avoid}
    .research-order-thermal .ajn-r .section p{orphans:3;widows:3}
  </style></head>`);
}
