/**
 * Cross-call memory, by phone number.
 *
 * A caller who hangs up and calls back is not a new person. Before this, every
 * call started from nothing: the same caller asking "did you look into that
 * thing I called about?" got asked to explain again, because nothing survived
 * between two separate `call` rows.
 *
 * MVP scope, deliberately. The owner asked for logging and persistence — that
 * the call is durably recorded and that a second call from the same number can
 * see the first one — not a customer-profile system with history scored across
 * many calls. That can come later; this is the one piece it would be built on.
 *
 * WHY NO SECOND MODEL CALL. A summary written by an LLM at the end of every
 * call would cost real money on every single call, forever, and would put
 * caller speech through a step that is not the same redaction path everything
 * else goes through. The summary here is built mechanically from what is
 * already known at hangup — the property, the outcome, the visible changes —
 * and redacted the same way every other persisted string is.
 */
import type { Sql } from "../db/client.js";
import { redactText } from "../security/redact.js";

export interface PriorCall {
  callId: number;
  /** Who rang last time, if they said. Written by the remember_caller tool. */
  callerLabel: string | null;
  startedAt: string;
  summary: string | null;
  street: string | null;
  unit: string | null;
  handoffReason: string | null;
  /**
   * `"property"` — this number called about THIS SAME property before, so the
   * summary is very likely the same thread the caller means by "earlier".
   *
   * `"number"` — the only real history for this number is about a DIFFERENT
   * property (or the current call has no property resolved yet). Real, and
   * worth knowing who is calling, but not the same conversation — surfacing it
   * as if it were would be exactly the wrong-record risk this build spends the
   * most effort avoiding everywhere else. See prompt.ts's priorCallContext for
   * how the two get talked about differently.
   */
  matchedBy: "property" | "number";
}

function rowToPriorCall(
  row: Record<string, unknown>,
  matchedBy: PriorCall["matchedBy"],
): PriorCall {
  const r = row as {
    id: number; started_at: string; summary: string | null; handoff_reason: string | null;
    street_raw: string | null; unit: string | null; caller_label: string | null;
  };
  return {
    callId: Number(r.id),
    // "Test line" is the console's own label for a typed rehearsal, not a
    // person, and greeting somebody as Test line would be worse than not
    // greeting them at all.
    callerLabel: r.caller_label && r.caller_label !== "Test line" ? r.caller_label : null,
    startedAt: r.started_at,
    summary: r.summary,
    street: r.street_raw,
    unit: r.unit,
    handoffReason: r.handoff_reason,
    matchedBy,
  };
}

/**
 * The caller's most relevant finished call, if any — ADDRESS FIRST, THEN
 * NUMBER.
 *
 * A phone number alone is a weak key in this business: two thirds of jobs
 * belong to property managers, and one central front-desk line can legitimately
 * call about a dozen different properties over a month. "The most recent call
 * from this number" would just as often be the wrong property as the right
 * one, and confidently-wrong continuity is worse than none — the same lesson
 * this build already learned about names and company names alone.
 *
 * So when `propertyId` is known (it isn't yet at call open, only once
 * `resolve_property` has run — see session.ts's attachDossier), this tries
 * `number AND property` first. Only when nothing matches THAT does it fall
 * back to the number alone, and the caller of this function is told which
 * kind of match it got, so the prompt can be honest about the difference.
 *
 * Deliberately the most recent ONE at each scope, not a history. `status =
 * 'done'` excludes the call currently open — a call cannot be its own
 * predecessor — and a null or blank number returns nothing rather than
 * querying: the web test line sends `fromNumber: null` on every session, and
 * matching on null would silently pool every unrelated test call into one
 * caller's "history". That is not a shortcut worth taking near anything
 * privacy-shaped.
 */
export async function lastCallFrom(
  sql: Sql,
  fromNumber: string | null | undefined,
  propertyId?: number | null,
): Promise<PriorCall | null> {
  if (!fromNumber || !fromNumber.trim()) return null;

  if (propertyId) {
    const [byProperty] = await sql`
      select c.id, c.started_at, c.summary, c.handoff_reason, p.street_raw, p.unit,
             -- The newest name this number EVER gave, not the newest call's.
             -- A caller says their name once; every call after that has none,
             -- so reading the label off the latest call forgot them again the
             -- moment they rang back.
             (select c2.caller_label from "call" c2
             where c2.from_number = ${fromNumber} and c2.caller_label is not null
               and c2.caller_label <> 'Test line'
             order by c2.started_at desc limit 1) as caller_label
      from "call" c
      left join property p on p.id = c.property_id
      where c.from_number = ${fromNumber}
        and c.property_id = ${propertyId}
        and c.status = 'done'
      order by c.started_at desc
      limit 1
    `;
    if (byProperty) return rowToPriorCall(byProperty, "property");
  }

  const [byNumber] = await sql`
    select c.id, c.started_at, c.summary, c.handoff_reason, p.street_raw, p.unit,
           (select c2.caller_label from "call" c2
             where c2.from_number = ${fromNumber} and c2.caller_label is not null
               and c2.caller_label <> 'Test line'
             order by c2.started_at desc limit 1) as caller_label
    from "call" c
    left join property p on p.id = c.property_id
    where c.from_number = ${fromNumber}
      and c.status = 'done'
    order by c.started_at desc
    limit 1
  `;
  if (!byNumber) return null;
  return rowToPriorCall(byNumber, "number");
}

/**
 * Builds the one line written to `call.summary` at hangup.
 *
 * Structural, not narrative: which property, and what happened. Not an
 * attempt to compress the conversation's substance — that is what the full
 * `call_event` trace is for, and a lossy paraphrase of it would be a second,
 * worse copy sitting next to the real one.
 *
 * `outcomes` are the first lines already recorded for `change` and `handoff`
 * events during the call (see session.ts) — reused, not recomputed, so this
 * costs nothing beyond string joining at the point the call ends.
 */
export function buildSummary(
  property: { street: string; unit?: string | null } | null,
  outcomes: string[],
  knownSecrets: Iterable<string>,
): string | null {
  const parts: string[] = [];
  if (property) {
    parts.push(`About ${property.street}${property.unit ? ` unit ${property.unit}` : ""}.`);
  }
  parts.push(...outcomes);
  if (!parts.length) return null;

  const summary = parts.join(" ").slice(0, 400);
  return redactText(summary, [...knownSecrets]);
}
