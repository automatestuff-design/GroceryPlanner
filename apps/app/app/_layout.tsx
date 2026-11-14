import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useTheme } from "@/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <RootStack />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/** Signed-out users only reach /sign-in; signed-in users never see it. */
function RootStack() {
  const c = useTheme();
  const { ready, signedIn } = useAuth();
  if (!ready) {
    return <View style={{ flex: 1, justifyContent: "center", backgroundColor: c.bg }}><ActivityIndicator color={c.accent} /></View>;
  }
  return (
    <Stack screenOptions={{ headerTintColor: c.accent, contentStyle: { backgroundColor: c.bg }, headerStyle: { backgroundColor: c.bg } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="recipe/[id]" options={{ title: "Recipe", presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
