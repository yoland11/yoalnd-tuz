/** Server-authorized display data only. No raw booking JSON or bearer tokens. */
import { formatCurrency } from "./money";
import { brandedReceiptBody, receiptEsc, type ReceiptFact } from "./branded-receipt";
import { currentReceiptBrand, type ReceiptBrand } from "./receipt-brand";
export type TransportReceiptVariant = "customer" | "driver" | "internal";
export type TransportReceiptData = {
  sourceRevision?: number;
  receiptReference: string;
  bookingNumber: string;
  variant: TransportReceiptVariant;
  company: { name: string | null; phone: string | null; logoUrl: string | null };
  customerName: string | null;
  customerPhone: string | null;
  transportType: string | null;
  origin: string | null;
  destination: string | null;
  transportDate: string | null;
  departureTime: string | null;
  expectedArrivalTime: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehicleName: string | null;
  vehiclePlate: string | null;
  assignedWork: string | null;
  notes: string | null;
  status: string | null;
  amount: { value: number; label: string } | null;
  /** No authoritative standalone driver settlement currently exists. */
  driverSettlement: null;
  qrUrl: string | null;
  qrDataUrl?: string | null;
};

export const DEFAULT_TRANSPORT_RECEIPT_SETTINGS={
  showLogo:true,showCompanyName:true,showCustomer:true,showBookingNumber:true,showTransportType:true,
  showOrigin:true,showDestination:true,showDriver:true,showDriverPhone:true,showVehicle:true,
  showDateTime:true,showAmount:true,showNotes:true,showQr:true,
};
export type TransportReceiptSettings=typeof DEFAULT_TRANSPORT_RECEIPT_SETTINGS;
export function normalizeTransportReceiptSettings(input:unknown):TransportReceiptSettings{
  if(input==null)return {...DEFAULT_TRANSPORT_RECEIPT_SETTINGS};
  if(typeof input!=="object"||Array.isArray(input))throw new Error("إعدادات وصل النقل غير صالحة");
  const settings={...DEFAULT_TRANSPORT_RECEIPT_SETTINGS};
  for(const [key,value] of Object.entries(input)){
    if(!Object.hasOwn(settings,key)||typeof value!=="boolean")throw new Error("حقل إعدادات وصل النقل غير صالح");
    settings[key as keyof TransportReceiptSettings]=value;
  }
  return settings;
}
/** Standalone 80mm composition on the branded receipt (src/lib/branded-receipt.ts),
 * one article per copy. Its caller uses the existing image/font-ready popup
 * helper; this builder never calls print. Missing facts print «غير مسجل». */
export function buildTransportReceiptHtml(data:TransportReceiptData,input:TransportReceiptSettings,copies:number,brandInput?:ReceiptBrand):string{
  if(!Number.isInteger(copies)||copies<1||copies>5)throw new Error("عدد النسخ يجب أن يكون من 1 إلى 5");
  if(!["customer","driver","internal"].includes(data.variant))throw new Error("نوع نسخة وصل النقل غير صالح");
  const settings=normalizeTransportReceiptSettings(input);
  const amount=data.variant==="driver"?null:data.amount;
  if(amount&&(!Number.isFinite(amount.value)||amount.value<0))throw new Error("مبلغ وصل النقل غير صالح");
  const base=brandInput??currentReceiptBrand();
  const brand:ReceiptBrand={...base,logoUrl:settings.showLogo?base.logoUrl:"",name:settings.showCompanyName?base.name:"",tagline:settings.showCompanyName?base.tagline:""};
  const shown=(value:unknown)=>value==null||value===""?"غير مسجل":value;
  const title=data.variant==="driver"?"وصل السائق":"وصل نقل";
  const copyLabel={customer:"نسخة العميل",driver:"نسخة السائق",internal:"نسخة المكتب"}[data.variant];
  const facts:ReceiptFact[]=[
    {label:"رقم الوصل",value:data.receiptReference,icon:"receipt"},
    ...(settings.showBookingNumber?[{label:"رقم الحجز",value:shown(data.bookingNumber),icon:"hash" as const}]:[]),
    ...(settings.showCustomer?[{label:"العميل",value:shown(data.customerName),icon:"user" as const},{label:"هاتف التواصل",value:shown(data.customerPhone),icon:"phone" as const}]:[]),
    ...(settings.showTransportType?[{label:"نوع النقل",value:shown(data.transportType),icon:"truck" as const}]:[]),
    ...(settings.showOrigin?[{label:"من",value:shown(data.origin),icon:"pin" as const}]:[]),
    ...(settings.showDestination?[{label:"إلى",value:shown(data.destination),icon:"pin" as const}]:[]),
    ...(settings.showDriver?[{label:"السائق",value:shown(data.driverName),icon:"id" as const}]:[]),
    ...(settings.showDriverPhone?[{label:"هاتف السائق",value:shown(data.driverPhone),icon:"phone" as const}]:[]),
    ...(settings.showVehicle?[{label:"المركبة",value:shown(data.vehicleName),icon:"car" as const},{label:"رقم المركبة",value:shown(data.vehiclePlate),icon:"hash" as const}]:[]),
    ...(settings.showDateTime?[{label:"تاريخ النقل",value:shown(data.transportDate),icon:"calendar" as const},{label:"وقت الانطلاق",value:shown(data.departureTime),icon:"clock" as const},{label:"الوصول المتوقع",value:shown(data.expectedArrivalTime),icon:"clock" as const}]:[]),
    ...(data.assignedWork?[{label:"العمل المكلف",value:data.assignedWork,icon:"note" as const,wide:true}]:[]),
  ];
  const receipt=(index:number)=>`<article class="transport-receipt" data-copy="${index}">${brandedReceiptBody({
    documentTitle:`${title} ${data.receiptReference}`,
    title,
    icon:"truck",
    copyLabel:`${copyLabel}${copies>1?` · ${index}/${copies}`:""}`,
    facts,
    sections:[
      ...(settings.showNotes?[{title:"ملاحظات النقل",text:String(shown(data.notes))}]:[]),
      ...(data.variant==="driver"?[{title:"مستحق السائق",text:"غير مسجل في تسوية مستقلة"}]:[]),
    ],
    totals:settings.showAmount&&amount?[{label:amount.label,value:formatCurrency(amount.value),tone:"strong"}]:[],
    totalsNote:settings.showAmount&&amount?"أجرة خدمة النقل — ليست إثبات دفع":null,
    qr:settings.showQr&&data.qrUrl?{url:data.qrUrl,caption:"صفحة النقل"}:null,
    hideQr:!(settings.showQr&&data.qrUrl),
  },"80mm",brand)}</article>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${receiptEsc(title)} ${receiptEsc(data.receiptReference)}</title><style>
    @page { size: 80mm auto; margin: 0; }
    *{box-sizing:border-box}html,body{margin:0;padding:0;width:80mm;color:#000;background:#fff}
    .transport-receipt{width:80mm;padding:4mm;overflow-wrap:anywhere;break-after:page}.transport-receipt:last-child{break-after:auto}
    .transport-receipt .ajn-r{padding:0}
    @media print{html,body{width:80mm;margin:0!important;padding:0!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style><style id="transport-measured-page"></style></head><body>${Array.from({length:copies},(_,i)=>receipt(i+1)).join("")}
    <script>window.addEventListener('beforeprint',function(){var pages=Array.from(document.querySelectorAll('.transport-receipt'));var height=Math.max.apply(null,pages.map(function(page){return page.getBoundingClientRect().height}));if(Number.isFinite(height)&&height>0){document.getElementById('transport-measured-page').textContent='@page { size:80mm '+Math.ceil(height*25.4/96+1)+'mm; margin:0; }'}});</script>
    </body></html>`;
}
