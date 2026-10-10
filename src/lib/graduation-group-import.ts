export async function importGroupStudentRows<Row>(
  rows: readonly Row[],
  submit: (row: Row) => Promise<unknown>,
): Promise<{ succeeded: Row[]; failed: Array<{ rowData: Row; error: unknown }> }> {
  const succeeded: Row[] = [];
  const failed: Array<{ rowData: Row; error: unknown }> = [];
  for (const row of rows) {
    try {
      await submit(row);
      succeeded.push(row);
    } catch (error) {
      failed.push({ rowData: row, error });
    }
  }
  return { succeeded, failed };
}
