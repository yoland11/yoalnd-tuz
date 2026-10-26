# Monthly closing integration contract

Implementation interpretation of the approved vehicle-partnership design. This is not evidence of an owner's additional instruction. Original accounting/cash records remain the authority; no source-request POST is enabled yet.

## Implemented calculation boundary

`src/lib/vehicle-partnership/closing.ts` is a computational preview, not a poster. Exact IQD strings/BigInt, approved original source identities, dated agreement/member IDs and explicit policy inputs determine the result. Version the calculation in the source digest. Missing opening-loss proof, depreciation/reserve policy, mixed-term allocation or material shared-cost basis blocks completeness.

For one agreement, ordinary positive/loss results match the existing exact month domain. For economically different dated terms, `dated_results` must be explicitly selected: pool the monthly net result, attribute positive distributable result among positive dated segment results (or monthly loss among negative segment results), then apply that segment's original profit/loss percentages. Shared costs/depreciation need an explicit expense-date basis. This does not create a provisional per-trip partner payable.

Loss recovery consumes only the CURRENT month's provisional share of the SAME typed party. Preserve the original loss right/agreement/member IDs. A departed party with no current share keeps its loss; a new party does not inherit it. Never offset any previously approved unpaid profit right. Capital/refunded capital stay outside operating profit. Supplier cost refunds are cost credits, not additional transport sales or recognized-income reserve basis.

## Source evidence needed before persistence

Implemented source-evidence boundary: `src/server/vehicle-partnership/closing-evidence.ts` and `closing-source-repository.ts`. This is not yet the monthly approval lifecycle. The reader reuses the original vehicle, approved dated parties, all source revisions and actual financial/reversal references. Decimal amounts remain text inside PostgreSQL JSON. Reads are bounded and fail visibly on truncation, missing financial references or database errors; they never post money or run runtime DDL.

The still-unapplied feature migration now includes immutable cost-funding `source_snapshot` metadata. Each newly submitted partner cost and driver accrual records its original amount/date/identity before an unused employee entitlement can be reused. Activity snapshots retain event date, reference, customer, driver and billing evidence. Official closing evidence uses those snapshots rather than a later employee-entry amount. Original company expenses retain their actual financial date separately from the stored business date used for cost allocation. Rejected/cancelled old cash requests have no recognized effect and cannot obstruct a corrected authoritative funding source merely because the original expense was subsequently edited.

Executed reversals use their actual financial date and original dated agreement. Income reversals reduce income; cost refunds reduce costs; capital refunds remain outside operating profit. A known later reversal prevents an earlier still-unclosed gross claim from being approved without explicit chronology/adjustment review. Pending, incomplete or conflicting evidence blocks approval; source evidence by itself does not prove current-source completeness, opening-loss chronology or permission to post a closing.

Keep the original activity/cost financial IDs, exact amount/date/type/event, reversal identities and immutable approved source snapshots. Current trip profitability may use the latest original source state; approved monthly reports must render their stored version, never silently recalculate it from edited originals.

Add the minimum safe metadata to the still-unapplied feature migration where required: cost source snapshots, closing financial reference and conversion-allocation references. Do not change the original vehicle, trip, invoice or expense identifiers. Driver entry resubmission must preserve each old cost/financial source snapshot even though its one unused employee entitlement is reused.

Normal financial events follow their original recognized/business date. A later approved refund must not disappear because the original vehicle expense date is in an earlier month. Read actual referenced reversal records and their dates; bind each recognized event to one approved closing revision. Preserve original-party attribution. A still-unapproved old close affected by later reversals must not manufacture an available internal claim: require explicit review of subsequent adjustments before approval. Approved old closes stay immutable; corrections belong in an auditable adjustment or an eligible controlled reopening.

## Closing posting and gross entitlement conversion

The catalog's `vp_month_profit` debit/credit pair is CLASSIFICATION ONLY. It is not a full authorization/posting plan. Resolve all legs from persisted approved sources and policies, under root -> original source -> source/financial locks. Source-owned revisions/idempotency, audit rollback and canonical reconciliation are mandatory.

For the ordinary, unadjusted activity-clearing method, let G be approved internal gross entitlement, E approved external attribution, C recognized net operating cost including explicitly configured allocation, N=G+E-C, H eligible original-party loss recovery, R approved reserve, D approved distributable profit, L=max(-N,0). D+R+H=max(N,0).

The SOURCE-SPECIFIC balanced reclassification plan is:

- Debit original internal payable G, discharging it once.
- Debit activity appropriation/result E, without another customer revenue/invoice.
- Debit original-party loss receivable L.
- Credit internal activity/cost clearing C (a negative C reverses the leg).
- Credit original-party loss receivable H, reserve R and approved profit payable D.

Explicit opening balances and authorized prior-period adjustments require their own proven balanced legs; never shoehorn them into a second liability or a fake cash payment. Source nominal financial amount represents the reviewed balanced journal plan, not an extra receipt. Cash impact is NONE. Month approval creates only immutable approved source lines/rights and reclassifies the original gross claim. Zero/loss close never fabricates a bank payment.

The accounting method must be explicitly acknowledged in setup/closing policy and consistent with the company's approved arrangement. Do not silently present an internal clearing allocation as external sales or tax depreciation.

## One physical payout, linked source coverage

Implemented canonical conversion boundary: `src/lib/vehicle-partnership/conversion.ts`, consumed by the existing canonical partnership adapter in `src/server/vehicle-partnership/payment-state.ts`. The nine-table, still-unapplied migration now pins the closing FI and nullable coverage-parent allocation. A composite same-right FK prevents coverage referencing another original entitlement. Parent-specific history remains immutable; parentless primary allocations retain their original uniqueness.

Approved monthly-source identity and original cash references are revalidated before deriving balances. `approvedPaidAmount` is actual executed net cash only. `nonCashSettledAmount` is the remaining approved noncash conversion after cash mapped within it. These satisfy `total = cash paid + noncash settled + raw remaining`. `reservedAmount` holds direct raw cash requests and pending conversion; `conversionCashReservedAmount` holds pending cash within an approved conversion. `availableCoverageAmount` is an original-claim allocation limit, never a wallet or payment source. UI must show the noncash category explicitly rather than labelling a converted claim cash-paid merely because raw remaining is zero.

Only full unused noncash reversal is admissible. Any executed or pending cash coverage—including an original vehicle expense—blocks reversal of its conversion; settled history needs an approved adjustment. Pure math/canonical read support does not yet implement an actual closing approval, controlled reopening writer, driver-cash coverage producer or partner payout.

No independent gross transfer may be offered from MASTER and then followed by another MASTER distribution of the same money. There is no fictional partnership wallet. A real prior transfer would require a real permitted non-MASTER payment source for later payments.

An approved closing converts an original internal gross claim into approved cost/advance/profit/reserve categories. Track noncash conversion separately from actual cash paid. Original paid company vehicle expenses may provide real cost-coverage references without posting them again. A later approved profit/advance payment may carry both its primary right allocation and an underlying converted-internal-claim coverage reference; cash moves ONCE.

Canonical accounting must distinguish:

- raw approved claim amount;
- direct executed cash, if a valid legacy path exists;
- approved noncash conversion;
- executed/pending cash mapped WITHIN that conversion;
- remaining raw payable and remaining converted funding coverage.

Mapped cash is contained in the converted amount, not added a second time to extinguished debt. A cost refund can restore converted coverage when the original cash coverage reverses. Cap all active coverage against its real original transaction and approved conversion. External funds and internal funds must not be conflated.

Conversion links must reference the actual approved closing financial transaction. Reopening reverses a conversion; old links remain history and cease being active through their source state, not deletion. Any uniqueness required for a new approved revision must preserve prior inactive links. Prevent two active conversions/allocations of one budget.

## Reopening and chronology

Implemented read-only `previewClosing` in `src/server/vehicle-partnership/closing.ts`: original vehicle/branch permission before financial reads; existing trip/driver/billing completeness; approved dated terms and immutable event evidence; explicit initial opening loss; sequential prior closing and exact carried-loss-right reconciliation. Unconsumed prior-period events are visible adjustment blockers. An unacknowledged accounting method and a still-open Baghdad month block final approval. Saved approved/distributed reports read their verified frozen snapshot rather than recalculating from today's sources. No monthly transition or financial-request endpoint is enabled by this preview.

Close months sequentially after initial activation/opening proof; never guess a missing intervening month's loss. Current-month preview is provisional. Reopening requires financial administrator, explicit reason/version/digest and no dependent later approved closing, pending/paid profit or incompatible source usage. Reverse the old noncash closing and its rights transactionally, retain every old snapshot/revision, then submit the new revision for approval. Settled history requires an auditable adjustment, not silent repricing.

## Remaining implementation (not certified by this document)

Task6: implement immutable monthly transition/persistence, source-specific closing financial request/journal resolver, exact rights/conversion writes, explicit late-period adjustments and controlled unused reopening. Final approval must re-lock/revalidate original sources and immutable submission digest transactionally. Task7: actual approved cash sources, partial partner/driver payments, allocation/coverage deduplication, statements/reversals. Task8: original vehicle UI and read-only reports/printing; generic MASTER print must label noncash correctly. Bridge noncash original-expense recognition into legacy vehicle/booking profitability readers without counting a second expense. Task9: final review and regression gates. Real PostgreSQL concurrency/write tests remain SKIPPED without a verified isolated TEST database.
