import { sql, type SQL } from "drizzle-orm";
type Columns = { sourceType: SQL; transactionType: SQL };
/** Source-owned deposit liability and noncash charge records never enter the
 * collections-based operating reports. No new table/column dependency. */
export function equipmentRentalOperatingPredicate(columns: Columns): SQL {
  return sql`(coalesce(${columns.sourceType},'') NOT IN ('equipment_rental_deposit','equipment_rental_charge') AND coalesce(${columns.transactionType},'') NOT LIKE 'er_deposit_%' AND coalesce(${columns.transactionType},'') NOT LIKE 'er_charge%')`;
}
export function equipmentRentalCashPredicate(columns: Columns): SQL {
  return sql`(coalesce(${columns.sourceType},'') <> 'equipment_rental_charge' AND coalesce(${columns.transactionType},'') NOT IN ('er_deposit_apply','er_deposit_apply_reversal','er_charge','er_charge_reversal'))`;
}
