import { useCallback, useRef, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/application/auth-context";
import { attendanceCode, gpsEvidence, punchEvidence, SAMPLE_INTERVAL_MS } from "@/domain/attendance-evidence";
import { attendanceApi, attendanceKeys, type AttendanceAction, type GeofenceState } from "@/infrastructure/attendance-api";
import { attendanceLocationControl, enableAttendanceLocation, revokeAttendanceLocation, stopAttendanceLocation } from "@/infrastructure/attendance-location-task";
import { Screen } from "@/presentation/components/Screen";
import { ErrorState, LoadingState, errorMessage } from "@/presentation/components/states";

const UNAVAILABLE = "تعذر التحقق من الموقع";
const statusLabels: Record<GeofenceState["status"], string> = {
  inside: "داخل نطاق موقع العمل",
  outside: "خارج نطاق موقع العمل",
  returned: "تمت العودة إلى نطاق العمل",
  checked_out: "انتهى التحقق بعد الانصراف",
  unavailable: UNAVAILABLE,
  exempt: "التحقق متوقف خلال فترة الاستثناء",
  inactive: "التحقق غير نشط",
};
const time = (at: number) => new Intl.DateTimeFormat("ar-IQ", {
  timeZone: "Asia/Baghdad", hour: "numeric", minute: "2-digit",
}).format(at);

async function punchLocation() {
  if (Platform.OS !== "android" && Platform.OS !== "ios") throw new Error(UNAVAILABLE);
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error(UNAVAILABLE);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(UNAVAILABLE)), 15_000);
        }),
      ]);
      const evidence = gpsEvidence(fix);
      if (evidence) return evidence;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    throw new Error(UNAVAILABLE);
  }
  throw new Error(UNAVAILABLE);
}

function ActionButton({ label, onPress, disabled, secondary }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={secondary
        ? "min-h-12 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 dark:border-slate-600"
        : "min-h-12 items-center justify-center rounded-xl bg-brand px-4 py-2"}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? { opacity: 0.45 } : undefined}
    >
      <Text className={secondary ? "text-center font-semibold text-slate-900 dark:text-slate-100" : "text-center font-semibold text-white"}>{label}</Text>
    </Pressable>
  );
}

export default function AttendanceScreen() {
  const client = useQueryClient();
  const staffId = useAuth().user?.id;
  const today = useQuery({ queryKey: attendanceKeys.today, queryFn: attendanceApi.today, refetchInterval: 60_000 });
  const geofence = useQuery({ queryKey: attendanceKeys.geofence, queryFn: attendanceApi.geofence, refetchInterval: SAMPLE_INTERVAL_MS });
  const recordId = geofence.data?.recordId ?? null;
  const deviceKey = attendanceKeys.locationControl(staffId);
  const device = useQuery({
    queryKey: deviceKey,
    queryFn: () => attendanceLocationControl(staffId),
    enabled: staffId != null,
    refetchInterval: SAMPLE_INTERVAL_MS,
    retry: false,
  });
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [code, setCode] = useState<{ value: string; action: AttendanceAction; shiftId: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const activeAction = useRef(false);
  const scanningActive = useRef(false);

  useFocusEffect(useCallback(() => {
    void client.invalidateQueries({ queryKey: ["staff", "attendance"] });
    return () => {
      scanningActive.current = false;
      setScanning(false);
      setCode(null);
    };
  }, [client]));

  const data = today.data;
  const location = geofence.data;
  const stopRecordId = device.data?.recordId ?? (location?.consented ? recordId : null);
  const pendingRevocation = device.data?.pendingRevocation === true;
  const shift = data?.current;
  const action = data?.enabled && shift
    ? data.canCheckOut ? "check_out" : data.canCheckIn ? "check_in" : null
    : null;
  const label = action === "check_out" ? "تسجيل الانصراف" : "تسجيل الحضور";
  const method = shift ? punchEvidence(shift) : null;
  const scanned = action && code?.action === action && code.shiftId === shift?.shiftId ? code.value : null;

  async function run(operation: () => Promise<void>) {
    if (activeAction.current) return;
    activeAction.current = true;
    setBusy(true);
    setNotice("");
    setProblem("");
    try {
      await operation();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      activeAction.current = false;
      setBusy(false);
    }
  }

  function openScanner() {
    void run(async () => {
      if (Platform.OS !== "ios" && Platform.OS !== "android") {
        throw new Error("مسح رمز الحضور متاح في تطبيق الهاتف.");
      }
      const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
      if (!permission.granted) throw new Error("اسمح بالكاميرا من إعدادات الهاتف لمسح رمز الحضور.");
      setCode(null);
      setScanError("");
      scanningActive.current = true;
      setScanning(true);
    });
  }

  function closeScanner() {
    scanningActive.current = false;
    setScanning(false);
  }

  function submit(qrCode?: string) {
    if (!action || !shift || !method || today.isError) return;
    void run(async () => {
      const needsGps = qrCode ? method.qr === "gps" : method.directGps;
      const gps = needsGps ? await punchLocation() : undefined;
      const result = await attendanceApi.punch({ action, shiftId: shift.shiftId ?? undefined, qrCode, gps });
      setCode(null);
      setNotice(`${result.action === "check_in" ? "تم تسجيل حضورك" : "تم تسجيل انصرافك"} الساعة ${time(result.atMs)}`);
      client.setQueryData(attendanceKeys.today, result.today);
      try {
        if (result.action === "check_out") await stopAttendanceLocation();
      } finally {
        void client.invalidateQueries({ queryKey: ["staff", "attendance"] });
      }
    });
  }

  function changeConsent(consent: boolean) {
    const target = consent ? recordId : stopRecordId;
    if (!staffId || !target || (consent && (pendingRevocation || geofence.isError
      || !location?.eligible || target !== data?.open?.id))) return;
    void run(async () => {
      try {
        if (consent) {
          if (!await enableAttendanceLocation(staffId, target)) setProblem(UNAVAILABLE);
        } else {
          const revoked = await revokeAttendanceLocation(staffId, target);
          if (revoked) setNotice("تم إيقاف مشاركة الموقع لهذه الوردية.");
        }
      } finally {
        void client.invalidateQueries({ queryKey: deviceKey });
      }
    });
  }

  const stopAction = stopRecordId && !pendingRevocation ? (
    <ActionButton label="إيقاف مشاركة الموقع لهذه الوردية" onPress={() => changeConsent(false)} disabled={busy} secondary />
  ) : null;
  const revokeNotice = pendingRevocation ? (
    <Text accessibilityLiveRegion="polite" className="text-right text-slate-700 dark:text-slate-200">
      توقفت مشاركة الموقع من هذا الجهاز. سيُؤكّد الإلغاء مع الخادم عند عودة الاتصال.
    </Text>
  ) : null;
  if (today.isPending || today.isError || !data) {
    return <Screen>
      {today.isPending ? <LoadingState label="جارٍ تحميل الدوام…" /> : <ErrorState error={today.error} onRetry={() => void today.refetch()} />}
      {stopAction}
      {revokeNotice}
      {notice ? <Text accessibilityLiveRegion="polite" className="text-right font-semibold text-emerald-700 dark:text-emerald-400">{notice}</Text> : null}
      {problem ? <Text accessibilityRole="alert" className="text-right text-red-700 dark:text-red-400">{problem}</Text> : null}
    </Screen>;
  }

  const eligible = location?.eligible && data.open?.id === location.recordId;
  const locationStatus = geofence.isError ? UNAVAILABLE : location?.status === "exempt" || location?.status === "checked_out"
    ? statusLabels[location.status]
    : eligible && !location.consented
      ? "بانتظار موافقتك"
      : eligible && !device.data?.running
        ? UNAVAILABLE
        : location ? statusLabels[location.status] : "جارٍ تحميل حالة التحقق…";

  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-4 py-5">
        <View className="gap-1">
          <Text accessibilityRole="header" className="text-right text-2xl font-bold text-slate-900 dark:text-slate-100">دوامي اليوم</Text>
          <Text className="text-right text-sm text-slate-600 dark:text-slate-300">{data.employeeName} · {data.date}</Text>
        </View>
        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <Text className="text-right text-lg font-semibold text-slate-900 dark:text-slate-100">{data.statusLabel}</Text>
          {data.open ? <Text className="text-right text-slate-700 dark:text-slate-200">وقت الحضور {time(data.open.startMs)}</Text> : null}
          {shift?.title || shift?.locationName ? <Text className="text-right text-slate-700 dark:text-slate-200">{[shift.title, shift.locationName].filter(Boolean).join(" · ")}</Text> : null}
          {shift && shift.endMs > shift.startMs ? <Text className="text-right text-slate-700 dark:text-slate-200">{time(shift.startMs)} – {time(shift.endMs)}</Text> : null}
          {!data.enabled ? <Text className="text-right text-slate-700 dark:text-slate-200">تسجيل الدوام غير مفعّل لحسابك.</Text> : null}
          {action && shift?.method === "manual" ? <Text className="text-right text-slate-700 dark:text-slate-200">يُسجّل دوامك يدوياً بموافقة المدير.</Text> : null}
          {action && method?.qr ? <ActionButton label={scanned ? "مسح رمز جديد" : "مسح رمز الحضور QR"} onPress={openScanner} disabled={busy} secondary={!!scanned || method.directGps} /> : null}
          {scanned ? <ActionButton label={`تأكيد ${label}`} onPress={() => submit(scanned)} disabled={busy} /> : null}
          {action && method?.directGps && !scanned ? <ActionButton label={`${label} بالموقع`} onPress={() => submit()} disabled={busy} /> : null}
          {action && shift?.method === "any" && !method?.qr && !method?.directGps ? <Text className="text-right text-slate-700 dark:text-slate-200">راجع مسؤول الدوام لتفعيل إحدى طرق التسجيل.</Text> : null}
        </View>
        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <Text accessibilityRole="header" className="text-right text-lg font-semibold text-slate-900 dark:text-slate-100">التحقق من موقع العمل</Text>
          {location?.workplace ? <Text className="text-right text-sm text-slate-600 dark:text-slate-300">{location.workplace}</Text> : null}
          <Text accessibilityLiveRegion="polite" className="text-right font-medium text-slate-900 dark:text-slate-100">{locationStatus}</Text>
          {geofence.isError ? <ActionButton label="إعادة تحميل حالة التحقق" onPress={() => void geofence.refetch()} secondary /> : null}
          {eligible ? (
            <Text className="text-right leading-6 text-slate-700 dark:text-slate-200">
              بموافقتك، يرسل تطبيق الهاتف موقعك دورياً للتحقق من نطاق مكان العمل خلال هذه الوردية حتى عند إغلاق الشاشة.
              يمكنك إيقاف المشاركة من هنا في أي وقت. تسجيل الحضور والانصراف متاح وفق طريقة ورديتك.
              قد يتوقف التحقق عند إغلاق التطبيق من قائمة التطبيقات أو تغيير أذونات الموقع أو تفعيل توفير البطارية.
            </Text>
          ) : null}
          {location?.status === "exempt" && location.consented ? (
            <Text className="text-right leading-6 text-slate-700 dark:text-slate-200">
              بعد وصول حالة الاستثناء للتطبيق، يتوقف إرسال الإحداثيات ويُستأنف التحقق بعد انتهائه إذا بقي الإذن متاحاً.
            </Text>
          ) : null}
          {eligible && !pendingRevocation && !geofence.isError && (!location.consented || !device.data?.running) ? (
            <ActionButton label="أوافق على مشاركة موقعي لهذه الوردية" onPress={() => changeConsent(true)} disabled={busy} />
          ) : null}
          {stopAction}
          {revokeNotice}
        </View>
        {busy ? <Text accessibilityLiveRegion="polite" className="text-right text-slate-700 dark:text-slate-200">جارٍ التنفيذ…</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" className="text-right font-semibold text-emerald-700 dark:text-emerald-400">{notice}</Text> : null}
        {problem ? <Text accessibilityRole="alert" className="text-right font-medium text-red-700 dark:text-red-400">{problem}</Text> : null}
      </ScrollView>
      <Modal visible={scanning} onRequestClose={closeScanner} animationType="none">
        <Screen>
          <View className="flex-1 gap-4 py-5">
            <Text accessibilityRole="header" className="text-right text-xl font-bold text-slate-900 dark:text-slate-100">مسح رمز الحضور</Text>
            <Text className="text-right text-slate-700 dark:text-slate-200">وجّه الكاميرا إلى رمز QR الظاهر على شاشة الدوام.</Text>
            {scanning ? (
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onMountError={() => setScanError("تعذر فتح الكاميرا.")}
                onBarcodeScanned={({ data: raw }) => {
                  if (!scanningActive.current || !action || !shift) return;
                  const value = attendanceCode(raw);
                  if (!value) {
                    setScanError("رمز الحضور غير صالح. امسح الرمز الظاهر على شاشة الدوام.");
                    return;
                  }
                  closeScanner();
                  setCode({ value, action, shiftId: shift.shiftId });
                }}
              />
            ) : null}
            {scanError ? <Text accessibilityRole="alert" className="text-right text-red-700 dark:text-red-400">{scanError}</Text> : null}
            <ActionButton label="إلغاء المسح" onPress={closeScanner} secondary />
          </View>
        </Screen>
      </Modal>
    </Screen>
  );
}
