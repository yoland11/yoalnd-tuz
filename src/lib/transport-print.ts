import { printHtmlDocument } from "@/components/print/print-format-dialog";

function bounded<T>(work:Promise<T>,message:string):Promise<T>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(message)),8000);
    work.then(value=>{clearTimeout(timer);resolve(value)},cause=>{clearTimeout(timer);reject(cause)});
  });
}
async function receiptAssets(document:Document){
  await bounded(Promise.resolve(document.fonts?.ready),"تعذر تحميل خط وصل النقل؛ أعد المحاولة");
  await Promise.all(Array.from(document.images).map(image=>{
    if(image.complete)return image.naturalWidth>0?Promise.resolve():Promise.reject(new Error("تعذر تحميل صورة في وصل النقل؛ راجع الصور وأعد المحاولة"));
    return bounded(new Promise<void>((resolve,reject)=>{
      image.addEventListener("load",()=>image.naturalWidth>0?resolve():reject(new Error("تعذر تحميل صورة وصل النقل")),{once:true});
      image.addEventListener("error",()=>reject(new Error("تعذر تحميل صورة وصل النقل")),{once:true});
    }),"تأخر تحميل صور وصل النقل؛ أعد المحاولة");
  }));
}
/** One synchronous popup preserves mobile browser activation. Use the ORIGINAL
 * AJN printer after assets and server-authorized audit/revision checks succeed. */
export async function printTransportDocument(html:string,recordRequest:()=>Promise<void>):Promise<void>{
  const popup=window.open("","_blank","width=440,height=760");
  if(!popup)throw new Error("تعذر فتح نافذة الطباعة؛ اسمح بالنوافذ المنبثقة وأعد المحاولة");
  try{
    popup.document.open();popup.document.write(html);popup.document.close();
    await receiptAssets(popup.document);
    if(popup.closed)throw new Error("أُغلقت نافذة الطباعة قبل إرسال الطلب");
    await recordRequest();
    if(popup.closed)throw new Error("أُغلقت نافذة الطباعة؛ سُجّل الطلب فقط ولم يتأكد خروج ورقة");
    printHtmlDocument(html,{thermal:true,popup});
  }catch(cause){popup.close();throw cause}
}
