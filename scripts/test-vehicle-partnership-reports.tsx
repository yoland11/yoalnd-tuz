import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canonicalPartnershipJson } from "../src/lib/vehicle-partnership/canonical";
import {
  buildPartnerStatements, formatReportMoney, proveApprovedClosing, provePayoutReceipt,
  type PartnershipReportWorkspace,
} from "../src/lib/vehicle-partnership/reports";
import {
  buildPartnershipStatementHtml, buildPartnershipMonthlyHtml, buildPartnershipPayoutHtml,
  PartnerStatementTable,
} from "../src/views/admin/vehicle-partnership-reports";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const digest = (value: unknown) => createHash("sha256").update(canonicalPartnershipJson(value)).digest("hex");
const copy = <T,>(value: T): T => structuredClone(value);
const state = (total = "100.00") => ({ totalAmount: total, approvedPaidAmount: "20.00", remainingAmount: "80.00", reservedAmount: "30.00", availableAmount: "50.00", payable: true, approvalStatus: "approved" });
const workspace: PartnershipReportWorkspace = {
  rights: [
    { id: 1, category: "profit", direction: "credit", memberId: 8, memberName: "علي <script>alert(1)</script> محمد " + "الطويل ".repeat(20), amount: "100.00", status: "approved", closingId: 11, closingVersion: 4, paymentState: state() },
    { id: 2, category: "capital", direction: "credit", memberId: 8, memberName: "علي", amount: "99999999999999.99", status: "approved", closingId: null, closingVersion: null, paymentState: { ...state("99999999999999.99"), approvedPaidAmount: "0.00", remainingAmount: "99999999999999.99", reservedAmount: "0.00", availableAmount: "0.00", payable: false } },
    { id: 3, category: "advance", direction: "credit", memberId: 8, memberName: "علي", amount: "100.00", status: "pending", closingId: null, closingVersion: null, paymentState: { ...state(), approvedPaidAmount: "0.00", remainingAmount: "100.00", reservedAmount: "0.00", availableAmount: "0.00", payable: false, approvalStatus: "pending" } },
    { id: 4, category: "loss", direction: "debit", memberId: 9, memberName: "علي", amount: "100.00", status: "approved", closingId: 11, closingVersion: 4, paymentState: { ...state(), approvedPaidAmount: "0.00", remainingAmount: "100.00", reservedAmount: "0.00", availableAmount: "0.00", payable: false } },
    { id: 5, category: "loss_recovery", direction: "debit", memberId: 9, memberName: "علي", amount: "100.00", status: "approved", closingId: 11, closingVersion: 4, paymentState: { ...state(), approvedPaidAmount: "0.00", remainingAmount: "100.00", reservedAmount: "0.00", availableAmount: "0.00", payable: false } },
    { id: 6, category: "internal_entitlement", direction: "credit", memberId: null, memberName: null, amount: "100.00", status: "approved", closingId: null, closingVersion: null, paymentState: state() },
  ],
  driverEntries: [{ entryId: 12, employeeId: 40, employeeName: "حسين محمد", amount: "100.00", entryDate: "2026-09-01", status: "approved", paymentState: state() }],
  closings: [{ closingId: 11, month: "2026-09", status: "approved", version: 4, revision: 2, sourceDigest: "", financialTransactionId: 20 }],
  requests: [{ id: 30, sourceType: "vehicle_partnership_settlement", sourceId: "1", sourceEvent: "distribution", status: "executed", amount: "20.00", date: "2026-10-01", description: "صرف حصة" }], from: "2026-10-01", to: "2026-10-27",
};
assert.equal((await import("../src/lib/vehicle-partnership/reports")).isPartnershipPayoutRequest({...workspace.requests[0],reversalTxnId:72,reversedAt:"2026-10-28T10:00:00Z"}),false,"a reversed original remains history, never a payable/printable executed cash receipt");
const branding = { companyName: "مجموعة علي جان", companyPhone: "07700000000", logoUrl: "/images/logo.svg" };
const identity = { vehicleName: "نيسان <img src=x onerror=alert(1)>", plateNumber: "22-A-123", generatedAt: "2026-10-27 13:15" };
const statements = buildPartnerStatements(workspace);
assert.equal(statements.length, 3, "distinct original member IDs remain separate even when names match");
assert.deepEqual(statements[0].rows.map(row => row.category), ["profit", "capital", "advance"]);
assert.equal(statements[0].rows[0].reservedAmount, "30.00");
assert.equal(statements[0].rows[0].approvedPaidAmount, "20.00", "pending is never added to actual paid");
assert.equal(statements[0].rows[2].status, "pending");
assert.equal(formatReportMoney("99999999999999.99"), "99,999,999,999,999.99 د.ع");
assert.equal(formatReportMoney("-250.10"), "-250.10 د.ع");
assert.throws(() => formatReportMoney("1e6"));
const invalid = copy(workspace); invalid.rights.push(copy(invalid.rights[0]));
assert.throws(() => buildPartnerStatements(invalid), /مكرر/);
const badState = copy(workspace); badState.rights[0].paymentState.approvedPaidAmount = "bogus";
assert.throws(() => buildPartnerStatements(badState));
const statementHtml = buildPartnershipStatementHtml(statements[0], identity, branding);
assert.match(statementHtml, /A4 landscape/);
assert.match(statementHtml, /dir="rtl"/);
assert.match(statementHtml, /رصيد حالي/);
assert.match(statementHtml, /99,999,999,999,999.99/);
assert.match(statementHtml, /30.00/);
assert.match(statementHtml, /&lt;script&gt;/);
assert.doesNotMatch(statementHtml, /<script>alert|<img src=x/);
assert.match(statementHtml, /table-header-group/);
const table = renderToStaticMarkup(<PartnerStatementTable statement={statements[0]} />);
assert.match(table, /المدفوع المنفذ/);
assert.match(table, /محجوز/);
assert.match(table, /غير قابل للصرف/);
assert.doesNotMatch(table, /<script>alert/);

const calculation = { summary: { complete: true, externalIncome: "100.00", internalIncome: "40.00", cost: "20.00", result: "120.00", lossRecovered: "0.00", carriedLossOut: "0.00", reserve: "10.00", maxDistributable: "110.00", blockers: [] }, profitAllocations: [{ agreementId: 7, memberId: 8, partyKey: "customer:15", amount: "55.00" }], lossAllocations: [], lossRecoveries: [], claimsRemaining: [], segments: [], investment: "99999999999999.99", digest: "a".repeat(64) };
const snapshot = { formatVersion: 1, vehicleId: 3, partnershipId: 2, setupVersion: 4, from: "2026-09-01", to: "2026-09-30", agreements: [{ id: 7, members: [{ id: 8, name: "الاسم الأصلي", party: { kind: "customer", id: 15 } }] }], policy: { accountingMethod: "activity_clearing" }, calculation };
const closing = { ...workspace.closings[0], sourceDigest: digest(snapshot) };
const preview = { stored: true, provisional: false, vehicleId: 3, partnershipId: 2, from: snapshot.from, to: snapshot.to, closingId: 11, status: "approved", version: 4, sourceDigest: digest(snapshot), snapshot, calculation, approvalBlockers: [] };
const monthly = await proveApprovedClosing(3, closing, preview);
const monthlyHtml = buildPartnershipMonthlyHtml(monthly, identity, branding);
assert.match(monthlyHtml, /الاسم الأصلي/);
assert.doesNotMatch(monthlyHtml, /customer:15|sourceDigest|agreementId/);
assert.match(monthlyHtml, /نتيجة الشهر المعتمدة/);
for (const change of [{ stored: false }, { provisional: true }, { status: "draft" }, { sourceDigest: "b".repeat(64) }, { closingId: 99 }, { version: 5 }]) {
  await assert.rejects(() => proveApprovedClosing(3, closing, { ...preview, ...change }));
}
const altered = copy(preview); altered.snapshot.calculation.summary.result = "121.00";
await assert.rejects(() => proveApprovedClosing(3, closing, altered));

const proposal = { formatVersion: 1, vehicleId: 3, partnershipId: 2, command: { rightId: 1, amount: "20.00", transactionDate: "2026-10-01", paymentMethod: "cash" }, origin: { rightId: 1, memberId: 8 } };
const audit = { action: "vehicle_partnership_financial_requested", newValues: { vehicleId: 3, partnershipId: 2, sourceType: "vehicle_partnership_settlement", sourceId: 1, amount: "20.00", sourceDigest: digest(proposal), sourceSnapshot: proposal } };
const detail = { id: 30, transactionNo: "FIN-2026-000030", transactionDate: "2026-10-01", approvalStatus: "executed", direction: "expense", transactionType: "vp_partner_distribution", sourceType: "vehicle_partnership_settlement", sourceId: "1", sourceEvent: "distribution", amount: "20.00", paymentMethod: "cash", approvedAt: "2026-10-01T10:00:00Z", executedAt: "2026-10-01T10:01:00Z", approvedBy: 1, executedBy: 1, balanceBefore: "100.00", balanceAfter: "80.00", reversedAt: null, reversalTxnId: null, reversedTransactionId: null, entries: [{ side: "debit", amount: "20.00", accountCode: "VP-PROFIT" }, { side: "credit", amount: "20.00", accountCode: "1000" }], audits: [audit] };
const receipt = await provePayoutReceipt(3, workspace, 30, detail);
assert.equal(receipt.transactionNo, detail.transactionNo);
assert.equal(receipt.payeeName, workspace.rights[0].memberName?.trim());
const thermal = buildPartnershipPayoutHtml(receipt, identity, branding);
assert.match(thermal, /FIN-2026-000030/);
assert.match(thermal, /80mm/);
assert.match(thermal, /@media screen/,"receipt screen preview must fit its own iframe without changing printer geometry");
assert.match(thermal, /20.00/);
assert.doesNotMatch(thermal, /customer:15|sourceSnapshot|approvedBy|new_values/);
for (const change of [{ approvalStatus: "pending" }, { approvalStatus: "approved" }, { amount: "21.00" }, { sourceId: "2" }, { sourceEvent: "advance_reimbursement" }, { transactionDate: "2026-10-02" }, { reversedAt: "2026-10-02T00:00:00Z" }, { reversalTxnId: 31 }, { entries: [] }, { audits: [] }, { executedAt: null }, { transactionNo: "FIN-TMP-123e4567-e89b-12d3-a456-426614174000" }]) {
  await assert.rejects(() => provePayoutReceipt(3, workspace, 30, { ...detail, ...change }));
}
await assert.rejects(() => provePayoutReceipt(4, workspace, 30, detail));
await assert.rejects(() => provePayoutReceipt(3, workspace, 31, detail));
const changedProof = copy(detail); changedProof.audits[0].newValues.sourceSnapshot.vehicleId = 4;
await assert.rejects(() => provePayoutReceipt(3, workspace, 30, changedProof));
const driverWorkspace = copy(workspace); driverWorkspace.requests = [{ ...workspace.requests[0], sourceType: "vehicle_partnership_driver", sourceId: "35", sourceEvent: "driver_fee_settlement" }];
const driverProposal = { formatVersion: 1, vehicleId: 3, partnershipId: 2, settlementId: 35, command: { entryId: 12, amount: "20.00", transactionDate: "2026-10-01", paymentMethod: "cash" }, origin: { entryId: 12, employeeId: 40 } };
const driverDetail = { ...detail, sourceType: "vehicle_partnership_driver", sourceId: "35", sourceEvent: "driver_fee_settlement", transactionType: "vp_driver_payment", entries: [{ side: "debit", amount: "20.00", accountCode: "VP-DRIVER" }, { side: "credit", amount: "20.00", accountCode: "1000" }], audits: [{ ...audit, newValues: { ...audit.newValues, sourceType: "vehicle_partnership_driver", sourceId: 35, sourceSnapshot: driverProposal, sourceDigest: digest(driverProposal) } }] };
const driverReceipt = await provePayoutReceipt(3, driverWorkspace, 30, driverDetail);
assert.equal(driverReceipt.payeeName, "حسين محمد");
assert.match(buildPartnershipPayoutHtml(driverReceipt, identity, branding), /وصل صرف أجرة سائق/);
const advanceWorkspace=copy(workspace);advanceWorkspace.rights[2].status="approved";advanceWorkspace.requests=[{...workspace.requests[0],sourceId:"3",sourceEvent:"advance_reimbursement"}];
const advanceProposal={...proposal,command:{...proposal.command,rightId:3},origin:{rightId:3,memberId:8}};
const advanceDetail={...detail,sourceId:"3",sourceEvent:"advance_reimbursement",transactionType:"vp_partner_advance_repayment",entries:[{side:"debit",amount:"20.00",accountCode:"VP-ADVANCE"},{side:"credit",amount:"20.00",accountCode:"1000"}],audits:[{...audit,newValues:{...audit.newValues,sourceId:3,sourceSnapshot:advanceProposal,sourceDigest:digest(advanceProposal)}}]};
const advanceReceipt=await provePayoutReceipt(3,advanceWorkspace,30,advanceDetail);assert.match(buildPartnershipPayoutHtml(advanceReceipt,identity,branding),/وصل استرداد سلفة الشريك/);
await assert.rejects(()=>provePayoutReceipt(3,advanceWorkspace,30,{...advanceDetail,entries:detail.entries}),/قيد/);
console.log("PASS vehicle partnership statements, frozen monthly reports and original 80mm payout proofs (no database writes)");
