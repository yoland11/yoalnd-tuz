import "../global.css";
import { I18nManager } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/application/query-client";
import { AuthProvider } from "@/application/auth-context";
import { DepartmentProvider } from "@/application/department-context";

// Arabic-first: force a right-to-left layout for the whole app.
if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <DepartmentProvider>
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="login" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="task/[id]"
                options={{
                  headerShown: true,
                  title: "تفاصيل المهمة",
                  headerBackTitle: "رجوع",
                }}
              />
            </Stack>
          </DepartmentProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
