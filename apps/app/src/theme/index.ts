import { useColorScheme } from "react-native";

/** Clean, calm, food-first: white space, one fresh green, soft cards. */
const palette = {
  light: {
    bg: "#FFFFFF", surface: "#F6F7F5", card: "#FFFFFF", border: "#E6E8E3",
    text: "#1C1F1A", muted: "#6B7166", accent: "#1F9D55", accentSoft: "#E6F5EC", onAccent: "#FFFFFF",
    longevity: "#7A5AF8", longevitySoft: "#EFEBFF", warn: "#D97706", userBubble: "#1F9D55", botBubble: "#F2F4F0",
  },
  dark: {
    bg: "#111311", surface: "#181B17", card: "#1E221D", border: "#2B3029",
    text: "#EEF1EC", muted: "#9AA195", accent: "#34C172", accentSoft: "#17301F", onAccent: "#0C150F",
    longevity: "#A08BFF", longevitySoft: "#25203D", warn: "#F59E0B", userBubble: "#2A8F57", botBubble: "#1E221D",
  },
};

export type Colors = typeof palette.light;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 14, lg: 20, pill: 999 };
export const font = { title: 26, h2: 19, body: 16, small: 13 };

export function useTheme(): Colors {
  return palette[useColorScheme() === "dark" ? "dark" : "light"];
}
