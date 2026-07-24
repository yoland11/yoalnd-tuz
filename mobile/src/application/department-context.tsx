import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getDepartment } from "@/domain/department";
import type { DepartmentStrategy } from "@/domain/department";
import type { DepartmentId } from "@/domain/entities";

interface DepartmentContextValue {
  departmentId: DepartmentId;
  department: DepartmentStrategy;
  setDepartmentId: (id: DepartmentId) => void;
}

const DepartmentContext = createContext<DepartmentContextValue | null>(null);

/**
 * Which department's tasks the crew is currently viewing. Defaults to Koshat;
 * staff assigned to a single department simply never switch. (A future refinement
 * can auto-select / restrict this from the signed-in user's permissions.)
 */
export function DepartmentProvider({ children }: { children: ReactNode }) {
  const [departmentId, setDepartmentId] = useState<DepartmentId>("koshat");
  const value = useMemo<DepartmentContextValue>(
    () => ({
      departmentId,
      department: getDepartment(departmentId),
      setDepartmentId,
    }),
    [departmentId],
  );
  return (
    <DepartmentContext.Provider value={value}>
      {children}
    </DepartmentContext.Provider>
  );
}

export function useDepartment(): DepartmentContextValue {
  const ctx = useContext(DepartmentContext);
  if (!ctx) throw new Error("useDepartment must be used within DepartmentProvider");
  return ctx;
}
