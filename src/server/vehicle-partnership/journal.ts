import {sql} from "drizzle-orm";
import {parseMoney} from "../../lib/vehicle-partnership/money";
import {partnershipId} from "./agreements";
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";
const conflict=(message:string):never=>{throw new PartnershipRepositoryError(message,409,"CONFLICT");};
const ACCOUNTS={
 "VP-INTERNAL":{name:"حساب مقابل لتخصيصات النقل الداخلي",type:"asset"},
 "VP-PAYABLE":{name:"استحقاقات شراكة المركبة من النقل الداخلي",type:"liability"},
 "VP-ACTIVITY":{name:"بيان نشاط النقل الخارجي المعتمد",type:"memo"},
 "VP-ATTRIBUTION":{name:"مقابل إسناد إيراد النقل الأصلي",type:"memo"},
 "VP-ADVANCE":{name:"سلف الشركاء المستردة",type:"liability"},
 "VP-DRIVER":{name:"أجور السائقين المستحقة عن الرحلات",type:"liability"},
 "VP-CAPITAL":{name:"مساهمات رأس مال شراكة المركبة",type:"equity"},
 "VP-CAPITAL-CLEAR":{name:"تسوية المساهمات المعلنة قبل قبضها",type:"asset"},
 "VP-INVESTMENT":{name:"استثمارات رأسمالية لشراكة المركبة",type:"asset"},
 "VP-PROFIT":{name:"أرباح شراكة المركبة المعتمدة للتوزيع",type:"liability"},
 "VP-LOSS":{name:"خسائر الشراكة المثبتة على أطرافها الأصلية",type:"asset"},
 "VP-RESERVE":{name:"احتياطي شراكة المركبة المعتمد",type:"equity"},
 "VP-RESULT":{name:"تخصيص نتيجة نشاط الشراكة من المصادر الأصلية",type:"equity"},
 "VP-COST-CLEAR":{name:"تسوية كلفة نشاط شراكة المركبة",type:"equity"},
 "5000":{name:"المصروفات التشغيلية",type:"expense"},
} as const;
/** Server-owned chart entries; no account identifiers accepted from a form. */
export async function partnershipAccount(tx:PartnershipExecutor,code:string):Promise<number>{
 if(!Object.hasOwn(ACCOUNTS,code))conflict("حساب قيد الشراكة غير معتمد لهذا المصدر");
 const spec=ACCOUNTS[code as keyof typeof ACCOUNTS];
 const read=async()=>partnershipRows(await tx.execute(sql`/* vp_chart_account */ SELECT id,code,account_type,is_active FROM financial_accounts WHERE code=${code} FOR UPDATE`));
 let rows=await read();
 if(!rows.length){await tx.execute(sql`INSERT INTO financial_accounts (code,name_ar,account_type,department,is_system,is_active) VALUES (${code},${spec.name},${spec.type},'transportation',true,true) ON CONFLICT (code) DO NOTHING RETURNING id`);rows=await read();}
 if(rows.length!==1||rows[0].account_type!==spec.type||rows[0].is_active!==true)conflict("حساب الشراكة المحاسبي مفقود أو تصنيفه غير مطابق؛ راجع دليل الحسابات");
 return partnershipId(Number(rows[0].id));
}
export async function provePartnershipJournal(tx:PartnershipExecutor,id:number,amount:string,debit:string,credit:string):Promise<Record<string,unknown>[]>{
 const rows=partnershipRows(await tx.execute(sql`/* vp_activity_journal_proof */ SELECT j.id,j.account_id,j.entry_side,j.amount::text,a.code FROM financial_ledger_entries j JOIN financial_accounts a ON a.id=j.account_id WHERE j.transaction_id=${id} ORDER BY j.id LIMIT 3`));
 if(parseMoney(amount)===0n){if(rows.length)conflict("القيد الصفري لا يطابق المصدر الأصلي");return rows;}
 if(rows.length!==2||!rows.some(row=>row.entry_side==="debit"&&row.code===debit&&parseMoney(String(row.amount))===parseMoney(amount))||!rows.some(row=>row.entry_side==="credit"&&row.code===credit&&parseMoney(String(row.amount))===parseMoney(amount)))conflict("القيد المنفذ لا يطابق إثبات مصدر الشراكة");
 return rows;
}
