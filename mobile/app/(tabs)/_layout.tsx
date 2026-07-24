import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/application/auth-context";
import { colors } from "@/shared/theme";

/** Authenticated tab shell. Unauthenticated users are bounced to /login. */
export default function TabsLayout() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (status !== "authenticated") return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "الرئيسية" }} />
      <Tabs.Screen name="tasks" options={{ title: "المهام" }} />
    </Tabs>
  );
}
