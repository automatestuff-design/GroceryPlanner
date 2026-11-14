import { useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api, type Card } from "@/lib/api";
import { font, radius, space, useTheme } from "@/theme";
import { ChatCard } from "./ChatCards";

interface Msg { id: string; role: "user" | "assistant"; text: string; cards?: Card[] }

const WELCOME: Msg = {
  id: "welcome", role: "assistant",
  text: "Hi! Tell me who you're cooking for and I'll plan the week. Try “dinners for me, 30 minutes max” or “plan for our family of four, Mia is allergic to peanuts.”",
};

/** The primary surface: a message list, tappable result cards, quick-reply chips and an input. */
export function Chat({ onCards }: { onCards?: (cards: Card[]) => void }) {
  const c = useTheme();
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [chips, setChips] = useState<string[]>(["Plan my week", "Plan by macros", "Try the Longevity plan", "Switch to family"]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<Msg>>(null);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setDraft("");
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", text }]);
    setBusy(true);
    try {
      const reply = await api.chat(text);
      setMessages((m) => [...m, { id: `a${Date.now()}`, role: "assistant", text: reply.text, cards: reply.cards }]);
      setChips(reply.quickReplies);
      if (reply.cards.length) onCards?.(reply.cards);
    } catch (e) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: "assistant", text: `Sorry, that didn't go through. ${e instanceof Error ? e.message : ""}` }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        renderItem={({ item }) => (
          <View style={{ alignItems: item.role === "user" ? "flex-end" : "flex-start", gap: space.sm }}>
            {!!item.text && (
              <View style={[styles.bubble, { backgroundColor: item.role === "user" ? c.userBubble : c.botBubble }]}>
                <Text style={{ color: item.role === "user" ? "#fff" : c.text, fontSize: font.body, lineHeight: 22 }}>{item.text}</Text>
              </View>
            )}
            {item.cards?.map((card, i) => <View key={i} style={{ alignSelf: "stretch" }}><ChatCard card={card} /></View>)}
          </View>
        )}
        ListFooterComponent={busy ? <ActivityIndicator color={c.accent} style={{ alignSelf: "flex-start", margin: space.md }} /> : undefined}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm }} style={{ flexGrow: 0 }}>
        {chips.map((chip) => (
          <Pressable key={chip} onPress={() => send(chip)} style={[styles.chip, { borderColor: c.accent, backgroundColor: c.accentSoft }]}>
            <Text style={{ color: c.accent, fontWeight: "600" }}>{chip}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={[styles.inputRow, { borderTopColor: c.border, backgroundColor: c.bg }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => send(draft)}
          placeholder="Ask for a plan, a swap, or your grocery list…"
          placeholderTextColor={c.muted}
          style={[styles.input, { color: c.text, backgroundColor: c.surface }]}
          returnKeyType="send"
        />
        <Pressable accessibilityLabel="Send" onPress={() => send(draft)} style={[styles.send, { backgroundColor: c.accent }]}>
          <Text style={{ color: c.onAccent, fontWeight: "700" }}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: "85%", paddingVertical: space.sm + 2, paddingHorizontal: space.md + 2, borderRadius: radius.lg },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingVertical: space.sm, paddingHorizontal: space.md },
  inputRow: { flexDirection: "row", gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  input: { flex: 1, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: font.body },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
