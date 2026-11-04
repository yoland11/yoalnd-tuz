import assert from "node:assert/strict";
import { equipmentRentalBalances, assertEquipmentRentalRequestBalance, equipmentRentalEffect } from "../src/lib/equipment-rental-finance";
import { financialTransactionTotals } from "../src/lib/financial-transaction-totals";

const row = (kind: string, amount: number, status = "executed", reversal = false) => ({ kind, amount, approvalStatus: status, reversal });
const balance = equipmentRentalBalances(100, [row("rent_payment", 30), row("rent_payment", 50, "pending"), row("deposit_collect", 80), row("deposit_refund", 10), row("deposit_apply", 20)]);
assert.equal(balance.paid, 50);
assert.equal(balance.remaining, 50);
assert.equal(balance.depositHeld, 50);
assert.equal(balance.pendingRent, 50);
assert.throws(() => assertEquipmentRentalRequestBalance(balance, "rent_payment", 1), /متبق/);
assert.throws(() => assertEquipmentRentalRequestBalance(balance, "deposit_refund", 51), /تأمين/);
assert.throws(() => assertEquipmentRentalRequestBalance(balance, "deposit_apply", 51), /تأمين|متبق/);
assert.equal(equipmentRentalBalances(100, [row("charge", 50, "pending")]).total, 100);
assert.equal(equipmentRentalBalances(150, [row("charge", 50)]).total, 150, "approved charges already live in original header total");
assert.equal(equipmentRentalBalances(100, [row("rent_payment", 50), row("rent_payment", 20, "executed", true)]).paid, 30);
assert.equal(equipmentRentalBalances(100, [row("deposit_collect", 80), row("deposit_apply", 20), row("deposit_apply", 20, "executed", true)]).depositHeld, 80);
assert.equal(equipmentRentalEffect("deposit_apply").cashDirection, "noncash");
assert.equal(equipmentRentalEffect("charge").cashDirection, "noncash");
assert.equal(equipmentRentalEffect("deposit_collect").accountingClassification, "liability_inflow");
assert.equal(equipmentRentalEffect("deposit_collect", true).cashDirection, "outflow");
const totals = financialTransactionTotals([
  {direction:"revenue" as const,amount:"80",approvalStatus:"executed",sourceType:"equipment_rental_deposit",transactionType:"er_deposit_collect"},
  {direction:"expense" as const,amount:"20",approvalStatus:"executed",sourceType:"equipment_rental_deposit",transactionType:"er_deposit_apply"},
], () => false);
assert.deepEqual(totals, {complete:true,revenue:"0.00",expenses:"0.00",cash:"80.00"});
const voucherOnly=equipmentRentalBalances(100,[],100);
assert.equal(voucherOnly.refundablePaid,0);
assert.throws(()=>assertEquipmentRentalRequestBalance(voucherOnly,'rent_refund',1),/سند القبض/,'voucher-funded payments must be refunded through their one original receipt');
const mixed=equipmentRentalBalances(150,[row('rent_payment',50)],100);
assert.equal(mixed.refundablePaid,50);
assert.throws(()=>assertEquipmentRentalRequestBalance(mixed,'rent_refund',51),/سند القبض/);
console.log("Equipment rental finance invariants passed");
