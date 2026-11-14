import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Button, Card, Muted } from "@/components/ui";
import { api } from "@/lib/api";
import { AISLE_LABEL, qty } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { space, useTheme } from "@/theme";

/** Aisle-grouped checklist plus one-tap hand-off to a grocer. */
export default function GroceriesScreen() {
  const c = useTheme();
  const list = useAsync(() => api.shoppingList().catch(() => null));
  const grocers = useAsync(api.grocers);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<string | null>(null);

  async function order(id: string) {
    setSending(id);
    try {
      const cart = await api.sendToGrocer(id);
      if (cart.checkoutUrl) await WebBrowser.openBrowserAsync(cart.checkoutUrl);
    } finally { setSending(null); }
  }

  const items = list.data?.items ?? [];
  const aisles = [...new Set(items.map((i) => i.aisle))];

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      {!list.data && <Muted>Plan a week first and your list shows up here.</Muted>}

      {list.data && (
        <Card>
          <Text style={{ color: c.text, fontWeight: "700" }}>Get it delivered</Text>
          {grocers.data?.map((g) => (
            <View key={g.id} style={{ gap: 4 }}>
              <Button
                label={g.status === "live" ? `Send to ${g.name}` : `${g.name} (coming soon)`}
                variant={g.status === "live" && g.configured ? "primary" : "ghost"}
                disabled={sending !== null || !g.configured && g.status === "live"}
                onPress={() => order(g.id)}
              />
              {g.banners?.length ? <Muted>{g.banners.join(" · ")}</Muted> : null}
              {g.id === "kroger" && g.configured && (
                <Button label="Link my Kroger account" variant="ghost" onPress={async () => {
                  const { url } = await api.linkKroger();
                  await WebBrowser.openBrowserAsync(url);
                }} />
              )}
            </View>
          ))}
        </Card>
      )}

      {aisles.map((a) => (
        <Card key={a}>
          <Muted>{AISLE_LABEL[a] ?? a}</Muted>
          {items.filter((i) => i.aisle === a).map((i) => {
            const key = `${i.name}|${i.unit}`;
            const on = checked.has(key);
            return (
              <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                onPress={() => setChecked((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
                <Text style={{ color: on ? c.muted : c.text, textDecorationLine: on ? "line-through" : "none" }}>{on ? "☑" : "☐"}  {i.name}</Text>
                <Text style={{ color: c.muted }}>{qty(i.quantity, i.unit)}</Text>
              </Pressable>
            );
          })}
        </Card>
      ))}
      {!!list.data?.pantryExcluded.length && <Muted>Already in your pantry: {list.data.pantryExcluded.join(", ")}</Muted>}
    </ScrollView>
  );
}
