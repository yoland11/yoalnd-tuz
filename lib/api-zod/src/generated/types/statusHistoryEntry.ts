export interface StatusHistoryEntry {
  status: string;
  /** @nullable */
  notes?: string | null;
  createdAt: string;
}
