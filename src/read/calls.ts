/**
 * Reading the call record (.claude/prds/call-observability.prd.md, milestone 6).
 *
 * Live and finished are the same query, because they are the same record at
 * different ages. That is not a simplification for the demo: a call being
 * watched and a call being audited need identical information, and building
 * them separately is how the two drift until one of them lies.
 *
 * The events come back in `seq` order, never timestamp order. Tools run in
 * parallel deliberately, so two events routinely share a millisecond, and a
 * screen sorted by time would reorder itself between refreshes.
 */
import type { Sql } from "../db/client.js";
import { closeStaleCalls } from "../calls/record.js";

export interface CallSummary {
  id: number;
  providerCallId: string;
  channel: string;
  fromNumber: string | null;
  callerLabel: string | null;
  propertyId: number | null;
  address: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  turnCount: number;
  toolCount: number;
  changeCount: number;
  handoffReason: string | null;
}

export interface CallEventRow {
  id: number;
  seq: number;
  at: string;
  kind: string;
  role: string | null;
  body: string | null;
  toolName: string | null;
  args: unknown;
  result: string | null;
  statement: string | null;
  durationMs: number | null;
  rowCount: number | null;
  noteId: number | null;
  jobId: number | null;
  meta: Record<string, unknown>;
}

export interface CallDetail extends CallSummary {
  events: CallEventRow[];
  changes: {
    id: number;
    jobId: number;
    jobRef: string | null;
    kind: string;
    summary: string | null;
    createdAt: string;
    undoneAt: string | null;
    undoable: boolean;
  }[];
}

const SUMMARY_COLUMNS = `
  c.id, c.provider_call_id, c.channel, c.from_number, c.caller_label,
  c.property_id, p.street_raw as address, c.status, c.started_at, c.ended_at,
  c.duration_ms, c.turn_count, c.tool_count, c.handoff_reason,
  -- Counted from the rows, not from the header column. The stored counter and
  -- the trace are two sources for one fact, and they disagreed: the counter
  -- rose on every write TOOL, the trace only holds real writes. The table is
  -- the truth, so the list reads the table.
  (select count(*)::int from job_change ch
    where ch.call_id = c.id and ch.kind <> 'undo') as change_count
`;

function toSummary(r: Record<string, unknown>): CallSummary {
  return {
    id: Number(r["id"]),
    providerCallId: String(r["provider_call_id"]),
    channel: String(r["channel"]),
    fromNumber: (r["from_number"] as string) ?? null,
    callerLabel: (r["caller_label"] as string) ?? null,
    propertyId: r["property_id"] ? Number(r["property_id"]) : null,
    address: (r["address"] as string) ?? null,
    status: String(r["status"]),
    startedAt: (r["started_at"] as Date).toISOString(),
    endedAt: (r["ended_at"] as Date | null)?.toISOString() ?? null,
    durationMs: r["duration_ms"] ? Number(r["duration_ms"]) : null,
    turnCount: Number(r["turn_count"] ?? 0),
    toolCount: Number(r["tool_count"] ?? 0),
    changeCount: Number(r["change_count"] ?? 0),
    handoffReason: (r["handoff_reason"] as string) ?? null,
  };
}

/**
 * The list, newest first, with an optional search.
 *
 * Searchable by phone number, address and job number, because those are the
 * three things a person actually holds when they need this: the number that
 * called, the house they are standing outside, or the number on the paperwork.
 */
export async function listCalls(
  sql: Sql,
  opts: { search?: string; limit?: number } = {},
): Promise<CallSummary[]> {
  // A call that stopped mid-conversation and never reported an ending would
  // otherwise stay "live" on the header forever.
  await closeStaleCalls(sql);

  const limit = Math.min(opts.limit ?? 40, 200);
  const term = (opts.search ?? "").trim();

  const rows = term
    ? await sql`
        select ${sql.unsafe(SUMMARY_COLUMNS)}
        from "call" c
        left join property p on p.id = c.property_id
        where c.from_number ilike ${`%${term}%`}
           or c.caller_label ilike ${`%${term}%`}
           or p.street_raw ilike ${`%${term}%`}
           or exists (
             select 1 from job_change ch join job j on j.id = ch.job_id
             where ch.call_id = c.id and j.job_ref = ${term}
           )
        order by c.started_at desc limit ${limit}
      `
    : await sql`
        select ${sql.unsafe(SUMMARY_COLUMNS)}
        from "call" c
        left join property p on p.id = c.property_id
        order by c.started_at desc limit ${limit}
      `;

  return (rows as unknown as Record<string, unknown>[]).map(toSummary);
}

/**
 * Finds a call by the id the voice provider gave it.
 *
 * The browser holds the provider's id after starting a web call and has no idea
 * what our row id is. This is the join between the two, so the Test line can
 * show the trace of the call the person is on right now.
 */
export async function getCallByProvider(
  sql: Sql,
  providerCallId: string,
): Promise<CallDetail | null> {
  const [row] = await sql`
    select id from "call" where provider_call_id = ${providerCallId}
  `;
  if (!row) return null;
  return getCall(sql, Number((row as { id: number }).id));
}

export async function getCall(sql: Sql, id: number): Promise<CallDetail | null> {
  const [head] = await sql`
    select ${sql.unsafe(SUMMARY_COLUMNS)}
    from "call" c left join property p on p.id = c.property_id
    where c.id = ${id}
  `;
  if (!head) return null;

  const events = await sql`
    select id, seq, at, kind, role, body, tool_name, args, result, statement,
           duration_ms, row_count, note_id, job_id, meta
    from call_event where call_id = ${id} order by seq
  `;

  const changes = await sql`
    select ch.id, ch.job_id, j.job_ref, ch.kind, ch.summary, ch.created_at,
           ch.undone_at, j.started_at
    from job_change ch join job j on j.id = ch.job_id
    where ch.call_id = ${id} and ch.kind <> 'undo'
    order by ch.created_at
  `;

  return {
    ...toSummary(head as Record<string, unknown>),
    events: (events as unknown as Record<string, unknown>[]).map((e) => ({
      id: Number(e["id"]),
      seq: Number(e["seq"]),
      at: (e["at"] as Date).toISOString(),
      kind: String(e["kind"]),
      role: (e["role"] as string) ?? null,
      body: (e["body"] as string) ?? null,
      toolName: (e["tool_name"] as string) ?? null,
      args: e["args"] ?? null,
      result: (e["result"] as string) ?? null,
      statement: (e["statement"] as string) ?? null,
      durationMs: e["duration_ms"] ? Number(e["duration_ms"]) : null,
      rowCount: e["row_count"] === null || e["row_count"] === undefined ? null : Number(e["row_count"]),
      noteId: e["note_id"] ? Number(e["note_id"]) : null,
      jobId: e["job_id"] ? Number(e["job_id"]) : null,
      meta: (e["meta"] as Record<string, unknown>) ?? {},
    })),
    changes: (changes as unknown as Record<string, unknown>[]).map((c) => ({
      id: Number(c["id"]),
      jobId: Number(c["job_id"]),
      jobRef: (c["job_ref"] as string) ?? null,
      kind: String(c["kind"]),
      summary: (c["summary"] as string) ?? null,
      createdAt: (c["created_at"] as Date).toISOString(),
      undoneAt: (c["undone_at"] as Date | null)?.toISOString() ?? null,
      // Undo is offered only while it would actually work, so the button is
      // never a lie. The rule is in src/write/jobs.ts and read here.
      //
      // A note is excluded because it cannot be undone: notes are append-only,
      // and the write path refuses. src/read/job.ts already excluded it; this
      // copy of the rule did not, so the Calls screen drew a live Undo button
      // beside every note the agent took on a call.
      undoable:
        c["kind"] !== "note" &&
        !c["undone_at"] &&
        !c["started_at"] &&
        Date.now() - (c["created_at"] as Date).getTime() < 60 * 60 * 1000,
    })),
  };
}

/** Handoffs grouped by reason: where the agent keeps failing, which is what to fix next. */
export async function handoffsByReason(
  sql: Sql,
): Promise<{ reason: string; count: number; lastAt: string }[]> {
  const rows = await sql`
    select coalesce(handoff_reason, 'unspecified') as reason,
           count(*)::int as n, max(started_at) as last_at
    from "call" where handoff_reason is not null
    group by 1 order by 2 desc
  `;
  return (rows as unknown as { reason: string; n: number; last_at: Date }[]).map((r) => ({
    reason: r.reason,
    count: Number(r.n),
    lastAt: r.last_at.toISOString(),
  }));
}
