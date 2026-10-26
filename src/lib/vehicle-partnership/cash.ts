import {formatMoney,parseMoney} from "./money";
import {PartnershipValidationError} from "./types";

function parseSignedMoney(value:string):bigint{
  if(typeof value!=="string")throw new PartnershipValidationError("مبلغ غير صالح أو يتجاوز دقة ونطاق المبلغ المسموح");
  const negative=value.startsWith("-");
  const absolute=parseMoney(negative?value.slice(1):value);
  return negative?-absolute:absolute;
}

/** Cash movement for a partner profit payout. Operating totals are persisted
 * facts: distributing an existing entitlement does not change operating P&L. */
export function calculatePartnershipCashPosting(input:{amount:string;currentBalance:string;totalRevenue:string;totalExpenses:string;netProfit:string}):{amount:string;before:string;after:string;totalRevenue:string;totalExpenses:string;netProfit:string}{
  if(!input||typeof input!=="object")throw new PartnershipValidationError("بيانات الرصيد النقدي غير صالحة");
  const amount=parseMoney(input.amount);
  if(amount<=0n)throw new PartnershipValidationError("يجب أن يكون مبلغ صرف أرباح الشريك أكبر من صفر");
  const before=parseSignedMoney(input.currentBalance);
  const totalRevenue=parseMoney(input.totalRevenue);
  const totalExpenses=parseMoney(input.totalExpenses);
  const netProfit=parseSignedMoney(input.netProfit);
  if(before<amount)throw new PartnershipValidationError("رصيد الصندوق غير كاف لصرف أرباح الشريك");
  return {
    amount:formatMoney(amount),before:formatMoney(before),after:formatMoney(before-amount),
    totalRevenue:formatMoney(totalRevenue),totalExpenses:formatMoney(totalExpenses),netProfit:formatMoney(netProfit),
  };
}
