# Vehicle partnership historical settlement design addendum

Extends the owner-approved single-vehicle design and the four priorities explicitly requested on 2026-10-28. Native execution continues in the existing task worktree. These are builder implementation choices, not new assertions about historical money.

## Chosen approach and boundaries

Use the original financial requests, audit records, monthly lines/rights, exact-money math, canonical reconciliation, MASTER approvals and cash executor. No duplicate transport, expense, payment or vehicle. No new schema is needed: audited source declarations and classification operations use existing financial_audit_logs, as the existing driver-coverage operation already does. Original approved months, percentages and cash records are never rewritten.

1. Prior-period settlement is a source-backed classification of an existing executed, financially applicable, UNCONSUMED original event into a selected later open month. Administrator approval and reason/reference are mandatory. Original money/date/party and original FIN stay intact. Free-form historical profit edits, reusing an already consumed event and invented adjustments are rejected. A financial correction must first exist through its original authorized source. The classification posts no cash or duplicate journal; its original financial event is already approved. Immutable audit operations plus root/source locks and nonce fingerprints serialize retries. Cancelling an unused classification is another audit; used/pending-frozen sources cannot be moved.
2. Opening loss is the exact nonzero amount declared in the FIRST approved agreement, allocated using its actual original expense shares. The user must supply the evidence reference/reason; no amount is guessed. An audited declaration becomes one original central pending financial request. Principal approval posts VP-LOSS / VP-OPENING-CLEAR, noncash and outside operating P&L, with immutable source/approval proof. First-month approval materializes opening loss rights through real first-month adjustment lines, so recovery reuses existing original-member loss rights. Zero opening and old frozen reports remain unchanged. Reversal is full/unused only and preserves the original proof.
3. New opt-in advance requests rely on the already approved original cost/advance, not monthly approval. Existing version-1 requests/keys/proposals retain their exact original behavior. New version-2 source-only requests permit pre-close and historical inactive ownership payment, with transaction date >= cost date, root/branch access, unchanged original dated member, canonical capacity and principal-only MASTER execution. Root version is checked for a new request, not for immutable retry. No new expense.
4. Once the real cost month is approved, explicit administrator classification can link those SAME executed advance FIs to real internal conversion parents, including pre-close payments. Original request/proposal/primary allocation stay unchanged; separate immutable coverage audit proves appended coverage. Partial/no capacity is explicit, not new payable. Full reversed cash is excluded only through its proven immutable return. Advance request proof, canonical balances and cash reversal retain correct original right/FI identity after mapping or later month revisions.

## Source/caller impact

- New source-only opening adapter is dispatched by accounting.ts/posting.ts through the existing MASTER noncash branch; central cash formulas are unchanged.
- closing.ts, closing-rights.ts, closing-unused.ts and closing lifecycle consume optional proven opening metadata and real original event classification; absent new metadata preserves old snapshots and calculations.
- Existing closing locks keep active-ownership defaults. A server-only historical-settlement option is used only when proving already approved historical obligations; API input cannot switch it.
- advance-payments.ts adds opt-in v2, keeps legacy v1 source checks, and recognizes separately proven later coverage. driver and profit producers keep their original contracts.
- Narrow routes and original partnership workspace UI expose the existing workflows. No new generic financial override endpoint.

## Financial safety

Source/vehicle/partnership IDs, evidence digests, actual journals and original dated parties are re-proved under deterministic root -> booking/source -> fleet/cost/right -> FI -> MASTER ordering. Every multi-record write and audit is one transaction. Durable source/operation nonce replay precedes mutable admission. Approved history, source snapshots and allocation rows are retained. Missing evidence blocks approval visibly. No Production diagnostic writes or fabricated historical setup.
