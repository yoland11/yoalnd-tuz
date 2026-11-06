/**
 * Simple vehicle profit split: the company and ONE partner share a vehicle.
 *
 * A month's net = the transport fees of the vehicle's trips that month minus its
 * executed expenses. The partner's share is that net times the partner's
 * percentage in force that month; the company keeps the rest. Losing months are
 * shared the same way, so they offset later profit.
 *
 * Pure arithmetic in integer fils (IQD x 100). It never reads or writes money:
 * what was paid comes from executed main-cash rows only (see the API route).
 */

export type PartnerTerm = {
  /** First month (YYYY-MM) these terms apply to; they last until the next term. */
  startsMonth: string;
  partnerName: string;
  partnerPhone: string | null;
  /** Partner's share of the net in basis points (5000 = 50%). 0 = no partner from this month. */
  shareBasisPoints: number;
};

/** One booking's transport on this vehicle; `count` is its trips (a plan may hold several). */
export type PartnerTripInput = { eventDate: string | null; fee: number | null; count?: number };
export type PartnerExpenseInput = { date: string; amount: number; status: string };

export type PartnerMonth = {
  month: string;
  partnerName: string | null;
  shareBasisPoints: number;
  tripCount: number;
  /** Trips whose fee is split over several vehicles and not set per trip; their fee is not counted. */
  unallocatedTrips: number;
  income: number;
  expenses: number;
  pendingExpenses: number;
  net: number;
  partnerShare: number;
  companyShare: number;
};

export type PartnerBalance = {
  /** Sum of every month's partner share (losses reduce it). */
  earned: number;
  /** Executed payouts net of executed reversals. */
  paid: number;
  /** Payout requests still waiting for approval; they hold part of the balance. */
  pending: number;
  /** earned - paid - pending; negative means the partner received more than his share. */
  remaining: number;
  /** What a new payout request may ask for. */
  available: number;
};

export class PartnerShareError extends Error {
  constructor(message: string, public status = 422) { super(message); this.name = "PartnerShareError"; }
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const fail = (message: string): never => { throw new PartnerShareError(message); };

export function toFils(value: number): number {
  if (!Number.isFinite(value)) return fail("مبلغ غير صالح في حساب السيارة");
  return Math.round(value * 100);
}
export const fromFils = (fils: number) => fils / 100;

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

/** "2026-11-06" or an ISO timestamp → "2026-11"; anything else → null. */
export function monthOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const month = String(value).slice(0, 7);
  return isMonth(month) ? month : null;
}

export function nextMonth(month: string): string {
  const [, year, mm] = MONTH.exec(month) ?? fail("الشهر غير صالح");
  const index = Number(year) * 12 + Number(mm); // month after `month`, 1-based
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function lastDayOfMonth(month: string): string {
  const [, year, mm] = MONTH.exec(month) ?? fail("الشهر غير صالح");
  const day = new Date(Date.UTC(Number(year), Number(mm), 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Inclusive list of months, capped so a typo cannot ask for centuries. */
export function monthRange(from: string, to: string, limit = 240): string[] {
  if (!isMonth(from) || !isMonth(to)) return fail("الشهر غير صالح");
  const months: string[] = [];
  for (let month = from; month <= to; month = nextMonth(month)) {
    months.push(month);
    if (months.length > limit) return fail("فترة الشراكة أطول من الحد المسموح");
  }
  return months;
}

/** "50", "33.5", "12.25" → basis points. Rejects anything outside 0–100 or past 2 decimals. */
export function percentToBasisPoints(value: unknown): number {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^(0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(text)) return fail("نسبة الشريك يجب أن تكون رقماً من 0 إلى 100");
  const [whole, fraction = ""] = text.split(".");
  const points = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (points > 10000) return fail("نسبة الشريك لا تتجاوز 100%");
  return points;
}

export function basisPointsLabel(points: number): string {
  const whole = Math.floor(points / 100), rest = points % 100;
  return rest ? `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}%` : `${whole}%`;
}

/** Terms sorted by month; the one in force for `month` is the latest that started on or before it. */
export function termForMonth(terms: readonly PartnerTerm[], month: string): PartnerTerm | null {
  let current: PartnerTerm | null = null;
  for (const term of terms) if (term.startsMonth <= month && (!current || term.startsMonth > current.startsMonth)) current = term;
  return current;
}

/** Half away from zero, so a loss splits the same way a profit does. */
function shareOf(netFils: number, basisPoints: number): number {
  const exact = (netFils * basisPoints) / 10000;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

const EXECUTED = new Set(["executed", "partially_reversed", "reversed"]);

export function buildPartnerMonths(input: {
  terms: readonly PartnerTerm[];
  trips: readonly PartnerTripInput[];
  /** `amount` is the executed amount net of reversals; pending rows count separately. */
  expenses: readonly PartnerExpenseInput[];
  throughMonth: string;
}): PartnerMonth[] {
  if (!input.terms.length) return [];
  const first = input.terms.reduce((min, term) => term.startsMonth < min ? term.startsMonth : min, input.terms[0].startsMonth);
  if (first > input.throughMonth) return [];
  const months = monthRange(first, input.throughMonth);
  const buckets = new Map(months.map((month) => [month, { tripCount: 0, unallocatedTrips: 0, income: 0, expenses: 0, pendingExpenses: 0 }]));
  for (const trip of input.trips) {
    const bucket = buckets.get(monthOf(trip.eventDate) ?? "");
    if (!bucket) continue;
    bucket.tripCount += Math.max(1, trip.count ?? 1);
    if (trip.fee == null) bucket.unallocatedTrips += 1;
    else bucket.income += toFils(trip.fee);
  }
  for (const expense of input.expenses) {
    const bucket = buckets.get(monthOf(expense.date) ?? "");
    if (!bucket) continue;
    if (EXECUTED.has(expense.status)) bucket.expenses += toFils(expense.amount);
    else if (expense.status === "pending") bucket.pendingExpenses += 1;
  }
  return months.map((month) => {
    const bucket = buckets.get(month)!;
    const term = termForMonth(input.terms, month);
    const points = term?.shareBasisPoints ?? 0;
    const net = bucket.income - bucket.expenses;
    const partner = points ? shareOf(net, points) : 0;
    return {
      month,
      partnerName: points ? term!.partnerName : null,
      shareBasisPoints: points,
      tripCount: bucket.tripCount,
      unallocatedTrips: bucket.unallocatedTrips,
      income: fromFils(bucket.income),
      expenses: fromFils(bucket.expenses),
      pendingExpenses: bucket.pendingExpenses,
      net: fromFils(net),
      partnerShare: fromFils(partner),
      companyShare: fromFils(net - partner),
    };
  });
}

export function partnerBalance(months: readonly PartnerMonth[], paid: number, pending: number): PartnerBalance {
  const earned = months.reduce((sum, month) => sum + toFils(month.partnerShare), 0);
  const remaining = earned - toFils(paid) - toFils(pending);
  return { earned: fromFils(earned), paid: fromFils(toFils(paid)), pending: fromFils(toFils(pending)), remaining: fromFils(remaining), available: fromFils(Math.max(0, remaining)) };
}

/** Server check before a payout request is created (under the vehicle row lock). */
export function assertPayoutFits(amount: number, balance: PartnerBalance): number {
  const fils = toFils(amount);
  if (!(fils > 0)) return fail("مبلغ الصرف يجب أن يكون أكبر من صفر");
  if (Math.abs(amount * 100 - fils) > 0.0001) return fail("مبلغ الصرف بدقة منزلتين كحد أقصى");
  if (fils > toFils(balance.available)) throw new PartnerShareError(`المبلغ أكبر من الباقي للشريك (${fromFils(toFils(balance.available)).toLocaleString("en-US")} د.ع)`, 409);
  return fromFils(fils);
}
