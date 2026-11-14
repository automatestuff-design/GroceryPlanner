import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useWindowDimensions, type ColorValue } from "react-native";
import { useTheme } from "@/theme";

type Icon = keyof typeof Ionicons.glyphMap;
const tab = (title: string, icon: Icon) => ({
  title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={icon} color={color as string} size={size} />,
});

/** Bottom tabs on phones; a left rail on tablets and desktop. */
export default function TabsLayout() {
  const c = useTheme();
  const wide = useWindowDimensions().width >= 900;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarPosition: wide ? "left" : "bottom",
        tabBarVariant: wide ? "material" : "uikit",
        tabBarStyle: { backgroundColor: c.bg, borderColor: c.border },
        headerStyle: { backgroundColor: c.bg },
        headerTitleStyle: { color: c.text },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={tab("Chat", "chatbubble-ellipses-outline")} />
      <Tabs.Screen name="plan" options={{ ...tab("Plan", "calendar-outline"), headerTitle: "This week" }} />
      <Tabs.Screen name="groceries" options={tab("Groceries", "cart-outline")} />
      <Tabs.Screen name="longevity" options={tab("Longevity", "pulse-outline")} />
      <Tabs.Screen name="settings" options={tab("Household", "people-outline")} />
    </Tabs>
  );
}
