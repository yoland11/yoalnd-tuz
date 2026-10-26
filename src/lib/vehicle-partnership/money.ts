import {PartnershipValidationError,type Allocation,type Share} from "./types";

// PostgreSQL numeric(16,2): fourteen integer digits and two minor-unit digits.
const MAX_MINOR=9999999999999999n;
export function parseMoney(value:string):bigint{
  if(typeof value!=="string"||!/^(0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(value))throw new PartnershipValidationError("مبلغ غير صالح أو يتجاوز دقة ونطاق المبلغ المسموح");
  const [whole,fraction=""]=value.split(".");
  const minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));
  if(minor>MAX_MINOR)throw new PartnershipValidationError("المبلغ خارج النطاق المسموح");
  return minor;
}
export function formatMoney(value:bigint):string{
  if(typeof value!=="bigint"||value>MAX_MINOR||value< -MAX_MINOR)throw new PartnershipValidationError("المبلغ خارج النطاق المسموح");
  const absolute=value<0n?-value:value;
  return `${value<0n?"-":""}${absolute/100n}.${String(absolute%100n).padStart(2,"0")}`;
}
export function validateShares(shares:readonly Share[]):void{
  if(!Array.isArray(shares)||!shares.length||shares.length>100)throw new PartnershipValidationError("حدد نسب الشركاء");
  const keys=new Set<string>();let sum=0;
  for(const share of shares){
    if(!share||typeof share.key!=="string"||!share.key.trim()||share.key!==share.key.trim()||share.key.length>120)throw new PartnershipValidationError("هوية الشريك غير صالحة");
    if(keys.has(share.key))throw new PartnershipValidationError("الشريك مكرر في توزيع النسب");
    keys.add(share.key);
    if(!Number.isInteger(share.basisPoints)||share.basisPoints<0||share.basisPoints>10000)throw new PartnershipValidationError("نسبة الشريك غير صالحة");
    sum+=share.basisPoints;
  }
  if(sum!==10000)throw new PartnershipValidationError("يجب أن يكون مجموع نسب الشركاء 100%");
}
/** Exact largest-remainder allocation. Tie-break by stable source identity, not
 * locale, input order or a floating-point percentage. No entitlement is posted. */
export function allocateMoney(total:bigint,shares:readonly Share[]):Allocation[]{
  formatMoney(total);validateShares(shares);
  const absolute=total<0n?-total:total;
  const lines=shares.map(share=>({key:share.key,minor:absolute*BigInt(share.basisPoints)/10000n,remainder:absolute*BigInt(share.basisPoints)%10000n}));
  const ranked=[...lines].sort((a,b)=>a.remainder===b.remainder?(a.key<b.key?-1:a.key>b.key?1:0):a.remainder>b.remainder?-1:1);
  let remaining=absolute-lines.reduce((sum,line)=>sum+line.minor,0n);
  for(const line of ranked){if(remaining===0n)break;line.minor+=1n;remaining-=1n;}
  return lines.map(line=>({key:line.key,amount:formatMoney(total<0n?-line.minor:line.minor)}));
}
/** Net an approved partial reversal against original allocation weights without
 * converting either money or ratios to floating point/basis-point estimates. */
export function allocateWeightedMoney(total:bigint,weights:readonly {key:string;weight:bigint}[]):Allocation[]{
  formatMoney(total);
  if(total<0n||!Array.isArray(weights)||!weights.length||weights.length>5000)throw new PartnershipValidationError("مبلغ أو قائمة توزيع الأوزان غير صالحة");
  const keys=new Set<string>();let denominator=0n;
  for(const line of weights){
    if(!line||typeof line.key!=="string"||!line.key.trim()||line.key!==line.key.trim()||line.key.length>120||keys.has(line.key))throw new PartnershipValidationError("هوية وزن التوزيع مكررة أو غير صالحة");
    if(typeof line.weight!=="bigint"||line.weight<0n)throw new PartnershipValidationError("وزن التوزيع غير صالح");
    keys.add(line.key);denominator+=line.weight;
  }
  if(denominator===0n){if(total>0n)throw new PartnershipValidationError("لا يمكن توزيع مبلغ على أوزان صفرية");return weights.map(line=>({key:line.key,amount:"0.00"}));}
  const lines=weights.map(line=>({key:line.key,minor:total*line.weight/denominator,remainder:total*line.weight%denominator}));
  const ranked=[...lines].sort((a,b)=>a.remainder===b.remainder?(a.key<b.key?-1:a.key>b.key?1:0):a.remainder>b.remainder?-1:1);
  let remaining=total-lines.reduce((sum,line)=>sum+line.minor,0n);
  for(const line of ranked){if(remaining===0n)break;line.minor+=1n;remaining-=1n;}
  return lines.map(line=>({key:line.key,amount:formatMoney(line.minor)}));
}
