import { useId,useMemo,useState } from "react";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Printer,Settings2,RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter } from "@/components/ui/dialog";
import { Field,FieldGroup,FieldLabel,FieldDescription,FieldSet,FieldLegend } from "@/components/ui/field";
import { Select,SelectTrigger,SelectValue,SelectContent,SelectGroup,SelectItem } from "@/components/ui/select";
import { ToggleGroup,ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert,AlertTitle,AlertDescription } from "@/components/ui/alert";
import { Empty,EmptyHeader,EmptyTitle,EmptyDescription,EmptyContent } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch,apiErrorMessage } from "@/views/admin/_lib";
import type { TransportReference,TransportPlanView } from "@/lib/booking-transport-plan";
import { buildTransportReceiptHtml,DEFAULT_TRANSPORT_RECEIPT_SETTINGS,type TransportReceiptData,type TransportReceiptSettings,type TransportReceiptVariant } from "@/lib/transport-receipt";
import { printTransportDocument } from "@/lib/transport-print";

export type TransportPlanResponse={
  transportation:Record<string,unknown>|null;
  transportPlan:TransportPlanView;
  resourceOccupancy?:{start:string;end:string}|null;
  assignmentOptions?:{vehicles:Array<{id:number;name:string;plateNumber?:string|null}>;drivers:Array<{id:number;fullName?:string|null}>};
  capabilities:{canEdit:boolean;canPrintFinancial:boolean};
};
export type TransportReceiptReference=TransportReference&{tripId?:string};
const settingLabels:Record<keyof TransportReceiptSettings,string>={showLogo:"شعار الشركة",showCompanyName:"اسم الشركة",showCustomer:"اسم العميل وهاتفه",showBookingNumber:"رقم الحجز",showTransportType:"نوع النقل",showOrigin:"موقع الانطلاق",showDestination:"موقع الوصول",showDriver:"اسم السائق",showDriverPhone:"هاتف السائق",showVehicle:"المركبة ورقمها",showDateTime:"التاريخ وأوقات النقل",showAmount:"مبلغ النقل",showNotes:"ملاحظات النقل",showQr:"رمز QR المحمي"};

export function TransportReceiptControls({variant,canFinancial,copies,onVariant,onCopies,disabled}:{variant:TransportReceiptVariant;canFinancial:boolean;copies:string;onVariant:(variant:TransportReceiptVariant)=>void;onCopies:(copies:string)=>void;disabled:boolean}){
  const id=useId(),count=Number(copies),invalid=!Number.isInteger(count)||count<1||count>5;
  return <FieldGroup>
    <Field><FieldLabel id={`${id}-variant`}>نوع النسخة</FieldLabel><ToggleGroup type="single" variant="outline" value={variant} onValueChange={value=>{if(["customer","driver","internal"].includes(value))onVariant(value as TransportReceiptVariant)}} aria-labelledby={`${id}-variant`} disabled={disabled} className="flex-wrap justify-start">
      <ToggleGroupItem value="customer" disabled={!canFinancial}>نسخة العميل</ToggleGroupItem><ToggleGroupItem value="driver">نسخة السائق</ToggleGroupItem><ToggleGroupItem value="internal">نسخة المكتب</ToggleGroupItem>
    </ToggleGroup><FieldDescription>نسخة السائق لا تعرض أجرة العميل. اختيار النسخة لا ينشئ دفعة.</FieldDescription></Field>
    <Field data-invalid={invalid}><FieldLabel htmlFor={`${id}-copies`}>عدد النسخ</FieldLabel><Input id={`${id}-copies`} type="number" inputMode="numeric" min={1} max={5} step={1} value={copies} onChange={event=>onCopies(event.target.value)} disabled={disabled} aria-invalid={invalid}/>{invalid?<FieldDescription>اختر عدداً صحيحاً من 1 إلى 5.</FieldDescription>:null}</Field>
  </FieldGroup>;
}
export function TransportReceiptSettingsFields({settings,onChange,disabled}:{settings:TransportReceiptSettings;onChange:(settings:TransportReceiptSettings)=>void;disabled:boolean}){
  const id=useId();
  return <FieldSet disabled={disabled}><FieldLegend>إعدادات طباعة وصل النقل</FieldLegend><FieldGroup className="gap-3">{(Object.keys(settingLabels) as Array<keyof TransportReceiptSettings>).map(key=><Field key={key} orientation="horizontal" data-disabled={disabled}><Checkbox id={`${id}-${key}`} checked={settings[key]} onCheckedChange={checked=>onChange({...settings,[key]:checked===true})} disabled={disabled}/><FieldLabel htmlFor={`${id}-${key}`}>{settingLabels[key]}</FieldLabel></Field>)}</FieldGroup></FieldSet>;
}
function ReceiptError({title,error,onRetry}:{title:string;error:unknown;onRetry?:()=>void}){
  return <Alert variant="destructive"><AlertTitle>{title}</AlertTitle><AlertDescription>{apiErrorMessage(error,title)}{onRetry?<Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-2">إعادة المحاولة</Button>:null}</AlertDescription></Alert>;
}
export function TransportReceiptDialog({reference,onClose}:{reference:TransportReceiptReference|null;onClose:()=>void}){
  return reference?<ReceiptSession key={`${reference.source}:${reference.id}:${reference.tripId??""}`} reference={reference} onClose={onClose}/>:null;
}
/** Standalone history action; dialog stays mounted after its action completes. */
export function TransportReceiptAction({reference,label="طباعة وصل نقل 80mm"}:{reference:TransportReceiptReference;label?:string}){
  const [open,setOpen]=useState(false);
  return <><Button type="button" variant="outline" size="sm" onClick={()=>setOpen(true)}><Printer data-icon="inline-start"/>{label}</Button><TransportReceiptDialog reference={open?reference:null} onClose={()=>setOpen(false)}/></>;
}
function ReceiptSession({reference,onClose}:{reference:TransportReceiptReference;onClose:()=>void}){
  const queryClient=useQueryClient(),id=useId();
  const base=`/admin/booking-operations/${reference.source}/${reference.id}/transportation`;
  const [tripChoice,setTripChoice]=useState(reference.tripId??"");
  const [variantChoice,setVariantChoice]=useState<TransportReceiptVariant|null>(null);
  const [copies,setCopies]=useState("1"),[showSettings,setShowSettings]=useState(false),[draft,setDraft]=useState<TransportReceiptSettings|null>(null);
  const [printing,setPrinting]=useState(false),[printError,setPrintError]=useState<unknown>(null),[requested,setRequested]=useState(false),[frameHeight,setFrameHeight]=useState(650);
  const transport=useQuery<TransportPlanResponse>({queryKey:["admin","booking-operations",reference.source,reference.id,"transportation"],queryFn:()=>adminFetch(base),retry:false,staleTime:0});
  const preferences=useQuery<{settings:TransportReceiptSettings;canManage:boolean}>({queryKey:["transport-receipt-settings"],queryFn:()=>adminFetch(`${base}?transportAction=settings`),retry:false});
  const trips=transport.data?.transportPlan.trips;
  const tripId=tripChoice||(trips?.length===1?trips[0].id:"");
  const variant=variantChoice??(transport.data?.capabilities.canPrintFinancial?"customer":"driver");
  const receipt=useQuery<TransportReceiptData>({queryKey:["transport-receipt",reference.source,reference.id,tripId,variant],queryFn:()=>adminFetch(`${base}?receipt=1&tripId=${encodeURIComponent(tripId)}&variant=${variant}`),enabled:!!tripId&&!transport.isError&&!!transport.data,retry:false,staleTime:0});
  const settings=draft??preferences.data?.settings??DEFAULT_TRANSPORT_RECEIPT_SETTINGS;
  const validCopies=Number.isInteger(Number(copies))&&Number(copies)>=1&&Number(copies)<=5;
  const readyReceipt=!receipt.isFetching&&!receipt.isError&&receipt.data?.variant===variant?receipt.data:null;
  const preview=useMemo(()=>{
    if(!readyReceipt||!validCopies)return {html:"",error:null};
    try{return {html:buildTransportReceiptHtml(readyReceipt,settings,Number(copies)),error:null}}catch(error){return {html:"",error}}
  },[readyReceipt,settings,copies,validCopies]);
  const savePreferences=useMutation({mutationFn:(reset:boolean)=>adminFetch<{settings:TransportReceiptSettings;canManage:boolean}>(`${base}?transportAction=settings`,{method:"PUT",body:JSON.stringify(reset?{reset:true}:{settings})}),onSuccess:value=>{setDraft(null);queryClient.setQueryData(["transport-receipt-settings"],value)}});
  const reload=()=>{setPrintError(null);setRequested(false);void transport.refetch();void preferences.refetch();if(tripId)void receipt.refetch()};
  const canPrint=!!preview.html&&!preview.error&&!transport.isError&&!transport.isFetching&&!preferences.isError&&!preferences.isFetching&&!!preferences.data&&validCopies;
  const print=async()=>{
    if(!canPrint||!readyReceipt||printing)return;
    setPrinting(true);setPrintError(null);setRequested(false);
    try{
      await printTransportDocument(preview.html,()=>adminFetch(`${base}?transportAction=print-request`,{method:"POST",body:JSON.stringify({tripId,variant,copies:Number(copies),expectedRevision:readyReceipt.sourceRevision??0})}));
      setRequested(true);
    }catch(error){setPrintError(error)}finally{setPrinting(false)}
  };
  const busy=printing||savePreferences.isPending;
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose()}}><DialogContent dir="rtl" className="flex w-[min(calc(100%-1rem),58rem)] max-w-4xl flex-col overflow-hidden"><DialogHeader className="shrink-0"><DialogTitle>معاينة وصل النقل — 80mm</DialogTitle><DialogDescription>اختر عملية نقل واحدة. الطباعة لا تسجّل دفعة ولا تغيّر حالة النقل.</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto">
    {transport.isError?<ReceiptError title="تعذر قراءة عمليات النقل" error={transport.error} onRetry={reload}/>:transport.isPending||transport.isFetching?<div aria-label="تحميل عمليات النقل"><Skeleton className="h-24 w-full"/></div>:trips?.length===0?<Empty><EmptyHeader><EmptyTitle>لا توجد عملية نقل مرتبطة بهذا الحجز.</EmptyTitle><EmptyDescription>أضف بيانات النقل من بطاقة خدمة النقل الموجودة في الحجز.</EmptyDescription></EmptyHeader>{transport.data?.capabilities.canEdit?<EmptyContent><Button asChild variant="outline"><Link href={`/admin/bookings/${reference.source}/${reference.id}?tab=overview#ajn-transport-card`} onClick={onClose}>إضافة تفاصيل النقل</Link></Button></EmptyContent>:null}</Empty>:
    <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><section className="flex min-w-0 flex-col gap-5" aria-label="خيارات وصل النقل">
      {trips&&trips.length>1?<Field><FieldLabel htmlFor={`${id}-trip`}>عملية النقل</FieldLabel><Select dir="rtl" value={tripId} disabled={busy} onValueChange={value=>{setTripChoice(value);setRequested(false);setPrintError(null)}}><SelectTrigger id={`${id}-trip`}><SelectValue placeholder="اختر عملية النقل"/></SelectTrigger><SelectContent><SelectGroup>{trips.map(trip=><SelectItem key={trip.id} value={trip.id}>رحلة {trip.sequence}{trip.transportType?` · ${trip.transportType}`:""}{trip.destination?` · ${trip.destination}`:""}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>:null}
      <TransportReceiptControls variant={variant} canFinancial={!!transport.data?.capabilities.canPrintFinancial} copies={copies} onCopies={value=>{setCopies(value);setRequested(false)}} onVariant={value=>{setVariantChoice(value);setRequested(false);setPrintError(null)}} disabled={busy}/>
      {preferences.isError?<ReceiptError title="تعذر قراءة إعدادات الوصل" error={preferences.error} onRetry={()=>void preferences.refetch()}/>:null}
      {preferences.data?.canManage?<><Button type="button" variant="outline" onClick={()=>setShowSettings(!showSettings)} aria-expanded={showSettings} disabled={busy}><Settings2 data-icon="inline-start"/>إعدادات الطباعة</Button>{showSettings?<><TransportReceiptSettingsFields settings={settings} onChange={setDraft} disabled={busy}/><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy||!draft} onClick={()=>savePreferences.mutate(false)}>حفظ الإعدادات</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>savePreferences.mutate(true)}><RotateCcw data-icon="inline-start"/>استعادة الافتراضي</Button></div>{savePreferences.isError?<ReceiptError title="تعذر حفظ إعدادات الوصل" error={savePreferences.error}/>:null}</>:null}</>:null}
    </section><section aria-label="معاينة ورقة 80mm" className="flex min-w-0 flex-col items-center gap-3 overflow-auto rounded-xl border border-border bg-muted/40 p-2 max-h-[65dvh]">
      {receipt.isError?<ReceiptError title="تعذر تجهيز وصل النقل" error={receipt.error} onRetry={()=>void receipt.refetch()}/>:receipt.isFetching?<Skeleton className="h-80 w-full"/>:preview.error?<ReceiptError title="تعذر رسم وصل النقل" error={preview.error}/>:preview.html?<iframe title="وصل النقل — معاينة" sandbox="allow-same-origin" srcDoc={preview.html.replace(/<script>[\s\S]*?<\/script>/g,"")} style={{width:"80mm",maxWidth:"100%",height:frameHeight,border:0,background:"white",flexShrink:0}} onLoad={event=>{const height=event.currentTarget.contentDocument?.body.scrollHeight;if(height)setFrameHeight(height+4)}}/>:<Empty><EmptyHeader><EmptyTitle>اختر عملية النقل لعرض الوصل</EmptyTitle><EmptyDescription>كل وصل يخص رحلة واحدة فقط.</EmptyDescription></EmptyHeader></Empty>}
    </section></div>}
    {printError?<ReceiptError title="تعذر إرسال وصل النقل للطباعة" error={printError}/>:null}
    {requested?<Alert><AlertTitle>تم فتح نافذة الطباعة</AlertTitle><AlertDescription>سُجّل طلب الطباعة فقط. تأكد من اختيار ورق 80mm ومن خروج الورقة من الطابعة.</AlertDescription></Alert>:null}
    </div>
    <DialogFooter className="shrink-0"><Button type="button" disabled={!canPrint||busy} onClick={()=>void print()}><Printer data-icon="inline-start"/>{printing?"تجهيز الطباعة…":"طباعة"}</Button><Button type="button" variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button></DialogFooter>
  </DialogContent></Dialog>;
}
