/**
 * The call record (.claude/prds/call-observability.prd.md, milestones 1 and 6).
 *
 * One durable row per conversation and one ordered row per thing that happened
 * inside it. Before this, the words lived in the voice provider's dashboard,
 * the tool traffic lived in function logs, and the reasoning and the SQL lived
 * nowhere. Three surfaces, none joined, none queryable by phone number or
 * address. This is the one place.
 *
 * Three decisions worth knowing:
 *
 *   EVENTS ARE WRITTEN AS THEY HAPPEN, not assembled at the end. A record that
 *   only completes on a clean hangup is a record that is missing exactly the
 *   calls worth reading: the dropped ones, the timeouts, the crashes.
 *
 *   ORDER HANGS ON `seq`, NOT ON TIME. Tools run in parallel deliberately, so
 *   two events routinely share a millisecond. A screen that sorted by timestamp
 *   would reorder itself at random between refreshes.
 *
 *   EVERYTHING IS REDACTED BEFORE IT IS WRITTEN, not on render. Redacting at
 *   read time means the secret is in the table, and a table is exactly what an
 *   attacker or a future careless query reaches. See src/security/redact.ts.
 */
import type { Sql } from "../db/client.js";
import { redactDeep, redactText } from "../security/redact.js";

export type EventKind =
  | "turn"
  | "reasoning"
  | "decision"
  | "tool"
  | "query"
  | "proof"
  | "change"
  | "refusal"
  | "handoff"
  | "system";

export interface CallEvent {
  kind: EventKind;
  role?: "caller" | "agent" | "office" | "system";
  body?: string;
  toolName?: string;
  args?: unknown;
  result?: string;
  statement?: string;
  durationMs?: number;
  rowCount?: number;
  noteId?: number;
  jobId?: number;
  propertyId?: number;
  meta?: Record<string, unknown>;
}

export interface OpenCallInput {
  providerCallId: string;
  channel?: "phone" | "web";
  fromNumber?: string | null;
  callerLabel?: string | null;
}

/**
 * Next sequence number per call, held in process.
 *
 * The handler already pins a call to one connection for its lifetime, so the
 * events for a call are produced in one place. Seeded from the database on open
 * so a resumed or retried call continues rather than restarting at 1 and
 * colliding with the unique index.
 */
const seqs = new Map<number, number>();

/** Codes known for the property on this call, so unlabelled ones are caught. */
const knownSecrets = new Map<number, Set<string>>();

export function rememberSecrets(callId: number, secrets: Iterable<string>): void {
  const set = knownSecrets.get(callId) ?? new Set<string>();
  for (const s of secrets) set.add(s);
  knownSecrets.set(callId, set);
}

/**
 * Read-only access to the same set, for anything that redacts free text after
 * the fact — the end-of-call summary being the one caller today. Must run
 * BEFORE `endCall`, whose `finally` clears this via `forgetCall`.
 */
export function getKnownSecrets(callId: number): Set<string> {
  return knownSecrets.get(callId) ?? new Set<string>();
}

export function forgetCall(callId: number): void {
  seqs.delete(callId);
  knownSecrets.delete(callId);
}

/**
 * Finds or creates the call row. Idempotent on the provider's id, because a
 * webhook retry must land on the record it already made rather than fork it.
 */
export async function openCall(sql: Sql, input: OpenCallInput): Promise<number> {
  const [row] = await sql`
    insert into "call" (tenant_id, provider_call_id, channel, from_number, caller_label)
    values (
      current_setting('app.tenant_id', true),
      ${input.providerCallId},
      ${input.channel ?? "phone"},
      ${input.fromNumber ?? null},
      ${input.callerLabel ?? null}
    )
    on conflict (tenant_id, provider_call_id) do update
      set from_number  = coalesce("call".from_number, excluded.from_number),
          caller_label = coalesce(excluded.caller_label, "call".caller_label)
    returning id
  `;
  const id = Number((row as { id: number }).id);

  if (!seqs.has(id)) {
    const [max] = await sql`
      select coalesce(max(seq), 0)::int as n from call_event where call_id = ${id}
    `;
    seqs.set(id, Number((max as { n: number }).n));
  }
  return id;
}

/** Attaches the property the caller was resolved to, and on what evidence. */
export async function attachProperty(
  sql: Sql,
  callId: number,
  propertyId: number,
  basis: string,
): Promise<void> {
  await sql`
    update "call" set property_id = ${propertyId}, resolution_basis = ${basis}
    where id = ${callId}
  `;
}

/**
 * Writes one event. Never throws into the caller.
 *
 * A failed insert must not end a phone call. The trace is important; it is not
 * more important than the conversation it is describing, and a caller hearing
 * dead air because a log write timed out would be the worst possible trade.
 */
export async function record(sql: Sql, callId: number, event: CallEvent): Promise<void> {
  try {
    const secrets = knownSecrets.get(callId) ?? new Set<string>();
    const seq = (seqs.get(callId) ?? 0) + 1;
    seqs.set(callId, seq);

    const body = event.body ? redactText(event.body, secrets) : null;
    const result = event.result ? redactText(event.result, secrets) : null;
    const args = event.args === undefined ? null : redactDeep(event.args, secrets);
    const meta = event.meta ? redactDeep(event.meta, secrets) : {};

    await sql`
      insert into call_event (
        tenant_id, call_id, seq, kind, role, body, tool_name, args, result,
        statement, duration_ms, row_count, note_id, job_id, property_id, meta
      ) values (
        current_setting('app.tenant_id', true),
        ${callId}, ${seq}, ${event.kind}, ${event.role ?? null}, ${body},
        ${event.toolName ?? null}, ${args as never}, ${result},
        ${event.statement ?? null}, ${event.durationMs ?? null}, ${event.rowCount ?? null},
        ${event.noteId ?? null}, ${event.jobId ?? null}, ${event.propertyId ?? null},
        ${meta as never}
      )
    `;

    // Header counts, so the Calls list does not need a count(*) per row.
    if (event.kind === "turn") {
      await sql`update "call" set turn_count = turn_count + 1 where id = ${callId}`;
    } else if (event.kind === "tool") {
      await sql`update "call" set tool_count = tool_count + 1 where id = ${callId}`;
    } else if (event.kind === "change") {
      await sql`update "call" set change_count = change_count + 1 where id = ${callId}`;
    } else if (event.kind === "handoff") {
      await sql`
        update "call" set handoff_reason = coalesce(handoff_reason, ${event.body ?? "handoff"})
        where id = ${callId}
      `;
    }
  } catch (err) {
    console.error(`call ${callId}: could not record ${event.kind}:`, err);
  }
}

/** Records several events in order. Order is the point, so this is not parallel. */
export async function recordAll(sql: Sql, callId: number, events: CallEvent[]): Promise<void> {
  for (const e of events) await record(sql, callId, e);
}

/**
 * Closes calls that stopped producing events and never reported an ending.
 *
 * A dropped connection, a provider timeout or a crashed instance leaves a call
 * marked `live` forever. Left alone the board header says "4 calls live" when
 * the phone has not rung all afternoon, and a count that is visibly wrong makes
 * every other count on the screen suspect.
 *
 * TWO CUTOFFS, because there are two different things going wrong.
 *
 *   15 minutes, for a call that said something. Comfortably past the 10-minute
 *   cap on a real call, so this can never close a live conversation.
 *
 *   2 minutes, for a call that produced NO TURNS AT ALL. Something opened a
 *   call record and nobody ever spoke: a health check, a webhook probe, the
 *   phone gate posting a synthetic tool call, or a browser that opened the test
 *   line and wandered off. None of those is a conversation and none should be
 *   counted as one. This was the actual cause of the phantom count — the phone
 *   gate opens a call row on every run and never reports an ending.
 *
 * The record says `abandoned` rather than `hangup`, because those are different
 * facts and the difference is exactly what someone reading the record later
 * needs to know.
 */
export async function closeStaleCalls(
  sql: Sql,
  olderThanMinutes = 15,
  emptyAfterMinutes = 2,
): Promise<number> {
  try {
    const rows = await sql`
      update "call" set
        status = 'done',
        ended_at = coalesce(ended_at, now()),
        ended_reason = coalesce(
          ended_reason,
          case when turn_count = 0 then 'never spoke' else 'abandoned' end
        ),
        duration_ms = coalesce(duration_ms, (extract(epoch from (now() - started_at)) * 1000)::int)
      where status = 'live'
        and coalesce(
          (select max(at) from call_event e where e.call_id = "call".id),
          started_at
        ) < now() - (
          -- Multiplying an interval, rather than make_interval(mins => n).
          -- The driver binds these numbers as text, there is no
          -- make_interval(mins => text), and the whole sweep threw on every
          -- call. Multiplication takes the cast without argument-name typing.
          interval '1 minute'
          * (case when turn_count = 0 then ${emptyAfterMinutes} else ${olderThanMinutes} end)::int
        )
      returning id
    `;
    return rows.length;
  } catch (err) {
    // Say it out loud. The first version of this swallowed the error silently
    // and returned 0, so a sweep that threw on EVERY call looked exactly like a
    // sweep with nothing to do — and the board kept reporting phantom live
    // calls with no clue anywhere as to why. Closing stale calls is a tidy-up,
    // so it must never break a read; that is not a reason to hide it.
    console.error("closeStaleCalls failed:", (err as Error)?.message ?? err);
    return 0;
  }
}

export async function endCall(
  sql: Sql,
  callId: number,
  reason = "hangup",
  summary?: string,
): Promise<void> {
  try {
    await sql`
      update "call" set
        status       = 'done',
        ended_at     = now(),
        ended_reason = ${reason},
        summary      = coalesce(${summary ?? null}, summary),
        duration_ms  = (extract(epoch from (now() - started_at)) * 1000)::int
      where id = ${callId} and status <> 'done'
    `;
    await record(sql, callId, { kind: "system", role: "system", body: `Call ended: ${reason}` });
  } catch (err) {
    console.error(`call ${callId}: could not close:`, err);
  } finally {
    forgetCall(callId);
  }
}
