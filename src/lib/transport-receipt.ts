/** Server-authorized display data only. No raw booking JSON or bearer tokens. */
import { formatCurrency } from "./money";
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
const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
function imageUrl(value:string|null|undefined){
  if(!value)return null;
  if(/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value))return value;
  if(value.startsWith("/")&&!value.startsWith("//"))return value;
  try{const url=new URL(value);return ["https:","http:"].includes(url.protocol)&&!url.username&&!url.password?url.toString():null}catch{return null}
}
/** Standalone 80mm composition, not a modified/scaled A4 invoice. Its caller uses
 * the existing image/font-ready popup helper; this builder never calls print. */
export function buildTransportReceiptHtml(data:TransportReceiptData,input:TransportReceiptSettings,copies:number):string{
  if(!Number.isInteger(copies)||copies<1||copies>5)throw new Error("عدد النسخ يجب أن يكون من 1 إلى 5");
  if(!["customer","driver","internal"].includes(data.variant))throw new Error("نوع نسخة وصل النقل غير صالح");
  const settings=normalizeTransportReceiptSettings(input);
  const kv=(label:string,value:unknown,numeric=false)=>`<div class="line"><span>${esc(label)}</span><b class="value">${numeric?'<bdi dir="ltr">':""}${esc(value==null||value===""?"غير مسجل":value)}${numeric?"</bdi>":""}</b></div>`;
  const amount=data.variant==="driver"?null:data.amount;
  if(amount&&(!Number.isFinite(amount.value)||amount.value<0))throw new Error("مبلغ وصل النقل غير صالح");
  const logo=imageUrl(data.company.logoUrl),qr=imageUrl(data.qrDataUrl);
  const title=data.variant==="driver"?"وصل السائق":"وصل نقل";
  const copyLabel={customer:"نسخة العميل",driver:"نسخة السائق",internal:"نسخة المكتب"}[data.variant];
  const receipt=(index:number)=>`<article class="transport-receipt" data-copy="${index}">
    <header>${settings.showLogo&&logo?`<img class="logo" src="${esc(logo)}" alt="شعار الشركة">`:""}
    ${settings.showCompanyName?`<div class="company">${esc(data.company.name||"غير مسجل")}</div>`:""}
    <h1>${title}</h1><div class="copy-label">${copyLabel}${copies>1?` · ${index}/${copies}`:""}</div></header>
    ${kv("رقم الوصل",data.receiptReference,true)}
    ${settings.showBookingNumber?kv("رقم الحجز",data.bookingNumber,true):""}<hr>
    ${settings.showCustomer?kv("العميل",data.customerName)+kv("هاتف التواصل",data.customerPhone,true):""}
    ${settings.showTransportType?kv("نوع النقل",data.transportType):""}
    ${settings.showOrigin?kv("من",data.origin):""}${settings.showDestination?kv("إلى",data.destination):""}
    ${settings.showDriver?kv("السائق",data.driverName):""}${settings.showDriverPhone?kv("هاتف السائق",data.driverPhone,true):""}
    ${settings.showVehicle?kv("المركبة",data.vehicleName)+kv("رقم المركبة",data.vehiclePlate,true):""}
    ${settings.showDateTime?kv("تاريخ النقل",data.transportDate,true)+kv("وقت الانطلاق",data.departureTime,true)+kv("الوصول المتوقع",data.expectedArrivalTime,true):""}
    ${data.assignedWork?kv("العمل المكلف",data.assignedWork):""}
    ${settings.showNotes?`<section class="notes"><b>ملاحظات النقل</b><div>${esc(data.notes||"غير مسجل")}</div></section>`:""}
    ${settings.showAmount&&amount?`<section class="amount"><b>${esc(amount.label)}</b><strong><bdi dir="ltr">${esc(formatCurrency(amount.value))}</bdi></strong><small>أجرة خدمة النقل — ليست إثبات دفع</small></section>`:""}
    ${data.variant==="driver"?'<p class="settlement">مستحق السائق: غير مسجل في تسوية مستقلة</p>':""}
    ${settings.showQr&&qr?`<div class="qr"><img src="${esc(qr)}" alt="رمز صفحة النقل المحمية"></div>`:""}
    <footer>شكراً لتعاونكم${settings.showCompanyName&&data.company.name?`<b>${esc(data.company.name)}</b>`:""}${data.company.phone?`<bdi dir="ltr">${esc(data.company.phone)}</bdi>`:""}</footer>
  </article>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} ${esc(data.receiptReference)}</title><style>
    @page { size: 80mm auto; margin: 0; }
    *{box-sizing:border-box}html,body{margin:0;padding:0;width:80mm;color:#000;background:#fff;font-family:Tahoma,Arial,sans-serif;font-size:12px;line-height:1.5}
    .transport-receipt{width:80mm;padding:4mm;overflow-wrap:anywhere;break-after:page}.transport-receipt:last-child{break-after:auto}header,footer{text-align:center}h1{font-size:22px;margin:3px 0}.company{font-size:16px;font-weight:800}.copy-label{font-size:10px}.logo{display:block;max-width:42mm;max-height:15mm;margin:0 auto 2mm;filter:grayscale(1)}
    .line{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:2mm;padding:1mm 0}.line>*{min-width:0}.value{font-weight:600}.line bdi{unicode-bidi:isolate}hr{border:0;border-top:1px dashed #000;margin:2mm 0}.notes{border-top:1px dashed #000;margin-top:2mm;padding-top:2mm;white-space:pre-wrap}.amount{text-align:center;border-block:2px solid #000;margin-block:3mm;padding-block:2mm;break-inside:avoid}.amount strong{display:block;font-size:24px}.amount small{display:block;font-size:10px}.settlement{border-top:1px dashed #000;padding-top:2mm}.qr{text-align:center}.qr img{width:24mm;height:24mm;image-rendering:pixelated}footer{border-top:1px dashed #000;margin-top:3mm;padding-top:2mm}footer b,footer bdi{display:block}
    @media print{html,body{width:80mm;margin:0!important;padding:0!important}header,footer,.line,.qr{break-inside:avoid}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style><style id="transport-measured-page"></style></head><body>${Array.from({length:copies},(_,i)=>receipt(i+1)).join("")}
    <script>window.addEventListener('beforeprint',function(){var pages=Array.from(document.querySelectorAll('.transport-receipt'));var height=Math.max.apply(null,pages.map(function(page){return page.getBoundingClientRect().height}));if(Number.isFinite(height)&&height>0){document.getElementById('transport-measured-page').textContent='@page { size:80mm '+Math.ceil(height*25.4/96+1)+'mm; margin:0; }'}});</script>
    </body></html>`;
}
