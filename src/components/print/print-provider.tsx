import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  PrintFormatDialog,
  type PrintJob,
} from "@/components/print/print-format-dialog";

/**
 * Central provider for the unified AJN print experience. Mount once near the app
 * root; any screen then calls `usePrint().print(job)` to open the shared
 * "اختيار نوع الطباعة" → معاينة → طباعة flow. This guarantees one consistent
 * print behaviour across every module instead of bespoke logic per page.
 */

type PrintContextValue = {
  /** Open the unified print dialog for a document. */
  print: (job: PrintJob) => void;
  /** Close the dialog programmatically (rarely needed). */
  close: () => void;
};

const PrintContext = createContext<PrintContextValue | null>(null);

export function PrintProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<PrintJob | null>(null);

  const print = useCallback((next: PrintJob) => {
    if (!next.formats || next.formats.length === 0) return;
    setJob(next);
  }, []);

  const close = useCallback(() => setJob(null), []);

  const value = useMemo<PrintContextValue>(
    () => ({ print, close }),
    [print, close],
  );

  return (
    <PrintContext.Provider value={value}>
      {children}
      <PrintFormatDialog job={job} onClose={close} />
    </PrintContext.Provider>
  );
}

export function usePrint(): PrintContextValue {
  const context = useContext(PrintContext);
  if (!context) {
    throw new Error("usePrint must be used within a <PrintProvider>");
  }
  return context;
}

export type { PrintJob, PrintFormat, PrintFormatId } from "@/components/print/print-format-dialog";
