import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import type { Diet } from "@mealplan/core";
import { HouseholdSwitcher } from "@/components/HouseholdSwitcher";
import { Button, Card, Muted, Segmented } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAsync } from "@/lib/useAsync";
import { space, useTheme } from "@/theme";

/** Household setup. Adding members works best in chat ("add Mia, 7, allergic to peanuts"). */
export default function SettingsScreen() {
  const c = useTheme();
  const auth = useAuth();
  const h = useAsync(api.household);
  const [link, setLink] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  if (!h.data) return null;

  async function importLink() {
    setImportMsg("Importing…");
    try {
      const r = await api.importRecipe(link.trim());
      setImportMsg(`Added “${r.title}” to your recipes.`);
      setLink("");
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : "Couldn't import that link.");
    }
  }
  const household = h.data;
  const save = async (patch: Parameters<typeof api.updateHousehold>[0]) => h.setData(await api.updateHousehold(patch));

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <HouseholdSwitcher mode={household.mode} onChange={(mode) => save({ mode })} />
      <Card>
        <Text style={{ color: c.text, fontWeight: "700" }}>Diet</Text>
        <Segmented<Diet> value={household.diet} onChange={(diet) => save({ diet })}
          options={[{ value: "omnivore", label: "Anything" }, { value: "pescatarian", label: "Pesc." }, { value: "vegetarian", label: "Veg." }, { value: "vegan", label: "Vegan" }]} />
      </Card>
      <Card>
        <Text style={{ color: c.text, fontWeight: "700" }}>{household.mode === "family" ? "Family members" : "You"}</Text>
        {household.members.map((m) => (
          <View key={m.id}>
            <Text style={{ color: c.text }}>{m.name} · {m.ageGroup}</Text>
            {(m.allergies.length > 0 || m.dislikes.length > 0) && (
              <Muted>{[m.allergies.length && `Allergies: ${m.allergies.join(", ")}`, m.dislikes.length && `Dislikes: ${m.dislikes.join(", ")}`].filter(Boolean).join(" · ")}</Muted>
            )}
          </View>
        ))}
        <Muted>Tip: add people in chat, e.g. “add Leo, 3, no dairy”.</Muted>
      </Card>
      <Card>
        <Text style={{ color: c.text, fontWeight: "700" }}>Pantry staples</Text>
        <Muted>{household.pantry.join(", ") || "None yet"}</Muted>
      </Card>
      <Card>
        <Text style={{ color: c.text, fontWeight: "700" }}>Add a recipe from a link</Text>
        <Muted>Paste a recipe page. It needs nutrition info so the planner can use it. Only your household sees it.</Muted>
        <TextInput value={link} onChangeText={setLink} placeholder="https://…" placeholderTextColor={c.muted} autoCapitalize="none" inputMode="url"
          style={{ color: c.text, backgroundColor: c.surface, borderRadius: 12, padding: space.md }} />
        <Button label="Add recipe" variant="ghost" disabled={!link.startsWith("http")} onPress={importLink} />
        {importMsg && <Muted>{importMsg}</Muted>}
      </Card>
      <Card>
        <Text style={{ color: c.text, fontWeight: "700" }}>Account</Text>
        {auth.devMode ? <Muted>Development mode: sign-in is off.</Muted> : (
          <>
            <Muted>Signed in as {auth.email}</Muted>
            <Button label="Sign out" variant="ghost" onPress={auth.signOut} />
          </>
        )}
      </Card>
    </ScrollView>
  );
}
