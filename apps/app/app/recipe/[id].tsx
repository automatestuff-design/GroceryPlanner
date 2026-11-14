import { useLocalSearchParams, Stack } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Button, Card, Muted, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { qty } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { space, useTheme } from "@/theme";

/** Recipe detail with numbered steps (cook mode). */
export default function RecipeScreen() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useAsync(() => api.recipe(id), [id]).data;
  if (!r) return null;
  const n = r.nutritionPerServing;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Stack.Screen options={{ title: r.title }} />
      <Title>{r.title}</Title>
      <Muted>{r.timeMinutes} min · serves {r.servings} · {n.calories} kcal · {n.proteinG} g protein · {n.fiberG} g fiber per serving</Muted>
      <Card>
        <Text style={{ color: c.text, fontWeight: "700" }}>Ingredients</Text>
        {r.ingredients.map((i) => <Text key={i.name} style={{ color: c.text }}>• {qty(i.quantity, i.unit)} {i.name}</Text>)}
      </Card>
      {r.steps.length > 0 && (
        <Card>
          <Text style={{ color: c.text, fontWeight: "700" }}>Steps</Text>
          {r.steps.map((s, idx) => (
            <View key={idx} style={{ flexDirection: "row", gap: space.md }}>
              <Text style={{ color: c.accent, fontWeight: "700" }}>{idx + 1}</Text>
              <Text style={{ color: c.text, flex: 1, lineHeight: 22 }}>{s}</Text>
            </View>
          ))}
        </Card>
      )}
      {r.source && (
        <Card>
          <Muted>Recipe from {r.source.name}{r.source.attribution && r.source.attribution !== r.source.name ? ` · ${r.source.attribution}` : ""}{r.source.license ? ` · ${r.source.license}` : ""}</Muted>
          {r.source.url && (
            <Button label={r.steps.length ? `View on ${r.source.name}` : `Get the steps on ${r.source.name}`} variant={r.steps.length ? "ghost" : "primary"}
              onPress={() => WebBrowser.openBrowserAsync(r.source!.url!)} />
          )}
        </Card>
      )}
    </ScrollView>
  );
}
