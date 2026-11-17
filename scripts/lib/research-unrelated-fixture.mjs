/** Controlled-I/O fixtures in older subsystem tests own no research rows.
 * Model the new source boundary as an empty match, preserving their original
 * lock/cash assertions. Actual research/alias locks have separate behavior and
 * isolated PostgreSQL coverage; this is never imported by application code. */
export const researchNoOpGuards={
 lockResearchPaymentSources:async()=>[],
 guardResearchFinancialApproval:async()=>{},
 ResearchFinanceError:class ResearchFinanceError extends Error {},
};
