import { useEffect } from "react";
import { AppState } from "react-native";
import { SAMPLE_INTERVAL_MS } from "@/domain/attendance-evidence";
import { refreshAttendanceLocation } from "@/infrastructure/attendance-location-task";
import { useAuth } from "./auth-context";

export function AttendanceLocationSync() {
  const { status, user } = useAuth();
  const staffId = user?.id;

  useEffect(() => {
    if (status !== "authenticated" || !staffId) return;
    const refresh = () => {
      if (AppState.currentState === "active") {
        void refreshAttendanceLocation(staffId).catch(() => console.warn("[attendance] location sync failed"));
      }
    };
    refresh();
    const listener = AppState.addEventListener("change", refresh);
    const interval = setInterval(refresh, SAMPLE_INTERVAL_MS);
    return () => {
      listener.remove();
      clearInterval(interval);
    };
  }, [status, staffId]);

  return null;
}
