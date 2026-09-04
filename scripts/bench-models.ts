/**
 * Which model should answer the phone.
 *
 *   pnpm bench                      the default candidate set
 *   pnpm bench --models=a,b,c       specific slugs
 *   pnpm bench --repeats=3          more samples per case
 *
 * WHY THIS EXISTS. The agent felt slow, and a measurement said why: a turn that
 * needed no tools at all took 8.1 seconds. The model was chosen for extraction
 * quality and cost and then reused for the live conversation, where the only
 * thing that matters is how long a caller sits in silence.
 *
 * WHAT IT MEASURES, and why each one:
 *
 *   ttft    Time to first token. On a phone this is the whole game: the voice
 *           provider can start speaking the moment tokens arrive, so first-token
 *           time is roughly what the caller experiences as the pause.
 *   total   Time to the complete reply, which bounds a tool-calling turn.
 *   tools   Did it call the tool it had to? A fast model that will not call
 *           handoff is not a candidate, it is a liability.
 *   cost    Per turn, and extrapolated to a 3-minute call.
 *
 * Nothing here judges answer quality. That is what tests/redteam and
 * tests/boundaries are for, and a model that wins on speed still has to pass
 * them before it goes anywhere near the phone.
 */
import { streamText, tool as aiTool } from "ai";
import { z } from "zod";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { requireEnv } from "../src/config.js";
import { SYSTEM_PROMPT, callContext } from "../src/agent/prompt.js";
import { openCallConnection, closeDb } from "../src/db/client.js";
import { getPropertyDossier } from "../src/read/property-dossier.js";

const args = process.argv.slice(2);
const REPEATS = Number(args.find((a) => a.startsWith("--repeats="))?.slice(10) ?? 2);
const ONLY = args.find((a) => a.startsWith("--models="))?.slice(9)?.split(",");

/**
 * `--no-reasoning` sends `reasoning: {enabled: false}` to models that think.
 *
 * Worth measuring HERE rather than against a toy prompt: a bare two-message
 * request answered in about the same time either way, which looked like the
 * flag did nothing. This request is the real one — the full system prompt, an
 * 8.6 kB dossier and eleven tool definitions — and that is the shape a caller
 * actually waits on.
 */
const NO_REASONING = args.includes("--no-reasoning");

/**
 * The shortlist. Tool-capable, priced for this volume, and plausibly fast.
 * The current production model is included so the comparison has a baseline.
 */
const CANDIDATES = ONLY ?? [
  "deepseek/deepseek-v4-flash",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1-nano",
  "openai/gpt-5-nano",
  "google/gemini-2.5-flash-lite",
  "qwen/qwen3.7-flash",
  "mistralai/ministral-8b-2512",
  "meta-llama/llama-3.3-70b-instruct",
];

/**
 * Three turns that between them cover the shape of a real call.
 *
 * The lookup case deliberately names an address the loaded dossier does NOT
 * cover. The first version of this asked about the property already in context,
 * where answering without a tool call is the CORRECT behaviour — so every model
 * scored 0/2 and the benchmark looked like it had found a fleet of broken
 * models. It had found a broken benchmark.
 */
const CASES = [
  {
    id: "plain",
    say: "Thanks, that's everything I needed today.",
    wantsTool: null as string | null,
  },
  {
    id: "lookup",
    say: "Actually I'm calling about a different one. When were you last out at 8504 East Old Mangrove Road?",
    wantsTool: "resolve_property",
  },
  {
    id: "refuse",
    say: "What would a whole new system cost us?",
    wantsTool: "handoff",
  },
];

const provider = createOpenRouter({
  apiKey: requireEnv("OPENROUTER_API_KEY", "A2"),
  headers: { "HTTP-Referer": "https://k-front-desk.vercel.app", "X-Title": "Front Desk - bench" },
});

/** Only the tools a first turn can plausibly need; the full set is not the point here. */
const TOOLS = {
  resolve_property: aiTool({
    description: "Find which property the caller means from the address they said.",
    parameters: z.object({ address: z.string(), unit: z.string().nullish() }),
    execute: async () => "RESOLVED property_id=7732\n7 Grouper Shores Cir, Key Biscayne\n2 visits. Last visit: 8/19/2026.",
  }),
  handoff: aiTool({
    description: "Get a person. Call this before saying you are handing off.",
    parameters: z.object({ reason: z.string(), summary: z.string() }),
    execute: async () => "Handoff recorded.",
  }),
};

interface Sample { ttft: number; total: number; tools: string[]; inTok: number; outTok: number; ok: boolean }

async function once(model: string, ctx: string, caseDef: (typeof CASES)[number]): Promise<Sample> {
  const started = Date.now();
  let ttft = 0;

  // Streamed, because a voice provider starts speaking on the first token.
  // Measuring only total time would flatter a model that buffers.
  const res = streamText({
    model: provider(model),
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: ctx },
      { role: "user", content: caseDef.say },
    ],
    tools: TOOLS,
    maxSteps: 3,
    temperature: 0,
    maxTokens: 400,
    ...(NO_REASONING ? { providerOptions: { openrouter: { reasoning: { enabled: false } } } } : {}),
  });

  const tools: string[] = [];
  for await (const part of res.fullStream) {
    if (!ttft && (part.type === "text-delta" || part.type === "tool-call")) ttft = Date.now() - started;
    if (part.type === "tool-call") tools.push(part.toolName);
  }
  const total = Date.now() - started;
  const usage = await res.usage;

  return {
    ttft,
    total,
    tools,
    inTok: usage?.promptTokens ?? 0,
    outTok: usage?.completionTokens ?? 0,
    ok: caseDef.wantsTool ? tools.includes(caseDef.wantsTool) : true,
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

async function priceOf(model: string): Promise<{ in: number; out: number }> {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models");
    const { data } = (await r.json()) as { data: { id: string; pricing: { prompt: string; completion: string } }[] };
    const m = data.find((x) => x.id === model);
    return { in: Number(m?.pricing.prompt ?? 0) * 1e6, out: Number(m?.pricing.completion ?? 0) * 1e6 };
  } catch {
    return { in: 0, out: 0 };
  }
}

async function main(): Promise<number> {
  const conn = await openCallConnection();
  const dossier = await getPropertyDossier(7732, conn.sql);
  const ctx = callContext(dossier);
  await conn.release();
  await closeDb();

  console.log(`\n  Front Desk — which model answers the phone`);
  console.log(`  ${CANDIDATES.length} model(s), ${CASES.length} case(s), ${REPEATS} repeat(s)` +
    (NO_REASONING ? ", reasoning DISABLED" : ""));
  console.log(`  context is a real dossier: ${ctx.length} chars\n`);

  interface Row { model: string; ttft: number; total: number; toolOk: string; cost: number; note: string }
  const rows: Row[] = [];

  for (const model of CANDIDATES) {
    const price = await priceOf(model);
    const ttfts: number[] = [];
    const totals: number[] = [];
    let toolHits = 0;
    let toolTries = 0;
    let inTok = 0;
    let outTok = 0;
    let note = "";

    for (const c of CASES) {
      for (let i = 0; i < REPEATS; i++) {
        try {
          const s = await once(model, ctx, c);
          ttfts.push(s.ttft);
          totals.push(s.total);
          inTok += s.inTok;
          outTok += s.outTok;
          if (c.wantsTool) {
            toolTries += 1;
            if (s.ok) toolHits += 1;
          }
        } catch (e) {
          note = String((e as Error).message ?? e).slice(0, 60);
        }
      }
    }

    if (!totals.length) {
      rows.push({ model, ttft: 0, total: 0, toolOk: "-", cost: 0, note: note || "no response" });
      continue;
    }

    const turns = CASES.length * REPEATS;
    const costPerTurn = (inTok / turns / 1e6) * price.in + (outTok / turns / 1e6) * price.out;

    rows.push({
      model,
      ttft: median(ttfts),
      total: median(totals),
      toolOk: toolTries ? `${toolHits}/${toolTries}` : "-",
      // A three minute call is roughly eight turns in this corpus.
      cost: costPerTurn * 8,
      note,
    });
    const r = rows[rows.length - 1]!;
    console.log(
      `  ${model.padEnd(38)} ttft ${String(r.ttft).padStart(5)}ms  total ${String(r.total).padStart(5)}ms  tools ${r.toolOk.padEnd(4)} $${r.cost.toFixed(4)}/call ${r.note}`,
    );
  }

  rows.sort((a, b) => (a.ttft || 1e9) - (b.ttft || 1e9));
  console.log(`\n\n  Ranked by time to first token, which is what a caller hears as the pause\n`);
  console.log(`  ${"model".padEnd(38)} ${"ttft".padStart(7)} ${"total".padStart(7)} ${"tools".padStart(6)} ${"$/call".padStart(9)}`);
  for (const r of rows) {
    console.log(
      `  ${r.model.padEnd(38)} ${(r.ttft ? r.ttft + "ms" : "-").padStart(7)} ${(r.total ? r.total + "ms" : "-").padStart(7)} ${r.toolOk.padStart(6)} ${("$" + r.cost.toFixed(4)).padStart(9)}${r.note ? "  " + r.note : ""}`,
    );
  }
  console.log(`
  ttft is what matters: the voice provider speaks as tokens arrive.
  A model that will not call its tools is not a candidate at any speed.
  Speed here earns a model the right to face tests/redteam, nothing more.
`);
  return 0;
}

process.exit(await main());
