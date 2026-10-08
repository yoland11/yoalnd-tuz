export function serviceOrderFocusId(search: string): number | null {
  const value = new URLSearchParams(search).get("serviceOrder");
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
