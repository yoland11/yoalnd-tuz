import { ActivityIndicator, Text, View } from "react-native";
import { ApiError } from "@/infrastructure/http-client";

export function LoadingState({ label = "جارٍ التحميل…" }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 py-16">
      <ActivityIndicator color="#0f766e" />
      <Text className="text-sm text-slate-500 dark:text-slate-400">{label}</Text>
    </View>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <View className="flex-1 items-center justify-center py-16">
      <Text className="text-center text-sm text-slate-400 dark:text-slate-500">{label}</Text>
    </View>
  );
}

/** Turns any thrown value into an Arabic message, honoring the API envelope. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "لا يوجد اتصال بالخادم. تحقّق من الشبكة.";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "حدث خطأ غير متوقع";
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 py-16">
      <Text className="text-center text-sm text-red-600 dark:text-red-400">
        {errorMessage(error)}
      </Text>
      {onRetry ? (
        <Text
          onPress={onRetry}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          إعادة المحاولة
        </Text>
      ) : null}
    </View>
  );
}
