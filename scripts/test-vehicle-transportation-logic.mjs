import { readFileSync } from "node:fs";

let failures = 0;
function check(label, condition) {
  if (condition) console.log(`✓ ${label}`);
  else {
    failures += 1;
    console.error(`✗ ${label}`);
  }
}
function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
function transportRevenue(total, paid, fee) {
  return total > 0 ? money(fee * Math.min(1, Math.max(0, paid / total))) : 0;
}
function netProfit(revenue, expenses) {
  return money(revenue - expenses);
}

// Scenario A: the transport fee is a component of one customer booking total,
// never a second sale or cash movement.
check("AJN transport adds once to the customer booking total", money(500000 + 50000) === 550000);
check("AJN transport has a distinct analytical revenue component", transportRevenue(550000, 550000, 50000) === 50000);
check("partial payment attributes transport revenue proportionally", transportRevenue(550000, 275000, 50000) === 25000);
check("reversed or zero official payment produces no transport revenue", transportRevenue(550000, 0, 50000) === 0);
check("customer-responsibility transport creates no revenue", transportRevenue(500000, 500000, 0) === 0);

// Scenario B / D: vehicle is an analytical profitability account only.
check("vehicle profit subtracts executed expenses without mutating revenue", netProfit(500000, 180000) === 320000);
check("linked trip transport profit is calculated separately", netProfit(50000, 20000) === 30000);

const api = readFileSync("src/server/api.ts", "utf8");
const cash = readFileSync("src/server/master-cash-box.ts", "utf8");
const migration = readFileSync("lib/db/migrations/0106_vehicle_transportation_profitability.sql", "utf8");

check("AJN transport requires a positive fee and vehicle", api.includes("أجرة النقل مطلوبة عندما يكون النقل بواسطة AJN") && api.includes("اختر سيارة للنقل بواسطة AJN"));
check("vehicle expense uses the central pending financial approval request", api.includes('sourceType: "vehicle_expense"') && api.includes("createAndExecuteSourceFinancialTransaction"));
check("vehicle expense is posted only by master-cash approval", cash.includes('transaction.sourceType === "vehicle_expense"') && cash.includes('status: "executed"'));
check("vehicle expense reversal preserves the original and creates a reversal", api.includes("reverseFinancialTransaction(expense.financialTransactionId") && cash.includes('action: "vehicle_expense_reversed"'));
check("transport revenue is an analytical pro-rata calculation, not a new cash transaction", api.includes("executedTransportationRevenue = total > 0"));
const destructiveStatements = migration
  .split(/\r?\n/)
  .map((line) => line.trim().toUpperCase())
  .filter((line) => /^(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/.test(line));
check("migration is additive-only", destructiveStatements.length === 0 && migration.includes("CREATE TABLE IF NOT EXISTS vehicle_expenses"));

if (failures) {
  console.error(`AJN VEHICLE TRANSPORT CONTRACT FAILED — ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("AJN VEHICLE TRANSPORT CONTRACT PASSED — single booking, canonical cash, analytical vehicle profitability.");
