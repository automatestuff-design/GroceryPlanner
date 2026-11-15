import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { AISLE_ORDER, groceryListText, type GroceryList } from "@mealplan/core";
import { Button, Card, Muted } from "@/components/ui";
import { api } from "@/lib/api";
import { AISLE_LABEL, qty } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { radius, space, useTheme } from "@/theme";

/**
 * The grocery list: this week's plan ingredients by aisle, plus your own items.
 * Check-offs are saved, so the list matches on every device and in chat.
 */
export default function GroceriesScreen() {
  const c = useTheme();
  const list = useAsync(api.groceryList);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  /** Shown when neither the share sheet nor the clipboard is available, so the list can be copied by hand. */
  const [manualCopy, setManualCopy] = useState<string | null>(null);

  // Chat may have changed the list; refresh whenever the tab comes into view.
  useFocusEffect(useCallback(() => { void list.reload(); }, [list.reload]));

  /** Apply a change optimistically, then replace with the server's list (or roll back). */
  async function change(optimistic: (l: GroceryList) => GroceryList, request: () => Promise<GroceryList>) {
    const before = list.data;
    if (before) list.setData(optimistic(before));
    try {
      list.setData(await request());
      setNote(null);
    } catch (e) {
      list.setData(before);
      setNote(e instanceof Error ? e.message : "That didn't save. Try again.");
    }
  }

  const toggleItem = (key: string, checked: boolean) =>
    change((l) => ({ ...l, items: l.items.map((i) => (i.key === key ? { ...i, checked } : i)) }), () => api.checkItem(key, checked));
  const toggleExtra = (id: string, checked: boolean) =>
    change((l) => ({ ...l, extras: l.extras.map((e) => (e.id === id ? { ...e, checked } : e)) }), () => api.updateExtra(id, { checked }));
  const removeExtra = (id: string) =>
    change((l) => ({ ...l, extras: l.extras.filter((e) => e.id !== id) }), () => api.removeExtra(id));

  async function add() {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    await change((l) => ({ ...l, extras: [...l.extras, { id: `pending-${name}`, name, checked: false }] }), () => api.addExtras([{ name }]));
  }

  async function share() {
    if (!list.data) return;
    const text = groceryListText(list.data, { title: "Grocery list" });
    try {
      if (Platform.OS === "web" && !(typeof navigator !== "undefined" && "share" in navigator)) throw new Error("no web share");
      await Share.share({ message: text });
    } catch {
      try {
        await Clipboard.setStringAsync(text);
        setNote("List copied. Paste it into a message or your notes.");
      } catch {
        setManualCopy(text);
      }
    }
  }

  const l = list.data;
  if (!l) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        {list.error ? (
          <Card>
            <Text style={{ color: c.warn, fontWeight: "700" }}>Couldn't load your list</Text>
            <Muted>{list.error}</Muted>
            <Button label="Try again" variant="ghost" onPress={list.reload} />
          </Card>
        ) : <Muted>Loading…</Muted>}
      </ScrollView>
    );
  }

  const left = l.items.filter((i) => !i.checked).length + l.extras.filter((e) => !e.checked).length;
  const total = l.items.length + l.extras.length;
  const checkedExtras = l.extras.filter((e) => e.checked).length;
  const aisles = AISLE_ORDER.filter((a) => l.items.some((i) => i.aisle === a));

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontSize: 20, fontWeight: "700" }}>{total ? `${left} to buy` : "Your list is empty"}</Text>
          {total > 0 && <Muted>{total - left} of {total} done</Muted>}
        </View>
        {total > 0 && <Button label="Share" variant="ghost" onPress={share} />}
      </View>

      <View style={styles.addRow}>
        <TextInput
          value={draft} onChangeText={setDraft} onSubmitEditing={add} returnKeyType="done"
          placeholder="Add an item, e.g. paper towels" placeholderTextColor={c.muted}
          style={[styles.input, { color: c.text, backgroundColor: c.surface }]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Add item" onPress={add} disabled={!draft.trim()}
          style={[styles.addButton, { backgroundColor: c.accent, opacity: draft.trim() ? 1 : 0.5 }]}>
          <Text style={{ color: c.onAccent, fontSize: 22, fontWeight: "700" }}>+</Text>
        </Pressable>
      </View>
      {note && <Muted>{note}</Muted>}
      {manualCopy && (
        <Card>
          <Muted>Select and copy your list:</Muted>
          <Text selectable style={{ color: c.text, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>{manualCopy}</Text>
          <Button label="Done" variant="ghost" onPress={() => setManualCopy(null)} />
        </Card>
      )}

      {!l.planId && !l.extras.length && <Muted>Plan a week in Chat or the Plan tab and its ingredients show up here, grouped by aisle.</Muted>}

      {aisles.map((aisle) => (
        <Card key={aisle}>
          <Muted>{AISLE_LABEL[aisle] ?? aisle}</Muted>
          {l.items.filter((i) => i.aisle === aisle).map((i) => (
            <Row key={i.key} label={i.name} detail={qty(i.quantity, i.unit)} checked={i.checked} onToggle={() => toggleItem(i.key, !i.checked)} />
          ))}
        </Card>
      ))}

      {l.extras.length > 0 && (
        <Card>
          <Muted>Your items</Muted>
          {l.extras.map((e) => (
            <Row key={e.id} label={e.name} detail={e.quantity} checked={e.checked} onToggle={() => toggleExtra(e.id, !e.checked)} onRemove={() => removeExtra(e.id)} />
          ))}
          {checkedExtras > 0 && (
            <Button label={`Clear ${checkedExtras} checked`} variant="ghost"
              onPress={() => change((x) => ({ ...x, extras: x.extras.filter((e) => !e.checked) }), api.clearChecked)} />
          )}
        </Card>
      )}

      {l.pantryExcluded.length > 0 && <Muted>Left off because they're in your pantry: {l.pantryExcluded.join(", ")}</Muted>}
    </ScrollView>
  );
}

function Row({ label, detail, checked, onToggle, onRemove }: {
  label: string; detail?: string; checked: boolean; onToggle: () => void; onRemove?: () => void;
}) {
  const c = useTheme();
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} onPress={onToggle} style={styles.rowMain}>
        <View style={[styles.box, { borderColor: checked ? c.accent : c.border, backgroundColor: checked ? c.accent : "transparent" }]}>
          {checked && <Text style={{ color: c.onAccent, fontSize: 13, fontWeight: "800" }}>✓</Text>}
        </View>
        <Text style={{ flex: 1, color: checked ? c.muted : c.text, textDecorationLine: checked ? "line-through" : "none" }}>{label}</Text>
        {detail ? <Text style={{ color: c.muted }}>{detail}</Text> : null}
      </Pressable>
      {onRemove && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} onPress={onRemove} hitSlop={8} style={{ paddingLeft: space.md }}>
          <Text style={{ color: c.muted, fontSize: 16 }}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg, maxWidth: 760, width: "100%", alignSelf: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  addRow: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  input: { flex: 1, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 16 },
  addButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center" },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
