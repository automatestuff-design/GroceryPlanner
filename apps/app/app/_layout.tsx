import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useTheme } from "@/theme";

export default function RootLayout() {
  const c = useTheme();
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerTintColor: c.accent, contentStyle: { backgroundColor: c.bg }, headerStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="recipe/[id]" options={{ title: "Recipe", presentation: "modal" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
