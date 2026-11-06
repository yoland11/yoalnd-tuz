import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { AppState, Platform } from "react-native";
import { tokens } from "@/application/container";
import { queryClient } from "@/application/query-client";
import { locationTaskAction, SAMPLE_INTERVAL_MS } from "@/domain/attendance-evidence";
import { attendanceApi, attendanceKeys, GEOFENCE_PATH, type GeofenceState } from "./attendance-api";
import { ApiError, createHttpClient } from "./http-client";

const TASK = "ajn-attendance-location";
const SESSION_KEY = "ajn_attendance_location_session";
const UNAVAILABLE = "تعذر التحقق من الموقع";

type Session = {
  staffId: number;
  recordId: number;
  startsAt: number;
  endsAt: number;
  optedInAt: number;
  token: string | null;
  lastAttemptAt: number;
  lastObservedAt: number;
  reportedUnavailable: boolean;
  exempt?: boolean;
};

let storageWork: Promise<unknown> = Promise.resolve();
let sending = false;
let requestingPermission = false;
const deliveryRequests = new Set<AbortController>();
const revocationRequests = new Map<number, Promise<void>>();

function withSession<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageWork.then(operation);
  storageWork = result.catch(() => undefined);
  return result;
}

async function readSession(): Promise<Session | null> {
  const stored = await SecureStore.getItemAsync(SESSION_KEY);
  return stored ? JSON.parse(stored) as Session : null;
}

function saveSession(session: Session) {
  return SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

function nativeBuild() {
  return (Platform.OS === "android" || Platform.OS === "ios")
    && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

async function stopNativeTask() {
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) {
    await Location.stopLocationUpdatesAsync(TASK);
  }
}

async function stopSession() {
  for (const request of deliveryRequests) request.abort();
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } finally {
    await stopNativeTask();
  }
}

export async function stopAttendanceLocation() {
  if (nativeBuild()) await withSession(stopSession);
}

function sameSession(session: Session | null, previous: Session): session is Session {
  return session?.staffId === previous.staffId && session.recordId === previous.recordId && session.optedInAt === previous.optedInAt;
}

async function pauseSession(session: Session) {
  if (session.token) await saveSession({ ...session, token: null });
  await stopNativeTask();
}

function revocationKey(staffId: number) {
  return `${SESSION_KEY}_revoke_${staffId}`;
}

function flushRevocation(staffId: number): Promise<void> {
  if (!nativeBuild()) return Promise.resolve();
  const inProgress = revocationRequests.get(staffId);
  if (inProgress) return inProgress;
  const key = revocationKey(staffId);
  const request = (async () => {
    const pending = await SecureStore.getItemAsync(key);
    if (!pending) return;
    const token = await tokens.get();
    if (!token) throw new ApiError(401, "سجّل الدخول لتأكيد إلغاء مشاركة الموقع");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const client = createHttpClient({ tokens: { get: async () => token } });
      const state = await client.post<GeofenceState>(GEOFENCE_PATH + "/consent", {
        recordId: Number(pending), consent: false,
      }, controller.signal);
      if (await tokens.get() === token) queryClient.setQueryData(attendanceKeys.geofence, state);
    } catch (error) {
      // A changed attendance record makes a revoke for this record obsolete.
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      if (await tokens.get() === token) void queryClient.invalidateQueries({ queryKey: attendanceKeys.geofence });
    } finally {
      clearTimeout(timeout);
    }
    if (await SecureStore.getItemAsync(key) === pending) await SecureStore.deleteItemAsync(key);
    void queryClient.invalidateQueries({ queryKey: attendanceKeys.locationControl(staffId) });
  })().finally(() => revocationRequests.delete(staffId));
  revocationRequests.set(staffId, request);
  return request;
}

export async function revokeAttendanceLocation(staffId: number, recordId: number) {
  if (!nativeBuild()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      queryClient.setQueryData(attendanceKeys.geofence, await attendanceApi.consent(recordId, false, controller.signal));
    } finally {
      clearTimeout(timeout);
    }
    return true;
  }
  await withSession(async () => {
    try {
      await stopSession();
    } finally {
      await SecureStore.setItemAsync(revocationKey(staffId), String(recordId));
    }
  });
  void queryClient.invalidateQueries({ queryKey: attendanceKeys.locationControl(staffId) });
  try {
    await flushRevocation(staffId);
    return true;
  } catch (error) {
    // The task is already stopped. The stored record ID is retried on reconnect.
    if (!(error instanceof ApiError)) throw error;
    return false;
  }
}

async function applyServerState(session: Session, state: GeofenceState) {
  const now = Date.now();
  const exempt = state.status === "exempt";
  if (session.recordId !== state.recordId || !state.consented || (!state.eligible && !exempt)
    || state.status === "checked_out" || state.status === "inactive"
    || state.startsAt == null || state.startsAt > now || state.endsAt == null || state.endsAt <= now) {
    await stopSession();
    return null;
  }
  const next = { ...session, startsAt: state.startsAt, endsAt: state.endsAt, exempt };
  if (next.startsAt !== session.startsAt || next.endsAt !== session.endsAt || exempt !== Boolean(session.exempt)) {
    await saveSession(next);
  }
  return next;
}

async function deliver(session: Session, token: string, endpoint: "sample" | "unavailable" | "refresh", data = {}) {
  const client = createHttpClient({ tokens: { get: async () => token } });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const delivery = await withSession(async () => {
      const current = await readSession();
      if (!sameSession(current, session) || Date.now() >= current.endsAt || (current.exempt && endpoint === "sample")) return;
      deliveryRequests.add(controller);
      const promise = endpoint === "refresh"
        ? client.get<GeofenceState>(GEOFENCE_PATH, undefined, controller.signal)
        : client.post<GeofenceState>(GEOFENCE_PATH + "/" + endpoint, { ...data, recordId: session.recordId }, controller.signal);
      // Keep the network wait outside the local state lock so opt-out can abort it.
      void promise.catch(() => undefined);
      return { promise };
    });
    if (!delivery) return;
    const state = await delivery.promise;
    await withSession(async () => {
      const current = await readSession();
      if (!sameSession(current, session)) return;
      await applyServerState(current, state);
      queryClient.setQueryData(attendanceKeys.geofence, state);
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error instanceof ApiError && error.isUnauthorized) {
      await withSession(async () => {
        if (sameSession(await readSession(), session)) await stopSession();
      });
      return;
    }
    // No retry or queue. The next fresh fix or the server's evidence timeout supplies the next state.
    console.warn("[attendance] location evidence delivery failed", error instanceof ApiError ? error.status : "unexpected");
  } finally {
    clearTimeout(timeout);
    deliveryRequests.delete(controller);
  }
}

if (nativeBuild()) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
    if (sending) return;
    sending = true;
    try {
      const delivery = await withSession(async () => {
        const session = await readSession();
        if (!session || Date.now() >= session.endsAt) {
          await stopSession();
          return;
        }
        if (!session.token) return;
        const now = Date.now();
        const action = locationTaskAction(data?.locations ?? [], {
          ...session,
          startsAt: Math.max(session.startsAt, session.optedInAt),
        }, now, Boolean(error));
        if (!action) return;
        await saveSession({
          ...session,
          lastAttemptAt: now,
          lastObservedAt: action.kind === "sample" ? action.sample.observedAt : session.lastObservedAt,
          reportedUnavailable: action.kind === "unavailable",
        });
        return { session, token: session.token, action };
      });
      if (delivery) {
        const { session, token, action } = delivery;
        await deliver(session, token, action.kind, action.kind === "sample" ? action.sample : undefined);
      }
    } catch {
      console.warn("[attendance] native location task failed");
    } finally {
      sending = false;
    }
  });
}

async function supported() {
  return nativeBuild() && await TaskManager.isAvailableAsync() && await Location.isBackgroundLocationAvailableAsync();
}

async function permissionsGranted() {
  const [foreground, background, services] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Location.hasServicesEnabledAsync(),
  ]);
  return foreground.granted && background.granted && services;
}

async function syncSession(session: Session, state: GeofenceState) {
  const token = await tokens.get();
  let unavailable = false;
  const active = await withSession(async () => {
    const stored = await readSession();
    if (!sameSession(stored, session)) return false;
    const current = await applyServerState(stored, state);
    if (!current) return false;
    if (!token || (current.token && current.token !== token)) {
      await stopSession();
      return false;
    }
    const permissions = await permissionsGranted();
    if (!permissions) {
      unavailable = !current.reportedUnavailable;
      await pauseSession({ ...current, reportedUnavailable: true });
      if (!current.token && unavailable) await saveSession({ ...current, reportedUnavailable: true });
      return false;
    }
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) return true;
    if (AppState.currentState !== "active") return false;
    await saveSession({ ...current, token, startsAt: state.startsAt!, endsAt: state.endsAt! });
    try {
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: SAMPLE_INTERVAL_MS,
        distanceInterval: 0,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "AJN Staff · التحقق من موقع العمل",
          notificationBody: "يُستخدم موقعك خلال ورديتك الحالية بعد موافقتك",
          killServiceOnDestroy: true,
        },
      });
      return true;
    } catch {
      unavailable = !current.reportedUnavailable;
      await pauseSession({ ...current, token, reportedUnavailable: true });
      console.warn("[attendance] could not start native location");
      return false;
    }
  });
  if (unavailable && token) await deliver(session, token, "unavailable");
  return active;
}

export async function enableAttendanceLocation(staffId: number, recordId: number) {
  if (!await supported()) throw new Error(UNAVAILABLE);
  requestingPermission = true;
  try {
    await flushRevocation(staffId);
    const state = await attendanceApi.consent(recordId, true);
    queryClient.setQueryData(attendanceKeys.geofence, state);
    if (!state.eligible || !state.consented || state.recordId !== recordId || state.status === "exempt"
      || state.startsAt == null || state.endsAt == null || state.endsAt <= Date.now()) return false;

    const session: Session = {
      staffId, recordId, startsAt: state.startsAt, endsAt: state.endsAt, optedInAt: Date.now(), token: null,
      lastAttemptAt: 0, lastObservedAt: 0, reportedUnavailable: false,
    };
    await withSession(async () => {
      await stopSession();
      await saveSession(session);
    });
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.granted) await Location.requestBackgroundPermissionsAsync();
    const refreshed = await attendanceApi.geofence();
    queryClient.setQueryData(attendanceKeys.geofence, refreshed);
    return syncSession(session, refreshed);
  } finally {
    requestingPermission = false;
  }
}

export async function refreshAttendanceLocation(staffId: number) {
  if (requestingPermission || !nativeBuild()) return;
  await flushRevocation(staffId);
  if (!await supported()) return;
  const session = await withSession(readSession);
  if (!session || session.staffId !== staffId) return;
  if (session.endsAt <= Date.now()) {
    await withSession(async () => {
      if (sameSession(await readSession(), session)) await stopSession();
    });
    return;
  }
  const state = await queryClient.fetchQuery({ queryKey: attendanceKeys.geofence, queryFn: attendanceApi.geofence, retry: false });
  await syncSession(session, state);
}

export async function attendanceLocationControl(staffId: number | undefined) {
  const empty = { recordId: null, running: false, pendingRevocation: false };
  if (!staffId || !nativeBuild()) return empty;
  const pendingRevocation = Boolean(await SecureStore.getItemAsync(revocationKey(staffId)));
  const session = await withSession(readSession);
  if (!session || session.staffId !== staffId || session.endsAt <= Date.now()) return { ...empty, pendingRevocation };
  const running = Boolean(session.token) && await supported()
    && await Location.hasStartedLocationUpdatesAsync(TASK) && await permissionsGranted();
  return { recordId: session.recordId, running, pendingRevocation };
}
