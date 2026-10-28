import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import {canonicalPartnershipJson} from "../../lib/vehicle-partnership/canonical";
import {formatMoney,parseMoney} from "../../lib/vehicle-partnership/money";
import {validatePayoutCapacity} from "../../lib/vehicle-partnership/payout";
import type {DriverCashCoverageSource} from "./driver-cash-source";
import {partnershipRows,PartnershipRepositoryError,type PartnershipExecutor} from "./repository";

type Row=Record<string,unknown>;
type Root={id:number;vehicleId:number};
const positive=z.number().int().positive(),digest=z.string().regex(/^[a-f0-9]{64}$/);
const money=z.string().transform(v=>formatMoney(parseMoney(v)));
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v);
const schema=z.object({formatVersion:z.literal(1),mappingKey:z.string(),vehicleId:positive,partnershipId:positive,financialId:positive,settlementId:positive,entryId:positive,expenseId:positive,costFundingId:positive,accrualFinancialId:positive,amount:money,entryAmount:money,entryDate:date,transactionDate:date,paymentMethod:z.enum(["cash","transfer","pos"]),driverSourceDigest:digest,driverRequestDigest:digest,closingId:positive,revision:positive,closingDigest:digest,closingFinancialId:positive,coveredAmount:money,uncoveredAmount:money,coverage:z.array(z.object({rightId:positive,conversionAllocationId:positive,amount:money}).strict()).min(1).max(500)}).strict();
export type DriverCoverageMapping=z.infer<typeof schema>;
export const driverCoverageDigest=(value:unknown)=>createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
function conflict(message:string):never{throw new PartnershipRepositoryError(message,409,"CONFLICT");}
function object(value:unknown):Row{if(!value||typeof value!=="object"||Array.isArray(value))conflict("إثبات ربط صرف السائق غير مكتمل");return value as Row;}
export function driverCoverageKey(closingId:number,revision:number,financialId:number){
 for(const value of [closingId,revision,financialId])if(!Number.isSafeInteger(value)||value<=0)conflict("هوية ربط صرف السائق غير صالحة");
 return `vp:driver-coverage:${closingId}:r${revision}:financial:${financialId}`;
}
export function normalizeDriverCoverageMapping(value:unknown):DriverCoverageMapping{
 const parsed=schema.safeParse(value);if(!parsed.success)conflict("صيغة ربط صرف السائق لا تطابق إثباته الأصلي");const result=parsed.data;
 if(result.mappingKey!==driverCoverageKey(result.closingId,result.revision,result.financialId)||result.entryDate>result.transactionDate||parseMoney(result.amount)<=0n||parseMoney(result.entryAmount)<parseMoney(result.amount)||parseMoney(result.coveredAmount)<=0n||parseMoney(result.coveredAmount)+parseMoney(result.uncoveredAmount)!==parseMoney(result.amount))conflict("مبالغ أو هوية ربط السائق لا تطابق الصرف الأصلي");
 validatePayoutCapacity({amount:result.amount,availableAmount:result.amount,reservedAmount:"0.00",ownPendingAmount:"0.00",coverage:result.coverage.map(c=>({...c,availableAmount:c.amount,reservedAmount:"0.00",ownPendingAmount:"0.00"}))});
 if(result.coverage.reduce((sum,c)=>sum+parseMoney(c.amount),0n)!==parseMoney(result.coveredAmount))conflict("مجموع تغطية السائق لا يطابق إثبات الربط");return result;
}
/** Legitimate absence is explicit; query failures propagate. Original payout
 * proposals are never edited. One nonzero mapping is retained per actual FI. */
export async function readSavedDriverCoverage(tx:PartnershipExecutor,root:Root,financialId:number):Promise<DriverCoverageMapping|null>{
 const rows=partnershipRows(await tx.execute(sql`/* vp_driver_coverage_saved */ SELECT new_values FROM financial_audit_logs WHERE transaction_id=${financialId} AND action='vehicle_partnership_driver_conversion_mapped' ORDER BY id LIMIT 2`));
 if(!rows.length)return null;if(rows.length!==1)conflict("إثبات ربط صرف السائق مكرر");
 const saved=object(rows[0].new_values),proof=normalizeDriverCoverageMapping(saved.proof);
 if(proof.financialId!==financialId||proof.vehicleId!==root.vehicleId||proof.partnershipId!==root.id||saved.vehicleId!==root.vehicleId||saved.partnershipId!==root.id||saved.mappingKey!==proof.mappingKey||saved.mappingDigest!==driverCoverageDigest(proof))conflict("بصمة ربط الصرف أو نطاق المركبة تغير");return proof;
}
/** Independent canonical proof. It intentionally never calls the full driver
 * payment preflight, monthly writer or another right reconciler. */
export async function proveDriverCoverageMapping(tx:PartnershipExecutor,root:Root,source:DriverCashCoverageSource,rows:Row[]):Promise<DriverCoverageMapping>{
 const proof=await readSavedDriverCoverage(tx,root,source.financialId);if(!proof)conflict("تغطية صرف السائق بلا إثبات ربط معتمد");
 for(const field of ["financialId","settlementId","entryId","expenseId","costFundingId","accrualFinancialId","amount","entryAmount","entryDate","transactionDate","paymentMethod"] as const)if(proof[field]!==source[field])conflict("ربط السائق لا يطابق مصدر الأجرة والصرف الأصليين");
 if(proof.driverSourceDigest!==source.sourceDigest||rows.length!==proof.coverage.length||new Set(rows.map(r=>Number(r.allocation_id))).size!==rows.length)conflict("تغطية الصرف ناقصة أو مكررة أو تغير مصدرها");
 for(const item of proof.coverage){const matches=rows.filter(r=>Number(r.right_id)===item.rightId&&Number(r.conversion_allocation_id)===item.conversionAllocationId);if(matches.length!==1||Number(matches[0].financial_transaction_id)!==source.financialId||matches[0].purpose!=="internal_entitlement_settlement"||formatMoney(parseMoney(String(matches[0].allocated_amount)))!==item.amount||matches[0].idempotency_key!==`${proof.mappingKey}:coverage:${item.conversionAllocationId}`)conflict("سطور الربط لا تطابق توزيعات الصرف المحفوظة");}
 const audits=partnershipRows(await tx.execute(sql`/* vp_driver_coverage_financial_audits */ SELECT transaction_id,new_values FROM financial_audit_logs WHERE transaction_id IN (${source.financialId},${proof.closingFinancialId}) AND action='vehicle_partnership_financial_requested' ORDER BY transaction_id,id LIMIT 3`));
 const driver=audits.filter(a=>Number(a.transaction_id)===source.financialId),month=audits.filter(a=>Number(a.transaction_id)===proof.closingFinancialId);
 if(audits.length!==2||driver.length!==1||month.length!==1)conflict("إثبات الطلب المالي الأصلي للسائق أو الشهر مفقود أو مكرر");
 const d=object(driver[0].new_values),m=object(month[0].new_values),proposal=object(d.sourceSnapshot),command=object(proposal.command),origin=object(proposal.origin);
 if(d.vehicleId!==root.vehicleId||d.partnershipId!==root.id||d.sourceType!=="vehicle_partnership_driver"||Number(d.sourceId)!==source.settlementId||d.sourceDigest!==proof.driverRequestDigest||driverCoverageDigest(proposal)!==proof.driverRequestDigest||proposal.vehicleId!==root.vehicleId||proposal.partnershipId!==root.id||proposal.settlementId!==source.settlementId||command.entryId!==source.entryId||command.amount!==source.amount||command.transactionDate!==source.transactionDate||command.paymentMethod!==source.paymentMethod||origin.entryId!==source.entryId||origin.expenseId!==source.expenseId||origin.costFundingId!==source.costFundingId||origin.accrualFinancialId!==source.accrualFinancialId||origin.sourceDigest!==source.sourceDigest)conflict("طلب أجرة السائق الأصلي لا يطابق إثبات الربط");
 if(m.vehicleId!==root.vehicleId||m.partnershipId!==root.id||m.sourceType!=="vehicle_partnership_closing"||Number(m.sourceId)!==proof.closingId||m.sourceDigest!==proof.closingDigest)conflict("تحويل الشهر لا يطابق طلبه المالي الأصلي");
 const parents=partnershipRows(await tx.execute(sql`/* vp_driver_coverage_parents */ SELECT a.id,a.right_id,a.amount::text,a.financial_transaction_id,a.purpose,a.conversion_allocation_id,a.idempotency_key,r.partnership_id,h.id AS closing_id,h.partnership_id AS closing_partnership_id FROM vehicle_partnership_settlement_allocations a JOIN vehicle_partnership_rights r ON r.id=a.right_id JOIN financial_transactions f ON f.id=a.financial_transaction_id JOIN vehicle_partnership_closings h ON f.source_type='vehicle_partnership_closing' AND f.source_id=h.id::text WHERE a.id IN (${sql.join(proof.coverage.map(c=>sql`${c.conversionAllocationId}`),sql`, `)}) ORDER BY a.id LIMIT 501`));
 if(parents.length!==proof.coverage.length)conflict("أصول التحويل الداخلي للربط غير مكتملة");
 for(const item of proof.coverage){const p=parents.filter(r=>Number(r.id)===item.conversionAllocationId);if(p.length!==1||Number(p[0].right_id)!==item.rightId||Number(p[0].partnership_id)!==root.id||Number(p[0].closing_id)!==proof.closingId||Number(p[0].closing_partnership_id)!==root.id||Number(p[0].financial_transaction_id)!==proof.closingFinancialId||p[0].purpose!=="internal_conversion"||p[0].conversion_allocation_id!=null||p[0].idempotency_key!==`vp:closing:${proof.closingId}:r${proof.revision}:convert:${item.rightId}`||parseMoney(String(p[0].amount))<parseMoney(item.amount))conflict("تغطية الأجرة لا تخص تحويل نسختها الأصلية من الشهر");}
 // Old approved revisions remain independently provable after a controlled
 // full reversal/reopening; current mutable header percentages are not used.
 const wages=partnershipRows(await tx.execute(sql`/* vp_driver_coverage_wage_line */ SELECT source_key,line_kind,snapshot FROM vehicle_partnership_closing_lines WHERE closing_id=${proof.closingId} AND revision=${proof.revision} AND source_key=${`financial:${source.accrualFinancialId}`} LIMIT 2`));
 if(wages.length!==1||wages[0].line_kind!=="cost")conflict("مصدر أجرة السائق غير موجود في نسخة الشهر الأصلية");
 const wage=object(wages[0].snapshot),snapshot=object(wage.sourceSnapshot),financial=object(wage.financial);
 if(Number(wage.costFundingId)!==source.costFundingId||Number(wage.expenseId)!==source.expenseId||wage.sourceStatus!=="approved"||wage.sourceDigest!==source.sourceDigest||driverCoverageDigest(snapshot)!==source.sourceDigest||snapshot.employeeFinanceEntryId!==source.entryId||snapshot.date!==source.entryDate||snapshot.amount!==source.entryAmount||Number(financial.id)!==source.accrualFinancialId||financial.sourceType!=="vehicle_partnership_cost"||String(financial.sourceId)!==String(source.costFundingId)||financial.type!=="vp_driver_accrual"||financial.event!=="driver_accrual"||financial.direction!=="expense"||financial.status!=="executed"||financial.reversalOf!==null||financial.date!==source.entryDate||formatMoney(parseMoney(String(financial.amount)))!==source.entryAmount||wage.reversedFinancialId!=null)conflict("أجرة السائق لا تطابق مصدرها المجمد في الشهر");
 return proof;
}
