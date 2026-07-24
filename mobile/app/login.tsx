import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/application/auth-context";
import { Screen } from "@/presentation/components/Screen";
import { errorMessage } from "@/presentation/components/states";

export default function LoginScreen() {
  const { status, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "authenticated") return <Redirect href="/" />;

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View className="flex-1 justify-center gap-6">
        <View className="items-center gap-2">
          <View className="h-16 w-16 items-center justify-center rounded-2xl bg-brand">
            <Text className="text-2xl font-black text-white">AJN</Text>
          </View>
          <Text className="text-xl font-bold text-slate-900 dark:text-white">
            AJN Staff
          </Text>
          <Text className="text-sm text-slate-500 dark:text-slate-400">
            بوابة الكادر الميداني
          </Text>
        </View>

        <View className="gap-3">
          <View className="gap-1">
            <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              اسم المستخدم
            </Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="اسم المستخدم"
              placeholderTextColor="#94a3b8"
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </View>
          <View className="gap-1">
            <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              كلمة المرور
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="كلمة المرور"
              placeholderTextColor="#94a3b8"
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </View>

          {error ? (
            <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text>
          ) : null}

          <Pressable
            disabled={!canSubmit}
            onPress={onSubmit}
            className="mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3.5"
            style={!canSubmit ? { opacity: 0.6 } : undefined}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : null}
            <Text className="text-base font-bold text-white">تسجيل الدخول</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
