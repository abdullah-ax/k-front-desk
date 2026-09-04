/**
 * Model adapter — the ONLY module in this codebase permitted to import a
 * provider SDK. Everything else asks for a role.
 *
 * Three roles, one env var each, so any of them can be repointed without a code
 * change (.claude/plans/front-desk.plan.md, task 2):
 *
 *   MODEL_EXTRACT  bulk pass over 6,954 notes. ~95% of spend. Cheap and
 *                  reliable at structured output matters more than capability.
 *   MODEL_AGENT    the conversation, on the test line and in every gate.
 *                  Latency and instruction adherence. The role to upgrade
 *                  first if the refusal boundaries prove leaky.
 *
 *                  IT DOES NOT REACH THE PHONE BY ITSELF. Vapi owns the audio
 *                  loop on a call, so it calls the model directly using the
 *                  assistant's own configuration, and this env var is invisible
 *                  to it. `scripts/provision-vapi.ts` reads this slug and
 *                  pushes it into that configuration, so the two agree only
 *                  after a re-provision. For most of this build they did not:
 *                  the phone ran gpt-4o-mini at temperature 0.3 while every
 *                  gate measured deepseek at 0, and nothing said so because
 *                  nothing errored. `pnpm test:phone` now fails on the gap.
 *   MODEL_JUDGE    scoring replay tests. Strongest available; runs rarely.
 *
 * Routed through OpenRouter by decision. If the live call proves too slow, only
 * MODEL_AGENT needs to move to a direct provider — a one-line change here.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { requireEnv, env, BUDGET_FLOOR_USD, type ModelRole } from "../config.js";
import { httpFetch } from "../http.js";

let provider: ReturnType<typeof createOpenRouter> | undefined;

function openrouter() {
  if (!provider) {
    provider = createOpenRouter({
      apiKey: requireEnv("OPENROUTER_API_KEY", "A2"),
      headers: {
        // Attribution; harmless if unset upstream.
        "HTTP-Referer": env("PUBLIC_URL") ?? "http://localhost",
        // ASCII only: HTTP header values are ByteStrings and a non-Latin-1
        // character here throws before the request is ever sent.
        "X-Title": "Front Desk - Gulf Breeze Air",
      },
    });
  }
  return provider;
}

function forRole(role: ModelRole): LanguageModel {
  const slug = requireEnv(role, "A3");
  return openrouter().chat(slug);
}

/**
 * The live conversation. Thinking stays ON, and this is the second time that
 * conclusion has been reached the hard way.
 *
 * The model cannot be swapped. `gpt-4.1-mini` (1,082 ms, 4/4 tools) told a
 * caller asking about the COMPRESSOR that "the blower motor is no longer under
 * warranty" and took the red team from 19/19 to 18/19. `ministral-8b` returned
 * 3/4 on tools having been 4/4 a week before. Four others fail tools outright.
 *
 * So the next idea was to keep the model and remove its thinking, which on the
 * real payload measured 4,415 ms -> 1,645 ms to first token AND scored 6/6 on
 * tools rather than 5/6. Both numbers said take it.
 *
 * BOTH NUMBERS WERE MEASURING ONE TURN. The thing that breaks is not calling a
 * tool, it is carrying an intention across three turns: resolve the property,
 * offer to move the visit, and then actually move it when the caller says "yes,
 * that is the one". With thinking off the agent answers that confirmation by
 * looking the property up again, or by asking which Friday — and it does it
 * differently on identical runs. `pnpm demo --only=writes` holds with thinking
 * on and fails with it off; capping the budget at 128 and at 512 tokens fails
 * the same way. A tool call is a single-turn act and survives; a commitment is
 * not, and does not.
 *
 * `AGENT_THINKING=off` is kept because the measurement should stay reproducible
 * and because the next model may not have this failure. It is not the default,
 * and it must not become the default without `pnpm demo` green.
 */
export function agentModelOptions(): Record<string, Record<string, never>> | {
  openrouter: { reasoning: Record<string, boolean | number> };
} {
  const mode = env("AGENT_THINKING") ?? "on";
  if (mode === "on") return {};
  if (mode.startsWith("cap:")) {
    return { openrouter: { reasoning: { max_tokens: Number(mode.slice(4)) } } };
  }
  return { openrouter: { reasoning: { enabled: false } } };
}

/** Bulk note extraction. Offline, high volume, cost-sensitive. */
export const extractModel = (): LanguageModel => forRole("MODEL_EXTRACT");

/** The live conversation. Latency-sensitive; every call is on the clock. */
export const agentModel = (): LanguageModel => forRole("MODEL_AGENT");

/** Test scoring. Used sparingly — see the sampling note in task 14. */
export const judgeModel = (): LanguageModel => forRole("MODEL_JUDGE");

/** Which slug a role currently resolves to, for reports and logs. */
export function slugFor(role: ModelRole): string {
  return requireEnv(role, "A3");
}

// --- budget guard ----------------------------------------------------------

export interface KeyBudget {
  limit: number | null;
  usage: number;
  remaining: number | null;
}

/**
 * Reads spend from the OpenRouter key itself. The overnight run calls this
 * before every model-using task: an unattended loop is the one failure that
 * costs real money while nobody is watching.
 */
export async function readBudget(): Promise<KeyBudget> {
  const res = await httpFetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY", "A2")}` },
  });
  if (!res.ok) throw new Error(`OpenRouter key check failed: HTTP ${res.status}`);

  const body = (await res.json()) as {
    data?: { limit: number | null; usage: number | null; limit_remaining?: number | null };
  };
  const d = body.data ?? { limit: null, usage: 0 };
  const usage = d.usage ?? 0;
  const remaining = d.limit === null || d.limit === undefined ? null : (d.limit_remaining ?? d.limit - usage);

  return { limit: d.limit ?? null, usage, remaining };
}

/**
 * Throws if remaining credit is below the floor. Called by the sequencer, not
 * by individual tasks, so the halt is recorded in one place.
 */
export async function assertBudget(): Promise<KeyBudget> {
  const b = await readBudget();
  if (b.remaining !== null && b.remaining < BUDGET_FLOOR_USD) {
    throw new Error(
      `OpenRouter credit is $${b.remaining.toFixed(2)}, below the floor of $${BUDGET_FLOOR_USD}. ` +
        `Halting rather than running the account to zero. Top up, or lower BUDGET_FLOOR_USD.`,
    );
  }
  return b;
}
