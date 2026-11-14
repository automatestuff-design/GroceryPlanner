import { ScrollView, Text, View } from "react-native";
import { Button, Card, Muted, ProgressBar } from "@/components/ui";
import { api, nextMonday } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { space, useTheme } from "@/theme";

const PILLARS = [
  { title: "Protein at every meal", body: "30 g+ per main meal, with enough leucine (~2.5 g) to switch on muscle building. Muscle is the organ of longevity." },
  { title: "Fiber and plant variety", body: "30 g fiber a day and 30 different plants a week feed a diverse gut microbiome." },
  { title: "Oily fish twice a week", body: "Salmon, sardines, mackerel and trout for EPA and DHA omega-3s." },
  { title: "Legumes and fermented foods", body: "Beans and lentils several times a week; yogurt, kefir or kimchi most days." },
  { title: "Mostly whole foods", body: "Ultra-processed foods are pushed to the edges of the plan, not banned." },
];

/** The differentiator: a planning track for midlife muscle span and healthspan. */
export default function LongevityScreen() {
  const c = useTheme();
  const report = useAsync(() => api.longevity().catch(() => null));

  async function start() {
    await api.createPlan({ strategy: "macro", track: "longevity", mealTypes: ["breakfast", "lunch", "dinner"], weekStart: nextMonday() });
    await report.reload();
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Muted>Eating for muscle span and healthspan in your 40s, 50s and beyond. Food guidance, not medical advice.</Muted>

      {report.data ? (
        <Card style={{ backgroundColor: c.longevitySoft, borderColor: c.longevitySoft }}>
          <Text style={{ color: c.text, fontSize: 20, fontWeight: "700" }}>This week: {report.data.avgScore}/100</Text>
          {report.data.goals.map((g) => (
            <View key={g.id} style={{ gap: 4 }}>
              <Text style={{ color: c.text }}>{g.met ? "✓ " : ""}{g.label}: {g.actual} / {g.target}</Text>
              <ProgressBar value={g.target ? g.actual / g.target : 0} color={c.longevity} />
            </View>
          ))}
          {report.data.mealsUnderProtein.length > 0 && (
            <Muted>{report.data.mealsUnderProtein.length === 1 ? "1 meal is" : `${report.data.mealsUnderProtein.length} meals are`} under 30 g protein. Ask in chat: “fix the low-protein meals”.</Muted>
          )}
        </Card>
      ) : null}

      <Button label="Build a Longevity week" variant="longevity" onPress={start} />

      {PILLARS.map((p) => (
        <Card key={p.title}>
          <Text style={{ color: c.text, fontWeight: "700" }}>{p.title}</Text>
          <Muted>{p.body}</Muted>
        </Card>
      ))}
    </ScrollView>
  );
}
