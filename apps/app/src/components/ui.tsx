import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { font, radius, space, useTheme } from "@/theme";

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useTheme();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={[styles.title, { color: useTheme().text }]}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: useTheme().muted, fontSize: font.small }}>{children}</Text>;
}

export function Button({ label, onPress, variant = "primary", disabled }: { label: string; onPress: () => void; variant?: "primary" | "ghost" | "longevity"; disabled?: boolean }) {
  const c = useTheme();
  const bg = variant === "primary" ? c.accent : variant === "longevity" ? c.longevity : "transparent";
  const fg = variant === "ghost" ? c.accent : c.onAccent;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, borderColor: variant === "ghost" ? c.accent : bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}>
      <Text style={{ color: fg, fontWeight: "600", fontSize: font.body }}>{label}</Text>
    </Pressable>
  );
}

/** Two-to-four option pill toggle, used for Just me / Family and By meal / By macros. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const c = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surface }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: c.card, shadowOpacity: 0.08 }]}>
            <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? "600" : "400" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const c = useTheme();
  return (
    <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: c.surface, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: "100%", backgroundColor: color ?? c.accent }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  title: { fontSize: font.title, fontWeight: "700" },
  button: { paddingVertical: space.md, paddingHorizontal: space.xl, borderRadius: radius.pill, alignItems: "center", borderWidth: 1.5 },
  segmented: { flexDirection: "row", borderRadius: radius.pill, padding: 3 },
  segment: { flex: 1, paddingVertical: space.sm, paddingHorizontal: space.md, alignItems: "center", borderRadius: radius.pill, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0 },
});
