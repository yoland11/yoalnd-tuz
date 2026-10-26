import {IQD_LABEL} from "./money";

type TotalRow = {
  direction: "revenue" | "expense";
  amount: string;
  approvalStatus: string;
  sourceType: string | null;
  transactionType: string;
  cashDirection?: "inflow" | "outflow" | "noncash";
  accountingClassification?: "revenue" | "expense" | "liability_inflow" | "liability_repayment" | "partnership_transfer";
};
export type FinancialTransactionTotals =
  | {complete: true; revenue: string; expenses: string; cash: string}
  | {complete: false; reason: string};

const decimal = (minor: bigint) => {
  const absolute=minor<0n?-minor:minor;
  return `${minor<0n?"-":""}${absolute/100n}.${String(absolute%100n).padStart(2,"0")}`;
};

/** Displayed executed transactions only. Classification comes from the server;
 * the legacy predicate preserves existing loan/advance presentation rules. */
export function financialTransactionTotals<T extends TotalRow>(rows: readonly T[], legacyBalanceSheet: (row:T)=>boolean): FinancialTransactionTotals {
  let revenue=0n,expenses=0n,cash=0n;
  for(const row of rows){
    if(row.approvalStatus!=="executed")continue;
    const partnership=String(row.sourceType??"").startsWith("vehicle_partnership_")||row.transactionType.startsWith("vp_");
    if(partnership&&(!["inflow","outflow","noncash"].includes(row.cashDirection??"")||!["revenue","expense","liability_inflow","liability_repayment","partnership_transfer"].includes(row.accountingClassification??""))){
      return {complete:false,reason:"الإجمالي غير متاح: تصنيف حركة الشراكة غير مكتمل"};
    }
    if(typeof row.amount!=="string"||!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(row.amount))return {complete:false,reason:"الإجمالي غير متاح: مبلغ حركة غير صالح"};
    const [whole,fraction=""]=row.amount.split(".");
    const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));
    const direction=row.cashDirection??(row.direction==="revenue"?"inflow":"outflow");
    if(direction==="inflow")cash+=amount;
    if(direction==="outflow")cash-=amount;
    if(!partnership&&(legacyBalanceSheet(row)||["company_loan","company_loan_repayment","employee_advance"].includes(row.sourceType??"")||["company_loan_received","company_loan_repayment","employee_advance","employee_advance_repayment"].includes(row.transactionType)))continue;
    const classification=row.accountingClassification??row.direction;
    if(classification==="revenue")revenue+=row.direction==="revenue"?amount:-amount;
    if(classification==="expense")expenses+=row.direction==="expense"?amount:-amount;
  }
  return {complete:true,revenue:decimal(revenue),expenses:decimal(expenses),cash:decimal(cash)};
}

/** Exact display of an already aggregated decimal; no binary-float conversion. */
export function formatFinancialTotal(value:string):string {
  const [whole,fraction=""]=value.split(".");
  const grouped=`${whole.startsWith("-")?"-":""}${new Intl.NumberFormat("en-US").format(BigInt(whole.replace(/^-/,"")))}`;
  const decimals=fraction.replace(/0+$/,"");
  return `${grouped}${decimals?`.${decimals}`:""} ${IQD_LABEL}`;
}
