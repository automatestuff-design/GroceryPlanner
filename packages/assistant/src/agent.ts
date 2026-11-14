import Anthropic from "@anthropic-ai/sdk";
import type { GrocerRegistry } from "@mealplan/grocers";
import { quickReplies, type Card } from "./cards";
import { SYSTEM_PROMPT } from "./prompt";
import type { PlannerStore } from "./store";
import { runTool, toolDefinitions, type ToolContext } from "./tools";

export const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 8;

export interface ChatTurnResult {
  /** Assistant text to show in the bubble. */
  text: string;
  cards: Card[];
  quickReplies: string[];
  /** Full updated history to persist and send back on the next turn. */
  messages: Anthropic.Beta.BetaMessageParam[];
}

export interface AssistantDeps {
  client?: Anthropic;
  store: PlannerStore;
  grocers: GrocerRegistry;
}

/**
 * One chat turn: append the user's message, let Claude call engine tools until it
 * answers, and return text + UI cards. History is append-only (thinking blocks and
 * tool turns are kept verbatim), which keeps the prompt cache warm.
 */
export async function chatTurn(
  deps: AssistantDeps,
  userId: string,
  history: Anthropic.Beta.BetaMessageParam[],
  userText: string,
): Promise<ChatTurnResult> {
  const client = deps.client ?? new Anthropic();
  const ctx: ToolContext = { userId, store: deps.store, grocers: deps.grocers, cards: [] };
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: "user", content: userText }];
  const tools = toolDefinitions();
  let text = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Chat is latency-sensitive; medium is this model's default. Measure "low" on real transcripts before lowering.
      output_config: { effort: "medium" },
      // On a safety-classifier decline, the API reruns the request on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });
    text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim() || text;

    if (response.stop_reason === "refusal") {
      text = "I can't help with that one, but I'm happy to keep planning meals with you.";
      break;
    }
    if (response.stop_reason === "max_tokens") {
      text ||= "That got long. Could you narrow it down a little?";
      break;
    }
    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") break;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    // Sequential on purpose: tools read and write the same household/plan.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const t of toolUses) {
      const r = await runTool(t.name, t.input, ctx);
      results.push({ type: "tool_result", tool_use_id: t.id, content: r.content, is_error: r.isError });
    }
    messages.push({ role: "user", content: results });
  }

  const household = await deps.store.getHousehold(userId).catch(() => undefined);
  return { text, cards: ctx.cards, quickReplies: quickReplies(ctx.cards, household), messages };
}
