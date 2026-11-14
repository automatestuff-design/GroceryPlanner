import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { WEEKDAYS, type MealType, type PlanStrategy, type PlanTrack } from "@mealplan/core";
import { Button, Card, Muted, Segmented } from "@/components/ui";
import { api, nextMonday } from "@/lib/api";
import { DAY_LABEL, SLOT_LABEL } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { space, useTheme } from "@/theme";

/** Tap-first view of the week, for people who'd rather not chat. */
export default function PlanScreen() {
  const c = useTheme();
  const current = useAsync(() => api.currentPlan().catch(() => null));
  const [strategy, setStrategy] = useState<PlanStrategy>("meal-type");
  const [track, setTrack] = useState<PlanTrack>("standard");
  const [meals, setMeals] = useState<"dinner" | "all">("dinner");

  // Start the toggles from the current plan so "Regenerate" keeps its settings.
  useEffect(() => {
    const p = current.data?.plan;
    if (!p) return;
    setStrategy(p.strategy);
    setTrack(p.track);
    setMeals(p.meals.some((m) => m.slot !== "dinner") ? "all" : "dinner");
  }, [current.data?.plan.id]);

  async function generate() {
    const mealTypes: MealType[] = meals === "dinner" ? ["dinner"] : ["breakfast", "lunch", "dinner"];
    await api.createPlan({ strategy, track, mealTypes, weekStart: nextMonday() });
    await current.reload();
  }

  const byId = new Map(current.data?.recipes.map((r) => [r.id, r]) ?? []);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card>
        <Segmented value={strategy} onChange={setStrategy} options={[{ value: "meal-type", label: "By meal" }, { value: "macro", label: "By macros" }]} />
        <Segmented value={meals} onChange={setMeals} options={[{ value: "dinner", label: "Dinners" }, { value: "all", label: "All meals" }]} />
        <Segmented value={track} onChange={setTrack} options={[{ value: "standard", label: "Standard" }, { value: "longevity", label: "Longevity" }]} />
        <Button label={current.data ? "Regenerate week" : "Plan my week"} onPress={generate} variant={track === "longevity" ? "longevity" : "primary"} />
      </Card>

      {current.data && WEEKDAYS.map((day) => {
        const dayMeals = current.data!.plan.meals.filter((m) => m.day === day);
        if (!dayMeals.length) return null;
        return (
          <Card key={day}>
            <Text style={{ color: c.muted, fontWeight: "700" }}>{DAY_LABEL[day]}</Text>
            {dayMeals.map((m) => {
              const r = byId.get(m.recipeId);
              return (
                <View key={m.slot} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <Link href={`/recipe/${m.recipeId}`} asChild>
                    <Pressable style={{ flex: 1 }}>
                      <Muted>{SLOT_LABEL[m.slot]}{m.leftoverOf ? " · leftovers" : ""} · {r?.timeMinutes} min · {m.servings} servings</Muted>
                      <Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }}>{r?.title}</Text>
                    </Pressable>
                  </Link>
                  <Pressable accessibilityLabel={`Swap ${DAY_LABEL[day]} ${SLOT_LABEL[m.slot]}`} onPress={async () => { await api.swap(day, m.slot); await current.reload(); }}>
                    <Text style={{ color: c.accent, fontWeight: "600" }}>Swap</Text>
                  </Pressable>
                </View>
              );
            })}
          </Card>
        );
      })}
    </ScrollView>
  );
}
