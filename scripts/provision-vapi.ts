/**
 * Creates the Vapi assistant and attaches it to the phone number
 * (.claude/plans/front-desk.plan.md, task 13).
 *
 * The assistant is defined here, in version control, rather than clicked
 * together in a dashboard — so the prompt, the tool list and the recording
 * announcement are reviewable and reproducible. Re-running updates in place.
 *
 * Note what is NOT sent to Vapi: any database credential, any customer data,
 * any tool implementation. Vapi gets tool NAMES and SCHEMAS and a URL to call.
 * The tools stay on our server, which is what keeps swapping voice providers a
 * one-file change and keeps door codes off a third party's infrastructure.
 */
import { requireEnv } from "../src/config.js";
import { slugFor } from "../src/models/index.js";
import { SYSTEM_PROMPT, FIRST_MESSAGE } from "../src/agent/prompt.js";
import { loadTools, HOT_PATH } from "../src/tools/_registry.js";
import { zodToJsonSchema } from "./zod-to-json.js";

const VAPI = "https://api.vapi.ai";

interface Row {
  name: string;
  status: "pass" | "fail";
  detail: string;
}
const rows: Row[] = [];

async function vapi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${VAPI}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv("VAPI_API_KEY", "A5")}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Vapi ${init.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 400)}`);
  return (body ? JSON.parse(body) : {}) as T;
}

async function main(): Promise<number> {
  const publicUrl = requireEnv("PUBLIC_URL", "A6").replace(/\/$/, "");
  const secret = requireEnv("VAPI_WEBHOOK_SECRET", "A6");
  const numberId = requireEnv("VAPI_PHONE_NUMBER_ID", "A5");

  const registry = await loadTools();
  const hot = [...registry.values()].filter((t) =>
    (HOT_PATH as readonly string[]).includes(t.name),
  );
  const rest = [...registry.values()].filter(
    (t) => !(HOT_PATH as readonly string[]).includes(t.name),
  );

  // Everything is loaded for now: 7 tools is well under the ~25 at which prompt
  // size and tool-selection accuracy start to suffer. HOT_PATH exists so that
  // when the list grows, the split is already expressed.
  const exposed = [...hot, ...rest];

  /**
   * What the caller hears WHILE a tool runs.
   *
   * The prompt requires calling the handoff tool before promising a person,
   * because "someone will call you" is false until something is actually
   * queued. The cost of that ordering is silence: on a real call the line went
   * quiet, the caller said "hello?", and only then did the agent speak. Dead
   * air reads as a dropped call.
   *
   * Vapi speaks these the moment the tool is invoked, so the ordering stays
   * truthful and the line stays alive. Mechanical, so it holds whatever the
   * model does.
   *
   * Only the slow or consequential tools get one. The read tools return in
   * about 140ms, and a filler for something that fast is just chatter.
   */
  const SPEAK_WHILE: Record<string, string> = {
    handoff: "Let me get someone for you right now, one moment.",
    move_job: "Let me move that for you now.",
    book_job: "Let me get that booked for you.",
    cancel_job: "Let me take that off the schedule for you.",
    add_note: "Let me put that on the job.",
  };

  const toolDefs = exposed.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.schema),
    },
    server: {
      url: `${publicUrl}/vapi/tools`,
      // How Vapi authenticates itself to us. Without this the endpoint is open
      // to anyone who finds the URL, and it can read door codes.
      headers: { "x-vapi-secret": secret },
    },
    async: false,
    ...(SPEAK_WHILE[t.name]
      ? {
          messages: [
            { type: "request-start", content: SPEAK_WHILE[t.name] },
            {
              type: "request-response-delayed",
              content: "Still with you, this is taking a moment.",
              timingMilliseconds: 3000,
            },
          ],
        }
      : {}),
  }));

  /**
 * Street tokens worth boosting in the transcriber, taken from the property
 * table itself (the 40 most frequent, generic road types excluded).
 */
const KEYTERMS = ["Hollow","Ridge","Mangrove","Landing","Pointe","Shores","Cay","Harbor",
 "Reef","Glen","Isle","Cowrie","Cove","Bluff","Bayfront","Cormorant","Amberjack","Banyan",
 "Firebush","Sandcastle","Grouper","Marlin","Glasswort","Wahoo","Rudder","Skimmer","Ixora",
 "Bowline","Buttonwood","Frangipani","Windward","Moonraker","Saltbush","Seagrape","Coquina",
 "Tern","Pelican","Osprey","Whitecap","Starfish"];

const assistant = {
    name: "Gulf Breeze Air — front desk",
    firstMessage: FIRST_MESSAGE,
    model: {
      // The SAME model and temperature every gate is measured against.
      //
      // This was `openai/gpt-4o-mini` at temperature 0.3 for most of the build,
      // which meant the phone ran a different brain from the 24 boundary runs
      // and 19 red-team cases that describe it. Nothing errored; the deployed
      // agent was just quietly a bit worse, and the model adapter's own header
      // claimed MODEL_AGENT governed the phone when it never had.
      //
      // Temperature 0 matters as much as the model. At 0.3 the safety gate was
      // unrepeatable — 6/8, 5/8 and 7/8 on unchanged code — and a caller should
      // hear the door code refused the same way every time, not a fresh
      // phrasing of it. See the comment in src/agent/loop.ts.
      //
      // Back to OpenRouter directly. The custom-llm proxy in
      // src/server/llm-proxy.ts existed for exactly one reason — Vapi silently
      // drops `reasoning: {enabled: false}`, and that flag was worth 2.7 s —
      // and the flag turned out to cost the three-turn write path, so it is off
      // and the proxy is out of the call path with it. One less hop and no cold
      // start. The proxy stays in the tree, gated by `pnpm test:phone` whenever
      // an assistant points at it, because switchable stacks (milestone 2) need
      // exactly that shape.
      provider: "openrouter",
      model: slugFor("MODEL_AGENT"),
      temperature: 0,
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      tools: toolDefs,
    },
    /**
     * Vapi Voices V2, and a fallback.
     *
     * `version` is opt-in per assistant and defaults to V1, so this config had
     * been running the older model by omission rather than by choice. Vapi
     * describes V2 as more realistic and consistent WHILE COSTING LESS, which
     * makes leaving it unset the one strictly-worse option.
     *
     * Not a premium voice, deliberately. Vapi's own blind phone-quality
     * benchmark puts every model fast enough for a phone call between 66 and
     * 76 on a 0-100 humanness scale, inside its own uncertainty band — the
     * models that actually score in the 90s cost 428-758 ms to first byte, and
     * at 758 ms a "better" voice would add more delay than the entire model
     * upgrade removed. The spread across the whole real-time tier is worth
     * about $23 over 500 calls. There is nothing to buy here.
     *
     * No fallbackPlan here, and not by oversight: the API rejects one on a Vapi
     * voice — "managed auto-fallback is always on. Remove voice.fallbackPlan."
     * The advice to add one is correct for every other provider and wrong for
     * this one, which is the sort of thing only the live endpoint will tell you.
     */
    voice: { provider: "vapi", voiceId: "Elliot", version: 2 },

    /**
     * ASR AND ENDPOINTING, which on this stack are now one decision.
     *
     * `numerals` is the setting that matters most and the one that was most
     * misunderstood: it does not produce a house number, it produces the
     * digits. Measured on this system's own recordings — "7 4 0 1 Shoreline
     * Drive", "24 11 Sigma Drive", "Unit 1 0 1". Every one of those resolved to
     * not_found until src/domain/address.ts learned to put them back together.
     * It is kept on because the alternative is words, which is worse.
     *
     * KEYTERMS is the 40 most common street tokens from this company's own
     * property table. Forty, not four hundred: both Deepgram and AssemblyAI
     * document that boosting degrades every term you did NOT boost, and
     * Deepgram's own guidance says "focus on the most important 20-50 terms".
     * Overcorrection is the failure that matters here — a boosted "Cormorant"
     * forced onto audio that said "Cormier" is a wrong-customer error.
     *
     * FLUX, not nova-3 + a separate endpointing model. Vapi's own rule is
     * explicit: Deepgram Flux when Deepgram is the transcriber, LiveKit when it
     * is not. This assistant was on the option documented for people who are
     * not using Deepgram. Flux folds end-of-turn detection into the ASR itself
     * rather than waiting for a final transcript and then asking a second model
     * whether the turn ended, which is where the old arrangement spent its
     * time. `eotThreshold` is Flux-only and lives on this same schema, next to
     * `keyterm` and `numerals` — so the forty street names and the digits
     * survive the switch, which is the thing that could have blocked it.
     */
    transcriber: {
      provider: "deepgram",
      model: "flux-general-en",
      language: "en",
      numerals: true,
      keyterm: KEYTERMS,
      // Confidence required to call the turn over, and the hard stop if that
      // confidence never arrives. 0.7 is Deepgram's default; the timeout keeps
      // a caller who trails off from hanging the line.
      eotThreshold: 0.7,
      eotTimeoutMs: 3000,
    },

    /**
     * Turn-taking.
     *
     * The architecture here is sound and was arrived at from this system's own
     * audio: the median pause WITHIN one person's turn is 0.51 s and the median
     * gap BETWEEN speakers is 0.38 s. The within-turn pause is LONGER, so no
     * constant is right in both directions at once — short enough to answer
     * promptly means cutting people off mid-address, long enough to let them
     * finish means dead air. That is why the decision belongs to a model.
     *
     * A CORRECTION TO WHAT THIS COMMENT USED TO CLAIM. It cited "2.7 s -> 1.5 s
     * and interruptions 16.6% -> 6.9%". The 16.6% is real; its actual partner
     * is 13.00%, not 6.9%, and it is a false-positive rate at a fixed 99.3%
     * true-positive rate on an offline benchmark — not a production
     * interruption rate. The "2.7 s -> 1.5 s" has no source at all; the post it
     * came from says the gain arrived WITH NO INCREASE IN LATENCY. The honest
     * version is "cut false-positive interruptions by 39% without adding
     * latency", and the architectural conclusion above is unaffected either way.
     *
     * NO smartEndpointingPlan, deliberately. Flux does end-of-turn itself and
     * Vapi's docs say not to set one alongside it. The `transcriptionEndpointing
     * Plan` that used to sit here is gone for a blunter reason: the live schema
     * says it "is only used if `smartEndpointingPlan` is not set", and one was
     * set — so its `onNumberSeconds: 0.6`, tuned for exactly the callers reading
     * out house numbers, had never once executed.
     */
    startSpeakingPlan: {
      // A floor, not a delay: the schema calls it a stopgap for when the
      // pipeline is moving too fast. Flux is faster than what it replaced, so
      // this is the setting to measure next.
      waitSeconds: 0.4,
    },

    /**
     * Barge-in. "Mm-hm" and "yeah" are backchannels, not interruptions, and
     * stopping on them is what made the agent feel skittish. Two words minimum
     * before it yields.
     *
     * `voiceSeconds` is not set here any more. It was, at 0.2, doing nothing:
     * the schema says it "is only used if `numWords` is set to 0", and numWords
     * is 2. Naming the phrases explicitly is what actually does this job, and
     * they apply at any numWords.
     */
    stopSpeakingPlan: {
      numWords: 2,
      backoffSeconds: 1.0,
      acknowledgementPhrases: ["mm-hm", "mhm", "uh-huh", "okay", "ok", "yeah", "yep", "right", "sure", "got it"],
      interruptionPhrases: ["stop", "wait", "hold on", "actually", "no", "hang on"],
    },
    server: { url: `${publicUrl}/vapi/tools`, headers: { "x-vapi-secret": secret } },
    // The office needs the transcript — the owner's complaint is that nobody
    // knows what the previous bot promised anyone.
    artifactPlan: { recordingEnabled: true, transcriptPlan: { enabled: true } },
    // Which events Vapi pushes to our webhook. `transcript` is what makes the
    // Calls screen live rather than a post-mortem: without it the words only
    // arrive in the end-of-call report, and "I have no idea what it promised
    // anyone" stays true right up until the caller has already hung up.
    serverMessages: [
      "tool-calls",
      "transcript",
      "status-update",
      "end-of-call-report",
      "hang",
    ],
    endCallPhrases: ["goodbye", "bye now", "thanks, bye"],
    silenceTimeoutSeconds: 20,
    maxDurationSeconds: 600,
  };

  // Reuse the existing assistant if we have made one, so re-running updates
  // rather than littering the account.
  const existing = await vapi<{ id: string; name: string }[]>("/assistant");
  const mine = existing.find((a) => a.name === assistant.name);

  const saved = mine
    ? await vapi<{ id: string }>(`/assistant/${mine.id}`, {
        method: "PATCH",
        body: JSON.stringify(assistant),
      })
    : await vapi<{ id: string }>("/assistant", {
        method: "POST",
        body: JSON.stringify(assistant),
      });

  rows.push({
    name: mine ? "assistant updated" : "assistant created",
    status: "pass",
    detail: `${saved.id} · ${exposed.length} tool(s): ${exposed.map((t) => t.name).join(", ")}`,
  });

  await vapi(`/phone-number/${numberId}`, {
    method: "PATCH",
    body: JSON.stringify({ assistantId: saved.id }),
  });

  const number = await vapi<{ number?: string }>(`/phone-number/${numberId}`);
  rows.push({
    name: "number attached",
    status: "pass",
    detail: `${number.number ?? numberId} now answers with this assistant`,
  });

  rows.push({
    name: "webhook",
    status: "pass",
    detail: `${publicUrl}/vapi/tools (secret required)`,
  });

  const width = Math.max(...rows.map((r) => r.name.length)) + 2;
  console.log("\n  Front Desk — provision Vapi\n");
  for (const r of rows) {
    console.log(`   [${r.status === "pass" ? "  ok  " : " FAIL "}] ${r.name.padEnd(width)} ${r.detail}`);
  }
  console.log(`\n  Dial ${number.number ?? "your number"} to test.\n`);
  return 0;
}

try {
  process.exit(await main());
} catch (err) {
  console.error(`\n  [ FAIL ] ${(err as Error).message}\n`);
  process.exit(1);
}
