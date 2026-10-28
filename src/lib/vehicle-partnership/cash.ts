import {formatMoney,parseMoney} from "./money";
import {PartnershipValidationError} from "./types";

function parseSignedMoney(value:string):bigint{
  if(typeof value!=="string")throw new PartnershipValidationError("مبلغ غير صالح أو يتجاوز دقة ونطاق المبلغ المسموح");
  const negative=value.startsWith("-");
  const absolute=parseMoney(negative?value.slice(1):value);
  return negative?-absolute:absolute;
}

/** Cash movement for an approved partnership liability payout. Operating totals
 * are persisted facts: settling a liability does not repeat its accrual cost. */
export function calculatePartnershipCashPosting(input:{amount:string;currentBalance:string;totalRevenue:string;totalExpenses:string;netProfit:string}):{amount:string;before:string;after:string;totalRevenue:string;totalExpenses:string;netProfit:string}{
  if(!input||typeof input!=="object")throw new PartnershipValidationError("بيانات الرصيد النقدي غير صالحة");
  const amount=parseMoney(input.amount);
  if(amount<=0n)throw new PartnershipValidationError("يجب أن يكون مبلغ صرف المستحق أكبر من صفر");
  const before=parseSignedMoney(input.currentBalance);
  const totalRevenue=parseMoney(input.totalRevenue);
  const totalExpenses=parseMoney(input.totalExpenses);
  const netProfit=parseSignedMoney(input.netProfit);
  if(before<amount)throw new PartnershipValidationError("رصيد الصندوق غير كاف لصرف المستحق");
  return {
    amount:formatMoney(amount),before:formatMoney(before),after:formatMoney(before-amount),
    totalRevenue:formatMoney(totalRevenue),totalExpenses:formatMoney(totalExpenses),netProfit:formatMoney(netProfit),
  };
}

/** Returning an already settled liability is cash-in, not new operating income. */
export function calculatePartnershipCashReversal(input:{amount:string;currentBalance:string;totalRevenue:string;totalExpenses:string;netProfit:string}){
  const amount=parseMoney(input.amount),before=parseSignedMoney(input.currentBalance);
  if(amount<=0n)throw new PartnershipValidationError("مبلغ عكس الصرف يجب أن يكون موجباً");
  return {amount:formatMoney(amount),before:formatMoney(before),after:formatMoney(before+amount),totalRevenue:formatMoney(parseMoney(input.totalRevenue)),totalExpenses:formatMoney(parseMoney(input.totalExpenses)),netProfit:formatMoney(parseSignedMoney(input.netProfit))};
}
