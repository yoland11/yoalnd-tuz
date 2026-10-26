import {formatMoney,parseMoney} from "./money";
import {PartnershipValidationError} from "./types";

export type EntitlementConversion={key:string;amount:string;status:"pending"|"approved"|"rejected"|"cancelled"|"reversed"};
export type ConversionPayment={key:string;financialKey:string;financialAmount:string;amount:string;paid:string;reserved:string};
export type ConversionCoverage=ConversionPayment & {conversionKey:string};
export type ConversionInput={totalAmount:string;conversions:readonly EntitlementConversion[];direct:readonly ConversionPayment[];coverage:readonly ConversionCoverage[]};
function fail(message:string):never{throw new PartnershipValidationError(message);}
function identity(value:string){if(typeof value!=="string"||!value||value.trim()!==value||value.length>240)fail("مرجع تحويل الاستحقاق أو حركته غير صالح");return value;}
function money(value:string){if(typeof value!=="string")fail("مبلغ الاستحقاق يجب أن يبقى نصاً عشرياً دقيقاً");return parseMoney(value);}
/** Pure accounting amounts, NOT a wallet and NOT posting authorization. The
 * canonical adapter must prove original rights, approved closing sources and
 * actual financial/reversal identities before supplying these rows.
 *
 * Cash mapped to an approved noncash conversion is INSIDE that conversion.
 * Counting it as both new raw settlement and conversion would extinguish/pay
 * the same original internal entitlement twice. Pending coverage similarly
 * holds conversion coverage, not a second raw cash-payment entitlement. */
export function derivePartnershipConversion(input:ConversionInput){
 const total=money(input.totalAmount);
 if(input.conversions.length+input.direct.length+input.coverage.length>10000)fail("تجاوز سجل تحويلات الاستحقاق حد المراجعة الآمن");
 const conversions=new Map<string,{amount:bigint;status:EntitlementConversion["status"];paid:bigint;reserved:bigint}>();
 let converted=0n,pendingConversion=0n;
 for(const row of input.conversions){
  const key=identity(row.key),amount=money(row.amount);
  if(conversions.has(key))fail("مرجع تحويل استحقاق مكرر");
  if(amount<=0n||!["pending","approved","rejected","cancelled","reversed"].includes(row.status))fail("مبلغ تحويل الاستحقاق أو حالته غير صالح");
  conversions.set(key,{amount,status:row.status,paid:0n,reserved:0n});
  if(row.status==="approved")converted+=amount;
  if(row.status==="pending")pendingConversion+=amount;
 }
 const seen=new Set<string>(),financial=new Map<string,{amount:bigint;allocated:bigint}>();
 function payment(row:ConversionPayment){
  const key=identity(row.key),financialKey=identity(row.financialKey);
  if(seen.has(key))fail("مرجع توزيع مالي مكرر");seen.add(key);
  const amount=money(row.amount),paid=money(row.paid),reserved=money(row.reserved),financialAmount=money(row.financialAmount);
  if(amount<=0n||financialAmount<=0n||paid+reserved>amount)fail("المدفوع أو المحجوز يتجاوز مبلغ التوزيع الأصلي");
  const prior=financial.get(financialKey);
  if(prior&&prior.amount!==financialAmount)fail("مبالغ متعارضة للحركة المالية نفسها");
  const allocated=(prior?.allocated??0n)+amount;if(allocated>financialAmount)fail("توزيع يتجاوز أصل الحركة المالية؛ لا يمكن استخدام الدفع مرتين");
  financial.set(financialKey,{amount:financialAmount,allocated});return {paid,reserved};
 }
 let directPaid=0n,directReserved=0n;
 for(const row of input.direct){const p=payment(row);directPaid+=p.paid;directReserved+=p.reserved;}
 let coveragePaid=0n,coverageReserved=0n;
 for(const row of input.coverage){
  const p=payment(row),conversion=conversions.get(identity(row.conversionKey));
  if(!conversion)fail("مرجع تحويل تغطية الصرف غير موجود");
  if(conversion.status!=="approved"&&(p.paid>0n||p.reserved>0n))fail("تحويل غير معتمد أو معكوس عليه صرف منفذ أو معلق");
  conversion.paid+=p.paid;conversion.reserved+=p.reserved;
  if(conversion.paid+conversion.reserved>conversion.amount)fail("تغطية الصرف تتجاوز مبلغ التحويل المعتمد");
  coveragePaid+=p.paid;coverageReserved+=p.reserved;
 }
 if(directPaid+directReserved+converted+pendingConversion>total)fail("الدفع أو التحويلات والمبالغ المعلقة تتجاوز الاستحقاق الأصلي");
 const paid=directPaid+coveragePaid,nonCash=converted-coveragePaid,remaining=total-directPaid-converted;
 const reserved=directReserved+pendingConversion;
 if(paid+nonCash+remaining!==total)throw new Error("Partnership entitlement conversion does not reconcile");
 return {
  totalAmount:formatMoney(total),approvedPaidAmount:formatMoney(paid),nonCashSettledAmount:formatMoney(nonCash),
  remainingAmount:formatMoney(remaining),reservedAmount:formatMoney(reserved),availableAmount:formatMoney(remaining-reserved),
  conversionAmount:formatMoney(converted),pendingConversionAmount:formatMoney(pendingConversion),
  conversionCashPaidAmount:formatMoney(coveragePaid),conversionCashReservedAmount:formatMoney(coverageReserved),
  availableCoverageAmount:formatMoney(converted-coveragePaid-coverageReserved),
 };
}
