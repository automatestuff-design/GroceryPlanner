import { useState } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import type { HouseholdMode } from "@mealplan/core";
import { Chat } from "@/components/Chat";
import { ChatCard } from "@/components/ChatCards";
import { HouseholdSwitcher } from "@/components/HouseholdSwitcher";
import { Muted } from "@/components/ui";
import { api, type Card } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { space, useTheme } from "@/theme";

/**
 * Home is the chat. On desktop-width screens the latest plan/list stays pinned
 * in a side panel so the conversation and the week are visible together.
 */
export default function ChatScreen() {
  const c = useTheme();
  const wide = useWindowDimensions().width >= 900;
  const household = useAsync(api.household);
  const [pinned, setPinned] = useState<Card[]>([]);

  async function setMode(mode: HouseholdMode) {
    household.setData(await api.updateHousehold({ mode }));
  }

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.bg }}>
      <View style={{ flex: 1, maxWidth: wide ? 720 : undefined }}>
        <View style={{ padding: space.lg, paddingBottom: 0 }}>
          {household.data && <HouseholdSwitcher mode={household.data.mode} onChange={setMode} />}
        </View>
        <Chat onCards={(cards) => setPinned(cards.filter((x) => x.type !== "household"))} />
      </View>
      {wide && (
        <ScrollView style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: c.border }} contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
          {pinned.length ? pinned.map((card, i) => <ChatCard key={i} card={card} />) : <Muted>Your plan and grocery list will appear here.</Muted>}
        </ScrollView>
      )}
    </View>
  );
}
