import * as ImagePicker from "expo-image-picker";
import { Link } from "expo-router";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api, ApiError, type ImportImage, type ImportResult } from "@/lib/api";
import { radius, space, useTheme } from "@/theme";
import { Button, Card, Muted } from "./ui";

const MAX_IMAGES = 4;
/** Base64 is ~4/3 the file size; the API accepts up to ~5 MB per image. */
const MAX_BASE64 = 7_000_000;

const isTikTok = (url: string) => /^https?:\/\/([a-z]+\.)?tiktok\.com\//i.test(url.trim());

/**
 * Save a recipe from anywhere: a recipe web page, a TikTok (with the ingredients pasted
 * or a screenshot, since TikTok doesn't share captions with apps), a cookbook photo, or
 * a recipe typed in. Nutrition comes from the source or is calculated from the
 * ingredients with Health Canada's Canadian Nutrient File.
 */
export function AddRecipe() {
  const c = useTheme();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [images, setImages] = useState<(ImportImage & { uri: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const tiktok = isTikTok(url);
  const canSave = !busy && (url.trim().startsWith("http") || text.trim().length > 0 || images.length > 0);

  async function pickImages() {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES - images.length,
      quality: 0.6,
      base64: true,
    });
    if (picked.canceled) return;
    const next = picked.assets
      .filter((a) => a.base64)
      .map((a) => ({ uri: a.uri, data: a.base64!, mediaType: toMediaType(a.mimeType) }));
    if (next.some((i) => i.data.length > MAX_BASE64)) setMessage("One of those images is too large. Try a screenshot instead of a full-size photo.");
    setImages((prev) => [...prev, ...next.filter((i) => i.data.length <= MAX_BASE64)].slice(0, MAX_IMAGES));
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    setResult(null);
    try {
      const res = await api.importRecipe({
        url: url.trim() || undefined,
        text: text.trim() || undefined,
        images: images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined,
      });
      setResult(res);
      setUrl(""); setText(""); setImages([]);
    } catch (e) {
      // "needs_details": e.g. a TikTok link on its own. Keep the form so they can add the recipe.
      setMessage(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't save that recipe.");
    } finally {
      setBusy(false);
    }
  }

  const input = [styles.input, { color: c.text, backgroundColor: c.surface }];

  return (
    <Card>
      <Text style={{ color: c.text, fontWeight: "700" }}>Add a recipe</Text>
      <Muted>From a recipe site, a TikTok, a cookbook photo, or your own. Only your household sees it.</Muted>

      <TextInput value={url} onChangeText={setUrl} placeholder="Link (optional): recipe page or TikTok" placeholderTextColor={c.muted}
        autoCapitalize="none" autoCorrect={false} inputMode="url" style={input} />
      {tiktok && (
        <Muted>TikTok doesn't share video captions with other apps. Paste the ingredients below, or add a screenshot of the video where the recipe is shown.</Muted>
      )}

      <TextInput value={text} onChangeText={setText} multiline numberOfLines={5} textAlignVertical="top"
        placeholder={"Paste the recipe or ingredients, e.g.\n2 lb chicken breasts\n1 jar (16 oz) salsa\n2 cups cooked rice"}
        placeholderTextColor={c.muted} style={[input, styles.multiline]} />

      <View style={styles.row}>
        {images.map((img, i) => (
          <Pressable key={img.uri} onPress={() => setImages((prev) => prev.filter((_, j) => j !== i))} accessibilityLabel="Remove screenshot">
            <Image source={{ uri: img.uri }} style={[styles.thumb, { borderColor: c.border }]} />
            <Text style={[styles.remove, { backgroundColor: c.text, color: c.bg }]}>✕</Text>
          </Pressable>
        ))}
        {images.length < MAX_IMAGES && (
          <Pressable onPress={pickImages} style={[styles.thumb, styles.addThumb, { borderColor: c.border }]} accessibilityRole="button" accessibilityLabel="Add screenshots">
            <Text style={{ color: c.muted, fontSize: 24 }}>+</Text>
            <Text style={{ color: c.muted, fontSize: 11 }}>Screenshot</Text>
          </Pressable>
        )}
      </View>

      <Button label={busy ? "Reading the recipe…" : "Save recipe"} onPress={save} disabled={!canSave} />
      {message && <Text style={{ color: c.warn }}>{message}</Text>}

      {result && <Saved result={result} />}
    </Card>
  );
}

function Saved({ result }: { result: ImportResult }) {
  const c = useTheme();
  const { recipe } = result;
  const n = recipe.nutritionPerServing;
  const basis = recipe.nutritionBasis;
  return (
    <View style={[styles.saved, { backgroundColor: c.accentSoft }]}>
      <Text style={{ color: c.text, fontWeight: "700" }}>Saved “{recipe.title}”</Text>
      <Muted>{recipe.servings} servings · {n.calories} kcal · {n.proteinG} g protein · {n.fiberG} g fiber per serving{recipe.source?.name ? ` · ${recipe.source.name}` : ""}</Muted>
      {basis && <NutritionNote basis={basis} />}
      <Link href={`/recipe/${encodeURIComponent(recipe.id)}`} asChild>
        <Pressable><Text style={{ color: c.accent, fontWeight: "600" }}>View recipe →</Text></Pressable>
      </Link>
    </View>
  );
}

/** How the nutrition was worked out, and what it leaves out. Shared with the recipe screen. */
export function NutritionNote({ basis }: { basis: NonNullable<ImportResult["recipe"]["nutritionBasis"]> }) {
  const c = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Muted>
        {basis.method === "published" ? "Nutrition as published by the source." : `Nutrition calculated from the ingredients using Health Canada's ${basis.database ?? "Canadian Nutrient File"}.`}
        {basis.servingsEstimated ? " The recipe didn't say how many servings, so that's an estimate." : ""}
      </Muted>
      {basis.missing.length > 0 && <Text style={{ color: c.warn, fontSize: 13 }}>Not counted: {basis.missing.join(", ")}</Text>}
      {basis.uncertain.length > 0 && <Muted>Approximate: {basis.uncertain.join(", ")}</Muted>}
    </View>
  );
}

function toMediaType(mime: string | null | undefined): ImportImage["mediaType"] {
  return mime === "image/png" || mime === "image/webp" || mime === "image/gif" ? mime : "image/jpeg";
}

const styles = StyleSheet.create({
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, fontSize: 15 },
  multiline: { minHeight: 110 },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, borderWidth: 1 },
  addThumb: { alignItems: "center", justifyContent: "center", borderStyle: "dashed" },
  remove: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, textAlign: "center", fontSize: 11, lineHeight: 20, overflow: "hidden" },
  saved: { borderRadius: radius.md, padding: space.md, gap: space.xs },
});
