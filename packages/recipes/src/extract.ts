import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/**
 * Reads a recipe the user gave us (pasted text, or screenshots of a TikTok, a cookbook
 * page or a recipe card) into structured ingredients and steps. Claude only transcribes
 * and normalises names; it never supplies nutrition. Calories and macros come from the
 * Canadian Nutrient File via calculateNutrition().
 */

export const EXTRACTION_MODEL = "claude-opus-5-5";

const UNITS = ["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "oz", "lb", "each", "clove", "can", "bunch"] as const;

const ExtractedRecipe = z.object({
  isRecipe: z.boolean().describe("False when the content has no usable recipe (e.g. only hashtags, or no ingredient list)"),
  problem: z.string().nullable().describe("If isRecipe is false or something is missing, a short, plain explanation for the user"),
  title: z.string(),
  servings: z.number().int().nullable(),
  servingsStated: z.boolean().describe("True only if the content states how many servings or people it makes"),
  totalMinutes: z.number().int().nullable(),
  mealTypes: z.array(z.enum(["breakfast", "lunch", "dinner", "snack"])),
  ingredients: z.array(z.object({
    text: z.string().describe("The ingredient line as written"),
    name: z.string().describe("Generic food name for a nutrition database: singular, no brand or prep words, keep words that change nutrition (cooked, canned, dried, smoked, whole wheat, light)"),
    quantity: z.number().nullable().describe("Decimal amount; null for 'to taste', 'a pinch' or no amount"),
    unit: z.enum(UNITS).nullable().describe("null when quantity is null"),
  })),
  steps: z.array(z.string()),
});

export type ExtractedRecipe = z.infer<typeof ExtractedRecipe>;

export interface ExtractInput {
  text?: string;
  /** Base64 screenshots or photos. */
  images?: { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }[];
  /** Where it came from, to help read it ("a TikTok recipe video by @creator"). */
  context?: string;
}

export class ExtractionError extends Error {}

const SYSTEM = `You transcribe recipes into structured data for a meal-planning app. The user gives you a recipe they want to save: pasted text (a video caption, a blog page, a note) and/or screenshots or photos (a TikTok frame, a cookbook page, a handwritten card).

Rules:
- Transcribe only what the content says. Never invent ingredients, amounts or steps. If an amount is missing, set quantity and unit to null.
- "name" is what a nutrition database would call the food: singular, generic, no brands, no preparation ("2 cups chopped fresh baby spinach" → "baby spinach"; "1 lb Kirkland boneless skinless chicken thighs" → "chicken thigh"). Keep words that change the nutrition: cooked vs dry, canned, dried, smoked, whole wheat, light or fat-free.
- Substitutes and blends: name the real food ("cauliflower rice" → "cauliflower", "zucchini noodles" → "zucchini", "chickpea pasta" → "chickpea pasta"). For a flavoured item, use the base food ("garlic butter" → "butter").
- Units: use the closest of g, kg, ml, l, tsp, tbsp, cup, oz, lb, each, clove, can, bunch. Countable things are "each" ("2 eggs" → 2 each). Convert fractions to decimals. "1 (15 oz) can" → 1 can. "A pinch", "a dash", "to taste" → null amount.
- Servings: use the stated number. If none is stated, estimate from the amounts and set servingsStated to false.
- Steps: short, in order, as written. Leave the array empty if the content has no method (common for TikTok captions); don't make steps up.
- If there's no usable ingredient list (only hashtags, a title, or a "recipe in bio" link), set isRecipe to false and explain in "problem" what the user should add, e.g. "The caption doesn't list the ingredients. Paste them, or add a screenshot of the video where they're shown."`;

export async function extractRecipe(input: ExtractInput, client: Anthropic = new Anthropic()): Promise<ExtractedRecipe> {
  if (!input.text?.trim() && !input.images?.length) throw new ExtractionError("Paste the recipe or add a screenshot of it.");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(input.images ?? []).map((img): Anthropic.Beta.BetaImageBlockParam => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data },
    })),
    {
      type: "text",
      text: [
        input.context ? `Source: ${input.context}.` : "",
        input.text?.trim() ? `Recipe text:\n${input.text.trim()}` : "The recipe is in the image(s) above.",
      ].filter(Boolean).join("\n\n"),
    },
  ];

  const response = await client.beta.messages.parse({
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    // Transcription doesn't need deep reasoning; low effort keeps it quick.
    output_config: { effort: "low", format: betaZodOutputFormat(ExtractedRecipe) },
    // On a safety-classifier decline, the API reruns the request on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") throw new ExtractionError("That content couldn't be read as a recipe.");
  if (response.stop_reason === "max_tokens") throw new ExtractionError("That recipe is too long to read in one go. Try a shorter excerpt.");
  if (!response.parsed_output) throw new ExtractionError("Couldn't read a recipe from that. Try pasting the ingredient list.");
  return response.parsed_output;
}
