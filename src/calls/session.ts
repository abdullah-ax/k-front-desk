/**
 * A conversation, recorded (.claude/prds/call-observability.prd.md).
 *
 * One turn goes in, six layers come out:
 *
 *   1 the words          what the caller said and what the agent replied
 *   2 the decision       the model's reasoning where the provider returns one,
 *                        and an explicitly labelled decision trace where it
 *                        does not
 *   3 the lookup         which tool, with what arguments, and what came back
 *   4 the query          the statements that ran, their timing and row counts
 *   5 the proof          the verbatim sentence a claim rests on, and its note
 *   6 the change         what moved in the record, and whether it can be undone
 *
 * The same function serves the phone and the browser test line, because a
 * rehearsal that exercises a different path proves nothing about the real one.
 * Only `channel` differs, and it is stored so a rehearsal is never mistaken for
 * a customer.
 */
import type { CoreMessage } from "ai";
import type { Sql } from "../db/client.js";
import { runTurn, type AgentTurn } from "../agent/loop.js";
import { getPropertyDossier, type PropertyDossier } from "../read/property-dossier.js";
import { collectSecrets } from "../security/redact.js";
import { openCall, record, endCall, attachProperty, rememberSecrets, getKnownSecrets } from "./record.js";
import { lastCallFrom, buildSummary, type PriorCall } from "./continuity.js";

export interface Session {
  callId: number;
  providerCallId: string;
  history: CoreMessage[];
  propertyId: number | null;
  dossier: PropertyDossier | null;
  /** Needed to re-scope `priorCall` by property once one resolves mid-call. */
  fromNumber: string | null;
  /** What this same phone number told us on its last, separate call. */
  priorCall: PriorCall | null;
  /**
   * First line of every `change`/`handoff` event this call has recorded so
   * far. Reused verbatim at hangup to build `call.summary` — see
   * continuity.ts — so the summary costs nothing beyond a string join.
   */
  outcomes: string[];
}

/**
 * Sessions cached in process, keyed by the provider's call id.
 *
 * A CACHE, not the truth. The truth is the call record, and it has to be,
 * because this runs on a serverless host where consecutive requests in the same
 * conversation land on different instances. Holding the conversation only in
 * memory produced exactly that failure: turn one succeeded, turn two arrived at
 * a fresh instance, found no session and returned "that test call is not open".
 * From the caller's side that is dead air, and on the phone path it would also
 * have meant the dossier and its secrets were silently forgotten mid-call.
 *
 * So a miss rebuilds from the database rather than failing. See `resume`.
 */
const sessions = new Map<string, Session>();

export function getSession(providerCallId: string): Session | undefined {
  return sessions.get(providerCallId);
}

/**
 * Rebuilds a session from the record when this instance has never seen it.
 *
 * The conversation comes back from the stored turns, the property from the call
 * row, and the dossier is re-fetched, which also re-arms the redactor with the
 * codes for that property. One extra query and one dossier fetch, paid only on
 * a cold instance.
 */
async function resume(sql: Sql, providerCallId: string): Promise<Session | null> {
  const [row] = await sql`
    select id, property_id, status, from_number from "call" where provider_call_id = ${providerCallId}
  `;
  if (!row) return null;
  const call = row as { id: number; property_id: number | null; from_number: string | null };

  const turns = await sql`
    select role, body from call_event
    where call_id = ${call.id} and kind = 'turn' and body is not null
    order by seq
  `;
  const history: CoreMessage[] = (turns as unknown as { role: string; body: string }[]).map((t) => ({
    role: t.role === "agent" ? "assistant" : "user",
    content: t.body,
  }));

  const session: Session = {
    callId: Number(call.id),
    providerCallId,
    history,
    propertyId: null,
    dossier: null,
    fromNumber: call.from_number,
    // Address first, then number — same rule as a fresh call. The property is
    // already on the row if this call ever resolved one, so a resume gets the
    // precise match immediately rather than waiting for attachDossier to
    // refine it a second time.
    priorCall: await lastCallFrom(sql, call.from_number, call.property_id),
    outcomes: [],
  };
  sessions.set(providerCallId, session);

  if (call.property_id) {
    await attachDossier(sql, session, Number(call.property_id), "resumed from the call record", false);
  }
  return session;
}

export async function startSession(
  sql: Sql,
  input: { providerCallId: string; channel?: "phone" | "web"; fromNumber?: string | null; callerLabel?: string | null },
): Promise<Session> {
  const cached = sessions.get(input.providerCallId);
  if (cached) return cached;

  const resumed = await resume(sql, input.providerCallId);
  if (resumed) return resumed;

  const callId = await openCall(sql, input);
  const priorCall = await lastCallFrom(sql, input.fromNumber);
  const session: Session = {
    callId,
    providerCallId: input.providerCallId,
    history: [],
    propertyId: null,
    dossier: null,
    fromNumber: input.fromNumber ?? null,
    priorCall,
    outcomes: [],
  };
  sessions.set(input.providerCallId, session);

  await record(sql, callId, {
    kind: "system",
    role: "system",
    body: `Call opened on the ${input.channel ?? "phone"} channel`,
    meta: { channel: input.channel ?? "phone" },
  });

  // Recorded once, at open, so the trace shows what the agent knew and when —
  // same reason a resolved property gets its own event rather than being
  // implicit in what the agent says next.
  if (priorCall) {
    await record(sql, callId, {
      kind: "system",
      role: "system",
      body: `Same number called before, on ${new Date(priorCall.startedAt).toDateString()}` +
        (priorCall.street ? ` about ${priorCall.street}` : ""),
      meta: { priorCallSummary: priorCall.summary },
    });
  }
  return session;
}

/**
 * Loads the property dossier and tells the recorder which codes to strip.
 *
 * This is the step that makes redaction complete rather than nearly complete.
 * Most of the corpus writes codes as a `[code]` token, but a handful carry a
 * real number inline with no label at all, and only the values read from the
 * facts can catch those. The dossier has just read them, so it hands them over.
 */
export async function attachDossier(
  sql: Sql,
  session: Session,
  propertyId: number,
  basis = "resolved by address",
  announce = true,
): Promise<void> {
  const dossier = await getPropertyDossier(propertyId, sql);
  if (!dossier) return;
  session.propertyId = propertyId;
  session.dossier = dossier;

  const secrets = collectSecrets(
    Object.values(dossier.facts).flat().map((f) => f.payload as Record<string, unknown>),
  );
  rememberSecrets(session.callId, secrets);

  // Address first, then number, refined now that the address is known. At
  // call open the only lookup possible was by number alone (or by whatever
  // property the row already carried, on a resume). Now that THIS call has
  // its own property, re-scope: does this number's history include THIS
  // property specifically? If so it replaces the weaker number-only match;
  // if not, the number-only match (clearly labelled as a different property —
  // see prompt.ts) stands, because it is still real and still worth knowing.
  const refined = await lastCallFrom(sql, session.fromNumber, propertyId);
  const changed = refined?.callId !== session.priorCall?.callId;
  session.priorCall = refined;

  // A resume re-attaches the same property that is already on the record, so
  // announcing it again would put a duplicate event in the trace for something
  // that did not happen twice.
  if (!announce) return;

  if (changed && refined) {
    await record(sql, session.callId, {
      kind: "system",
      role: "system",
      propertyId,
      body: refined.matchedBy === "property"
        ? `This number has called about this same property before, on ${new Date(refined.startedAt).toDateString()}`
        : `This number's prior call was about a different property`,
      meta: { priorCallId: refined.callId, matchedBy: refined.matchedBy },
    });
  }

  await attachProperty(sql, session.callId, propertyId, basis);
  await record(sql, session.callId, {
    kind: "system",
    role: "system",
    propertyId,
    body: `Caller resolved to ${dossier.property.street}${dossier.property.unit ? ` unit ${dossier.property.unit}` : ""} (${basis})`,
    meta: { visits: dossier.property.visitCount, basis },
  });
}

/** Words distinctive enough to say a sentence supports a claim. */
function keyTokens(text: string): Set<string> {
  const stop = new Set([
    "the", "and", "for", "was", "were", "with", "that", "this", "have", "has",
    "not", "you", "your", "our", "they", "them", "from", "will", "would", "there",
    "been", "into", "about", "call", "caller", "said", "says", "need", "needs",
  ]);
  return new Set(
    (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !stop.has(w)),
  );
}

/**
 * Finds which source sentences actually support what the agent just said.
 *
 * Deliberately conservative. A proof shown for a claim it does not support is
 * worse than no proof, because the whole point of the layer is that a person
 * can check the agent rather than trust it. Two distinctive shared words is the
 * threshold; a paraphrase with no overlap gets no proof and the screen shows
 * none, which is the honest outcome.
 */
function findProofs(
  answer: string,
  dossier: PropertyDossier | null,
): { snippet: string; noteId: number | null; kind: string }[] {
  if (!dossier || !answer.trim()) return [];
  const said = keyTokens(answer);
  const out: { snippet: string; noteId: number | null; kind: string; score: number }[] = [];

  for (const [kind, facts] of Object.entries(dossier.facts)) {
    for (const f of facts) {
      const snippet = String(f.snippet ?? "").trim();
      if (snippet.length < 12) continue;
      let score = 0;
      for (const w of keyTokens(snippet)) if (said.has(w)) score += 1;
      if (score >= 2) out.push({ snippet, noteId: f.noteId ?? null, kind, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

/** What the write tools say when nothing was written. */
const NOT_A_WRITE = /^(?:ALREADY THERE|ALREADY CANCELED|CANNOT (?:MOVE|CANCEL|BOOK)|NO SUCH (?:JOB|PROPERTY))\b/;

const REFUSAL =
  /\b(cannot|can't|not able to|i'm not going to|i am not going to|won't be able)\b/i;

export interface TurnResult extends AgentTurn {
  callId: number;
  proofs: { snippet: string; noteId: number | null; kind: string }[];
}

/**
 * Runs one turn and writes the whole trace.
 *
 * Recording happens after the model answers rather than during, because a log
 * write must never be able to add latency to a voice turn. The PRD budgets
 * under 50ms for the whole trace and the events are small inserts on a
 * connection that is already open and already scoped.
 */
export async function say(sql: Sql, session: Session, utterance: string): Promise<TurnResult> {
  await record(sql, session.callId, { kind: "turn", role: "caller", body: utterance });

  const turn = await runTurn(utterance, {
    sql,
    callId: session.providerCallId,
    callRowId: session.callId,
    history: session.history,
    dossier: session.dossier,
    priorCall: session.priorCall,
    ...(session.propertyId !== null ? { propertyId: session.propertyId } : {}),
  });

  // Layer 2. Whichever of the two this is, it is labelled as what it is.
  if (turn.reasoning) {
    await record(sql, session.callId, { kind: "reasoning", role: "agent", body: turn.reasoning });
  } else if (turn.toolCalls.length) {
    await record(sql, session.callId, {
      kind: "decision",
      role: "agent",
      body:
        `Looked up ${turn.toolCalls.map((c) => c.name).join(", ")} before answering, ` +
        `across ${turn.steps} step${turn.steps === 1 ? "" : "s"}.`,
      meta: { reconstructed: true },
    });
  }

  // Layers 3 and 4, interleaved so a query sits under the tool that ran it.
  for (const call of turn.toolCalls) {
    await record(sql, session.callId, {
      kind: "tool",
      role: "agent",
      toolName: call.name,
      args: call.args,
      result: call.result,
      durationMs: call.durationMs,
    });
    for (const q of call.queries) {
      await record(sql, session.callId, {
        kind: "query",
        role: "system",
        toolName: call.name,
        statement: q.statement,
        durationMs: q.durationMs,
        rowCount: q.rowCount,
      });
    }
  }

  // A resolved property is the answer to the owner's hardest question: did it
  // ever give one customer's information to another. Attach it the moment the
  // resolver says so, not at the end.
  const resolved = turn.toolCalls.find(
    (c) => c.name === "resolve_property" && /RESOLVED property_id=(\d+)/.test(c.result),
  );
  if (resolved && !session.propertyId) {
    const id = Number(/RESOLVED property_id=(\d+)/.exec(resolved.result)?.[1]);
    if (id) await attachDossier(sql, session, id, "address given by the caller");
  }

  // Layer 5.
  const proofs = findProofs(turn.text, session.dossier);
  for (const p of proofs) {
    await record(sql, session.callId, {
      kind: "proof",
      role: "system",
      body: p.snippet,
      ...(p.noteId !== null ? { noteId: p.noteId } : {}),
      meta: { factType: p.kind },
    });
  }

  // Layer 6, plus the two events that decide whether this call gets read again.
  const handoff = turn.toolCalls.find((c) => c.name === "handoff");
  if (handoff) {
    const reason = String((handoff.args as { reason?: string })?.reason ?? "unspecified");
    await record(sql, session.callId, {
      kind: "handoff",
      role: "agent",
      body: reason,
      meta: { automatic: turn.autoEscalated },
    });
    // Kept for the end-of-call summary (continuity.ts) — see the field's doc.
    session.outcomes.push(`Handed off: ${reason}.`);
  }
  if (REFUSAL.test(turn.text)) {
    await record(sql, session.callId, { kind: "refusal", role: "agent", body: turn.text });
  }
  for (const c of turn.toolCalls) {
    if (["move_job", "book_job", "cancel_job", "add_note"].includes(c.name)) {
      const summary = c.result.split("\n")[0] ?? c.result;
      // A write TOOL was called; a write did not necessarily happen. The tools
      // answer a no-op or a refusal with an uppercase sentinel — ALREADY THERE
      // when a job is already at that time, CANNOT MOVE when the technician has
      // started, NO SUCH JOB when the number is wrong — and none of those wrote
      // a row. Recording a change event for them made the Calls list say "2
      // changes" over a trace holding one, because the header count is driven
      // by these events. The list and the trace now agree because only a real
      // write is a change.
      if (NOT_A_WRITE.test(summary)) {
        session.outcomes.push(summary);
        continue;
      }
      await record(sql, session.callId, {
        kind: "change",
        role: "agent",
        toolName: c.name,
        body: summary,
      });
      session.outcomes.push(summary);
    }
  }

  // An empty reply is dead air on a phone, which is the worst outcome available
  // and the one a caller reads as a dropped call. It has happened on this build
  // before, when a reasoning model spent its whole budget on thinking and
  // emitted no visible character, and it was invisible in every log surface.
  // Now it is a recorded event with something to say after it.
  let spoken = turn.text;
  if (!spoken.trim()) {
    spoken =
      "Sorry, I lost my train of thought there. Let me get someone who can help you properly.";
    await record(sql, session.callId, {
      kind: "system",
      role: "system",
      body: "The model returned no text. Fell back to a handoff rather than leaving silence.",
      meta: { steps: turn.steps, exhausted: turn.exhausted, tools: turn.toolCalls.map((c) => c.name) },
    });
    await record(sql, session.callId, { kind: "handoff", role: "agent", body: "empty reply" });
  }

  await record(sql, session.callId, { kind: "turn", role: "agent", body: spoken });

  session.history.push({ role: "user", content: utterance });
  session.history.push({ role: "assistant", content: spoken });

  return { ...turn, text: spoken, callId: session.callId, proofs };
}

export async function finishSession(
  sql: Sql,
  providerCallId: string,
  reason = "hangup",
): Promise<void> {
  const session = sessions.get(providerCallId);
  if (!session) return;
  sessions.delete(providerCallId);

  // Read the secrets set BEFORE endCall, whose `finally` clears it — a summary
  // built one line later, after `forgetCall`, would redact against nothing.
  const secrets = getKnownSecrets(session.callId);
  const summary = buildSummary(
    session.dossier ? { street: session.dossier.property.street, unit: session.dossier.property.unit } : null,
    session.outcomes,
    secrets,
  );

  await endCall(sql, session.callId, reason, summary ?? undefined);
}
