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
 * compact, one article per copy. Its caller uses the existing image/font-ready popup
 * helper; this builder never calls print. Facts that were not recorded are left out. */
export function buildTransportReceiptHtml(data:TransportReceiptData,input:TransportReceiptSettings,copies:number,brandInput?:ReceiptBrand):string{
  if(!Number.isInteger(copies)||copies<1||copies>5)throw new Error("عدد النسخ يجب أن يكون من 1 إلى 5");
  if(!["customer","driver","internal"].includes(data.variant))throw new Error("نوع نسخة وصل النقل غير صالح");
  const settings=normalizeTransportReceiptSettings(input);
  const amount=data.variant==="driver"?null:data.amount;
  if(amount&&(!Number.isFinite(amount.value)||amount.value<0))throw new Error("مبلغ وصل النقل غير صالح");
  const base=brandInput??currentReceiptBrand();
  const brand:ReceiptBrand={...base,logoUrl:settings.showLogo?base.logoUrl:"",name:settings.showCompanyName?base.name:"",tagline:settings.showCompanyName?base.tagline:""};
  // A short slip: only what was recorded, related facts on one line. Empty facts are left out.
  // Each part is its own bidi isolate (FSI…PDI), so a plate like «26 A68498» keeps its order next to Arabic.
  const join=(...parts:unknown[])=>parts.map(part=>part==null?"":String(part).trim()).filter(Boolean).map(part=>`\u2068${part}\u2069`).join(" · ");
  const title=data.variant==="driver"?"وصل السائق":"وصل نقل";
  const copyLabel={customer:"نسخة العميل",driver:"نسخة السائق",internal:"نسخة المكتب"}[data.variant];
  const route=[settings.showOrigin&&data.origin?`من ${data.origin}`:"",settings.showDestination&&data.destination?`إلى ${data.destination}`:""].filter(Boolean).join(" ");
  const time=[data.departureTime,data.expectedArrivalTime].filter(Boolean).join(" ← ");
  const facts:ReceiptFact[]=[
    {label:"رقم الوصل",value:data.receiptReference,icon:"receipt"},
    ...(settings.showBookingNumber&&data.bookingNumber&&!data.receiptReference.startsWith(data.bookingNumber)?[{label:"رقم الحجز",value:data.bookingNumber,icon:"hash" as const}]:[]),
    ...(settings.showCustomer?[{label:"العميل",value:join(data.customerName,data.customerPhone),icon:"user" as const}]:[]),
    ...(route?[{label:"المسار",value:route,icon:"pin" as const}]:[]),
    ...(settings.showDateTime?[{label:"الموعد",value:join(data.transportDate,time),icon:"calendar" as const}]:[]),
    ...(settings.showVehicle?[{label:"المركبة",value:join(data.vehicleName,data.vehiclePlate),icon:"car" as const}]:[]),
    ...(settings.showDriver||settings.showDriverPhone?[{label:"السائق",value:join(settings.showDriver?data.driverName:null,settings.showDriverPhone?data.driverPhone:null),icon:"id" as const}]:[]),
    ...(settings.showTransportType&&data.transportType?[{label:"النوع",value:data.transportType,icon:"truck" as const}]:[]),
    ...(data.assignedWork?[{label:"العمل",value:data.assignedWork,icon:"note" as const,wide:true}]:[]),
  ];
  const receipt=(index:number)=>`<article class="transport-receipt" data-copy="${index}">${brandedReceiptBody({
    documentTitle:`${title} ${data.receiptReference}`,
    title,
    icon:"truck",
    copyLabel:`${copyLabel}${copies>1?` · ${index}/${copies}`:""}`,
    facts,
    compact:true,
    notes:settings.showNotes&&data.notes?data.notes:null,
    totals:settings.showAmount&&amount?[{label:amount.label,value:formatCurrency(amount.value),tone:"strong"}]:[],
    totalsNote:settings.showAmount&&amount?"ليست إثبات دفع":null,
    qr:settings.showQr&&data.qrUrl?{url:data.qrUrl,caption:"صفحة النقل"}:null,
    hideQr:!(settings.showQr&&data.qrUrl),
  },"80mm",brand)}</article>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${receiptEsc(title)} ${receiptEsc(data.receiptReference)}</title><style>
    @page { size: 80mm auto; margin: 0; }
    *{box-sizing:border-box}html,body{margin:0;padding:0;width:80mm;color:#000;background:#fff}
    .transport-receipt{width:80mm;padding:1mm 4mm;overflow-wrap:anywhere;break-after:page}.transport-receipt:last-child{break-after:auto}
    .transport-receipt .ajn-r{padding:0}
    @media print{html,body{width:80mm;margin:0!important;padding:0!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style><style id="transport-measured-page"></style></head><body>${Array.from({length:copies},(_,i)=>receipt(i+1)).join("")}
    <script>window.addEventListener('beforeprint',function(){var pages=Array.from(document.querySelectorAll('.transport-receipt'));var height=Math.max.apply(null,pages.map(function(page){return page.getBoundingClientRect().height}));if(Number.isFinite(height)&&height>0){document.getElementById('transport-measured-page').textContent='@page { size:80mm '+Math.ceil(height*25.4/96+1)+'mm; margin:0; }'}});</script>
    </body></html>`;
}
