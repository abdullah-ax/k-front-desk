/**
 * The reasoning loop (.claude/plans/front-desk.plan.md, task 12).
 *
 * On a live phone call Vapi drives the loop and calls our webhook for tools.
 * This module exists so the SAME agent — same prompt, same tools, same
 * boundaries — can be exercised without a telephone: in tests, in evals, and in
 * the red-team suite. A boundary that only holds when nobody is checking is not
 * a boundary.
 *
 * Voice shapes every decision here:
 *
 *   maxSteps 3      Each step is a model round trip. Four steps is four seconds
 *                   of silence, which on a phone sounds like a dropped call.
 *                   Running out of steps is not an error — it is the handoff
 *                   trigger.
 *   parallel tools  The model may ask for several at once; running them
 *                   together collapses a three-step chain into one round trip.
 *   dossier first   The property is fetched at call open and put in context, so
 *                   most questions need zero tool calls at all.
 */
import { generateText, tool as aiTool, type CoreMessage } from "ai";
import { EMERGENCY } from "./emergency.js";
import { agentModel, agentModelOptions } from "../models/index.js";
import { SYSTEM_PROMPT, callContext, priorCallContext, MAX_STEPS } from "./prompt.js";
import { loadTools, type ToolContext } from "../tools/_registry.js";
import { instrument, type QueryRecord } from "../calls/trace.js";
import type { PropertyDossier } from "../read/property-dossier.js";
import type { PriorCall } from "../calls/continuity.js";
import type { Sql } from "../db/client.js";

/** One tool invocation, with the layer below it attached. */
export interface ToolTrace {
  name: string;
  args: unknown;
  result: string;
  durationMs: number;
  /** The statements this tool ran. See src/calls/trace.ts for what is stored. */
  queries: QueryRecord[];
  /** Made by the check that catches a write the reply claimed but never made. */
  repaired?: boolean;
}

export interface AgentTurn {
  text: string;
  toolCalls: ToolTrace[];
  /**
   * The model's own account of why, when the provider returns one.
   *
   * `.claude/prds/call-observability.prd.md` leaves it open whether reasoning
   * ever arrives through this interface: the model emits reasoning tokens, but
   * whether they reach us is an assumption until measured. Null here means the
   * provider sent none, and the screen must then say "decision trace" rather
   * than dress a reconstruction up as thinking the model did not report.
   */
  reasoning: string | null;
  steps: number;
  /** True when the safety backstop escalated because the model did not. */
  autoEscalated: boolean;
  /** True when the loop hit its cap — the agent should be handing off. */
  exhausted: boolean;
  /** The reply claimed a write, none had happened, and a second pass made it. */
  repairedWrite?: boolean;
  /** The reply claimed a write and it still did not happen. */
  claimedWithoutWriting?: boolean;
}

export interface RunOptions {
  sql: Sql;
  callId: string;
  /** Our `call` row, so a write tool can file its change against the call. */
  callRowId?: number;
  /** The property already resolved for this call, if any. */
  propertyId?: number;
  /** Prior turns. The caller owns the transcript; this function is stateless. */
  history?: CoreMessage[];
  dossier?: PropertyDossier | null;
  /** What this caller's number told us on an earlier, separate call. */
  priorCall?: PriorCall | null;
  maxSteps?: number;
}

/**
 * One turn of conversation. Returns what the agent would say plus every tool it
 * touched, so a test can assert on the reasoning and not just the sentence.
 */
export async function runTurn(utterance: string, opts: RunOptions): Promise<AgentTurn> {
  const registry = await loadTools();
  const ctx: ToolContext = {
    sql: opts.sql,
    callId: opts.callId,
    ...(opts.callRowId !== undefined ? { callRowId: opts.callRowId } : {}),
    ...(opts.propertyId !== undefined ? { propertyId: opts.propertyId } : {}),
  };

  // Each invocation gets its own instrumented connection and its own buffer, so
  // the queries a tool ran are attributed to that tool even when the model asks
  // for several at once. A single shared buffer would interleave them and the
  // trace would quietly lie about which lookup was slow.
  const traces: ToolTrace[] = [];

  const tools = Object.fromEntries(
    [...registry.values()].map((t) => [
      t.name,
      aiTool({
        description: t.description,
        parameters: t.schema,
        execute: async (args: unknown) => {
          const queries: QueryRecord[] = [];
          const started = Date.now();
          const scoped: ToolContext = {
            ...ctx,
            sql: instrument(ctx.sql, (q) => queries.push(q)),
          };
          const result = await t.handler(args, scoped);
          traces.push({
            name: t.name,
            args,
            result,
            durationMs: Date.now() - started,
            queries,
          });
          return result;
        },
      }),
    ]),
  );

  // Same reason as the dossier: a user-role message, not the system prompt, so
  // the cached prefix stays identical whether or not this caller has a history.
  const prior = priorCallContext(opts.priorCall ?? null);

  const messages: CoreMessage[] = [
    { role: "user", content: callContext(opts.dossier ?? null) },
    ...(prior ? [{ role: "user" as const, content: prior }] : []),
    ...(opts.history ?? []),
    { role: "user", content: utterance },
  ];

  const result = await generateText({
    model: agentModel(),
    // Thinking ON by default, which is not what an earlier version of this
    // comment said. Disabling it measured 4,415 ms -> 1,645 ms to first token
    // on the real payload and looked like a free 2.7x, but both numbers were
    // measuring ONE turn: what breaks without it is carrying an intention
    // across three — resolve the property, offer the move, then actually move
    // it when the caller says "yes, that one". See NOTES.md 25 and 26, and
    // agentModelOptions for the AGENT_THINKING escape hatch that keeps the
    // measurement reproducible without making it the default.
    providerOptions: agentModelOptions() as never,
    system: SYSTEM_PROMPT,
    messages,
    tools,
    maxSteps: opts.maxSteps ?? MAX_STEPS,
    // Zero, not 0.3.
    //
    // At 0.3 the safety gate was unrepeatable: three consecutive runs of the
    // same eight boundaries on unchanged code gave 6/8, 5/8 and 7/8, with
    // different cases failing each time. Even three repeats per case did not
    // settle it. A gate that answers differently each run either blocks good
    // work or passes bad work at random, and we spent a while reading that
    // noise as signal.
    //
    // There is nothing to gain from sampling here either: a caller wants the
    // door code refused the same way every time, not a fresh phrasing of it.
    temperature: 0,
  });

  // The traces collected above already carry timings and queries, which the
  // SDK's own step list does not. Reconciling by name and order keeps the
  // ordering the model produced while adding the two layers below it.
  const toolCalls: ToolTrace[] = [];
  const unclaimed = [...traces];
  for (const step of result.steps ?? []) {
    for (const call of step.toolCalls ?? []) {
      const match = (step.toolResults ?? []).find(
        (r: { toolCallId?: string }) => r.toolCallId === call.toolCallId,
      ) as { result?: unknown } | undefined;
      const idx = unclaimed.findIndex((t) => t.name === call.toolName);
      const traced = idx >= 0 ? unclaimed.splice(idx, 1)[0]! : null;
      toolCalls.push({
        name: call.toolName,
        args: call.args,
        result:
          traced?.result ??
          (typeof match?.result === "string" ? match.result : JSON.stringify(match?.result ?? null)),
        durationMs: traced?.durationMs ?? 0,
        queries: traced?.queries ?? [],
      });
    }
  }

  // Reasoning arrives on the result when the provider forwards it, and on
  // individual steps for some. Take whatever is actually there rather than
  // asserting a shape the provider has not promised.
  const stepReasoning = (result.steps ?? [])
    .map((s) => (s as unknown as { reasoning?: string }).reasoning)
    .filter((r): r is string => typeof r === "string" && r.trim() !== "");
  const topReasoning = (result as unknown as { reasoning?: string }).reasoning;
  const reasoning =
    (typeof topReasoning === "string" && topReasoning.trim() !== "" ? topReasoning : null) ??
    (stepReasoning.length ? stepReasoning.join("\n\n") : null);

  const steps = result.steps?.length ?? 1;

  // --- deterministic backstop for emergencies -------------------------------
  //
  // Measured: on "water pouring through the ceiling and I can smell gas", the
  // agent asks for the address instead of calling handoff on roughly one turn
  // in three. That is not a model-tier problem — deepseek-v4-flash scored 3/3
  // and claude-sonnet-4 scored 2/3 on the same case, same prompt. It is
  // ordinary variance, and no wording removed it.
  //
  // For anything else, variance is a quality issue. Here it decides whether
  // anyone is dispatched to a gas leak. So the decision is taken away from the
  // model: if the caller says one of these words and no handoff was made, we
  // make it. Asking for the address is fine — silently not escalating is not.
  const emergency = EMERGENCY.test(utterance);
  const handedOff = toolCalls.some((c) => c.name === "handoff");

  if (emergency && !handedOff) {
    const handoff = registry.get("handoff");
    if (handoff) {
      const result = await handoff.handler(
        {
          reason: "safety",
          summary: `AUTOMATIC ESCALATION — caller reported a possible safety emergency. Their words: "${utterance}"`,
        },
        ctx,
      );
      toolCalls.push({
        name: "handoff",
        args: { reason: "safety", auto: true },
        result,
        durationMs: 0,
        queries: [],
      });
    }
  }

  // --- said it, did not do it ------------------------------------------------
  //
  // The prompt already forbids this in as many words ("You have no notepad").
  // The model broke the rule anyway, on a live call: it told the caller "I've
  // added that note — gate code changed, use the service entrance" and never
  // called add_note. Three tools ran, one change was filed, and the note did
  // not exist. It happens roughly one time in six, which is worse than always,
  // because nobody learns to distrust it.
  //
  // So the check is mechanical, exactly like the emergency backstop above: if
  // the reply claims a write and no write tool ran this turn, the model gets
  // ONE chance to do what it said, with the discrepancy quoted back to it.
  // Anything it still has not done is left for the office to see rather than
  // papered over — the call log's whole job is to show what happened.
  const WRITE_TOOLS = new Set(["move_job", "book_job", "cancel_job", "add_note"]);
  const CLAIMED_A_WRITE =
    /\b(i(?:'ve| have)\s+(?:added|put|noted|recorded|moved|booked|cancell?ed|scheduled|updated)|(?:that'?s|it'?s)\s+(?:on|in)\s+the\s+job|added that note|i(?:'ve| have)\s+got that (?:down|on))\b/i;
  const wroteSomething = toolCalls.some((c) => WRITE_TOOLS.has(c.name));
  let repaired = false;

  if (!wroteSomething && CLAIMED_A_WRITE.test(result.text)) {
    try {
      const fix = await generateText({
        model: agentModel(),
        providerOptions: agentModelOptions() as never,
        system: SYSTEM_PROMPT,
        messages: [
          ...messages,
          { role: "assistant", content: result.text },
          {
            role: "user",
            content:
              "SYSTEM CHECK, not the caller speaking. You just told the caller you had recorded or " +
              "changed something, and you did not call the tool that does it, so nothing was written. " +
              "Call the tool now. Reply with nothing else.",
          },
        ],
        tools,
        maxSteps: 2,
        temperature: 0,
      });
      for (const step of fix.steps ?? []) {
        for (const call of step.toolCalls ?? []) {
          const match = (step.toolResults ?? []).find(
            (r: { toolCallId?: string }) => r.toolCallId === call.toolCallId,
          ) as { result?: unknown } | undefined;
          const idx = traces.findIndex((tr) => tr.name === call.toolName);
          const traced = idx >= 0 ? traces.splice(idx, 1)[0]! : null;
          toolCalls.push({
            name: call.toolName,
            args: call.args,
            result: typeof match?.result === "string" ? match.result : JSON.stringify(match?.result ?? ""),
            durationMs: traced?.durationMs ?? 0,
            queries: traced?.queries ?? [],
            repaired: true,
          });
          repaired = true;
        }
      }
    } catch {
      // A failed repair is not a failed turn. The caller already has an answer;
      // what matters is that the record shows the write never happened.
    }
  }

  return {
    text: result.text,
    toolCalls,
    reasoning,
    steps,
    autoEscalated: emergency && !handedOff,
    /** True when the reply claimed a write the model had not made, and a second
     *  pass made it. The office should be able to see this happened. */
    repairedWrite: repaired,
    /** The reply claimed a write and it still did not happen. */
    claimedWithoutWriting: !wroteSomething && CLAIMED_A_WRITE.test(result.text) && !repaired,
    exhausted: steps >= (opts.maxSteps ?? MAX_STEPS) && result.text.trim() === "",
  };
}
