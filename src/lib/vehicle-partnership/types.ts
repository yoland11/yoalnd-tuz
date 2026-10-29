/** Serializable partnership facts. No database, approval or cashbox dependency. */
export type Money = string;
export const ORIGINAL_VEHICLE_OPERATING_COST_TYPES:readonly string[]=["fuel","driver_wage","maintenance","repair","oil_change","tires","insurance","registration","washing","fees_parking","cleaning","parking","toll"];
export type PartyReference = {kind:"customer"|"supplier"|"staff";id:number};
export type Share = {key:string;basisPoints:number};
export type Allocation = {key:string;amount:Money};
export type AgreementMember = {
  party:PartyReference;ownershipBasisPoints:number;profitBasisPoints:number;expenseBasisPoints:number;capitalContribution:Money;
};
export type AgreementDraft = {vehicleId:number;registrationOwner:string;effectiveFrom:string;members:AgreementMember[]};
export type IncomeFact = {sourceKey:string;kind:"internal"|"external";amount:Money|null;approved:boolean;recognized:boolean};
export type CostFact = {sourceKey:string;amount:Money|null;status:"approved"|"pending"|"rejected";category:"driver"|"fuel"|"operating"|"capital"};
export type TripFacts = {income:IncomeFact|null;driver:CostFact|null;costs:readonly CostFact[];profitShares:readonly Share[];blockers?:readonly string[]};
export type TripResult = {complete:boolean;blockers:string[];income:Money|null;cost:Money|null;contribution:Money|null;provisionalShares:Allocation[]|null};
export type DepreciationPolicy = {kind:"none"}|{kind:"configured";amount:Money};
export type ReservePolicy = {kind:"none"}|{kind:"fixed";amount:Money}|{kind:"percent";basis:"after_loss_recovery"|"recognized_income";basisPoints:number};
export type MonthFacts = {externalIncome:readonly IncomeFact[];internalIncome:readonly IncomeFact[];costs:readonly CostFact[];depreciation:DepreciationPolicy|null;reserve:ReservePolicy|null;carriedLoss:Money|null;profitShares:readonly Share[];lossShares:readonly Share[];blockers?:readonly string[]};
export type MonthResult = {
  complete:boolean;blockers:string[];externalIncome:Money|null;internalIncome:Money|null;cost:Money|null;result:Money|null;
  lossRecovered:Money|null;carriedLossOut:Money|null;reserve:Money|null;maxDistributable:Money|null;
  proposedProfitShares:Allocation[]|null;lossAllocations:Allocation[]|null;
};

export class PartnershipValidationError extends Error {
  readonly status=422;
  readonly code="VALIDATION_ERROR";
  constructor(message:string){super(message);this.name="PartnershipValidationError";}
}
