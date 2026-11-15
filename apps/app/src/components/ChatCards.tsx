import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { WEEKDAYS } from "@mealplan/core";
import type { Card as CardData } from "@/lib/api";
import { AISLE_LABEL, DAY_LABEL, SLOT_LABEL, qty } from "@/lib/format";
import { space, useTheme } from "@/theme";
import { Button, Card, Muted, ProgressBar } from "./ui";

/** Renders the structured result of a tool call under an assistant message. */
export function ChatCard({ card }: { card: CardData }) {
  switch (card.type) {
    case "plan": return <PlanCard card={card} />;
    case "shopping-list": return <ListCard card={card} />;
    case "longevity": return <LongevityCard card={card} />;
    case "household": return <HouseholdCard card={card} />;
  }
}

function PlanCard({ card }: { card: Extract<CardData, { type: "plan" }> }) {
  const c = useTheme();
  const byId = new Map(card.recipes.map((r) => [r.id, r]));
  return (
    <Card>
      <Text style={{ color: c.text, fontWeight: "700" }}>
        Week of {card.plan.weekStart}{card.plan.track === "longevity" ? " · Longevity" : ""}{card.plan.strategy === "macro" ? " · Macro-fit" : ""}
      </Text>
      {WEEKDAYS.map((day) => {
        const meals = card.plan.meals.filter((m) => m.day === day);
        if (!meals.length) return null;
        return (
          <View key={day} style={{ flexDirection: "row", gap: space.md }}>
            <Text style={{ width: 36, color: c.muted, fontWeight: "600" }}>{DAY_LABEL[day]}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              {meals.map((m) => {
                const r = byId.get(m.recipeId);
                return (
                  <Link key={m.slot} href={`/recipe/${m.recipeId}`} asChild>
                    <Pressable>
                      <Text style={{ color: c.text }} numberOfLines={1}>
                        {meals.length > 1 ? `${SLOT_LABEL[m.slot]}: ` : ""}{r?.title}{m.leftoverOf ? " (leftovers)" : ""}
                      </Text>
                    </Pressable>
                  </Link>
                );
              })}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

/** Compact read-only view in chat; the Groceries tab is where you tick things off. */
function ListCard({ card }: { card: Extract<CardData, { type: "shopping-list" }> }) {
  const c = useTheme();
  const toBuy = card.list.items.filter((i) => !i.checked);
  const ownToBuy = card.list.extras.filter((e) => !e.checked);
  const done = card.list.items.length + card.list.extras.length - toBuy.length - ownToBuy.length;
  const aisles = [...new Set(toBuy.map((i) => i.aisle))];
  return (
    <Card>
      <Text style={{ color: c.text, fontWeight: "700" }}>
        {toBuy.length + ownToBuy.length} to buy{done ? ` · ${done} done` : ""}
      </Text>
      {aisles.map((a) => (
        <View key={a}>
          <Muted>{AISLE_LABEL[a] ?? a}</Muted>
          <Text style={{ color: c.text }}>
            {toBuy.filter((i) => i.aisle === a).map((i) => `${i.name} (${qty(i.quantity, i.unit)})`).join(" · ")}
          </Text>
        </View>
      ))}
      {ownToBuy.length > 0 && (
        <View>
          <Muted>Your items</Muted>
          <Text style={{ color: c.text }}>{ownToBuy.map((e) => (e.quantity ? `${e.name} (${e.quantity})` : e.name)).join(" · ")}</Text>
        </View>
      )}
      {card.list.pantryExcluded.length > 0 && <Muted>Skipped (in your pantry): {card.list.pantryExcluded.join(", ")}</Muted>}
      <Link href="/groceries" asChild>
        <Pressable><Text style={{ color: c.accent, fontWeight: "600" }}>Open grocery list →</Text></Pressable>
      </Link>
    </Card>
  );
}

function LongevityCard({ card }: { card: Extract<CardData, { type: "longevity" }> }) {
  const c = useTheme();
  return (
    <Card style={{ backgroundColor: c.longevitySoft, borderColor: c.longevitySoft }}>
      <Text style={{ color: c.text, fontWeight: "700" }}>Longevity score {card.report.avgScore}/100</Text>
      {card.report.goals.map((g) => (
        <View key={g.id} style={{ gap: 4 }}>
          <Text style={{ color: c.text, fontSize: 13 }}>{g.met ? "✓ " : ""}{g.label}: {g.actual} / {g.target}</Text>
          <ProgressBar value={g.target ? g.actual / g.target : 0} color={c.longevity} />
        </View>
      ))}
    </Card>
  );
}

function HouseholdCard({ card }: { card: Extract<CardData, { type: "household" }> }) {
  const c = useTheme();
  const h = card.household;
  return (
    <Card>
      <Text style={{ color: c.text, fontWeight: "700" }}>{h.mode === "family" ? `Family of ${h.members.length}` : "Just you"} · {h.diet}</Text>
      {h.mode === "family" && <Muted>{h.members.map((m) => `${m.name} (${m.ageGroup}${m.allergies.length ? `, no ${m.allergies.join("/")}` : ""})`).join(" · ")}</Muted>}
    </Card>
  );
}
