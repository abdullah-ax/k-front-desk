/**
 * The write path (.claude/prds/front-desk-platform.prd.md, milestone 1).
 *
 * Every mutation to a job goes through here, whether a person clicked a button
 * or the agent decided on a call. One path means one thing to test and one
 * thing to audit, and the only difference between the two callers is the
 * `actor` column.
 *
 * THE RULE THAT MAKES AN AGENT SAFE TO LEAVE SWITCHED ON:
 *
 *   The agent does not write straight into the record. It writes a change with
 *   the call attached. The board shows it immediately, marked as the agent's,
 *   and the office can undo it in one click for as long as the job has not
 *   started.
 *
 * That is not a compromise on ambition. It is the reason a small office keeps
 * the thing on after week one, and the correction rate it produces is the
 * number that says when the agent can be trusted with more.
 *
 * `before` and `after` are whole-field snapshots rather than diffs, because an
 * undo has to restore a state and a diff only describes a transition.
 */
import type { Sql } from "../db/client.js";
import { TZ } from "../config.js";

export type Actor = "agent" | "office";
export type ChangeKind = "book" | "move" | "cancel" | "assign" | "note" | "late" | "undo";

export interface WriteContext {
  sql: Sql;
  actor: Actor;
  /** The row in `call` that caused this. Null for a plain office action. */
  callId?: number | null;
  /**
   * The board ticket that caused this, when no call did. An agent change
   * carries a call or a ticket; see writeChange for why either satisfies the
   * traceability rule and neither may be absent.
   */
  ticketId?: number | null;
  actorLabel?: string | null;
}

export interface ChangeResult {
  changeId: number;
  jobId: number;
  jobRef: string | null;
  kind: ChangeKind;
  summary: string;
  undoable: boolean;
}

/** Fields an undo has to be able to restore. Everything a change can touch. */
const SNAPSHOT_FIELDS = [
  "scheduled_start",
  "scheduled_end",
  "window_end",
  "work_status",
  "is_canceled",
  "canceled_at",
  "description",
] as const;

interface JobSnapshot {
  id: number;
  job_ref: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  [k: string]: unknown;
}

/**
 * Refuses a write against a job that is no longer schedulable.
 *
 * This existed only as good manners in the agent's prompt, and the write path
 * took the change anyway. That is the wrong place for the rule. A dispatcher
 * dragging a block, a script, and the agent all reach these functions, and only
 * one of the three was ever asked to be careful — so a job with a technician
 * standing in front of it could be rescheduled by anyone else.
 *
 * The move is worse than it sounds, because `isUndoable` returns false the
 * moment a job starts: the change lands AND cannot be taken back. Allowed and
 * irreversible is the one combination that must never happen.
 *
 * The message is the one the caller hears and the one the screen shows, so it
 * says what is true and what to do instead, in a sentence a dispatcher would
 * say out loud.
 */
function refuseIfUnderWay(job: JobSnapshot, verb: string): void {
  const ref = job.job_ref ?? job.id;
  if (job.completed_at) {
    throw new Error(`Job ${ref} is already finished, so it cannot be ${verb}.`);
  }
  if (job.started_at) {
    throw new Error(
      `Job ${ref} is already under way — a technician is on site. It cannot be ${verb}.`,
    );
  }
}

async function snapshot(sql: Sql, jobId: number): Promise<JobSnapshot | null> {
  const [row] = await sql`
    select id, job_ref, started_at, completed_at, scheduled_start, scheduled_end,
           window_end, work_status, is_canceled, canceled_at, description
    from job where id = ${jobId}
  `;
  return (row as unknown as JobSnapshot) ?? null;
}

function pick(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of SNAPSHOT_FIELDS) out[f] = row[f] ?? null;
  return out;
}

/**
 * Whether a change can still be taken back.
 *
 * The rule is "until the technician starts the job". Most of this book has no
 * start timestamp at all, so the fallback is time: an hour is long enough for a
 * person to notice a mistake on a call they just heard, and short enough that
 * nobody unwinds work already done. Stated here rather than buried, because the
 * PRD leaves it open and a window nobody can name is a window nobody trusts.
 */
export const UNDO_WINDOW_MS = 60 * 60 * 1000;

export function isUndoable(job: { started_at: Date | null }, changedAt: Date): boolean {
  if (job.started_at) return false;
  return Date.now() - changedAt.getTime() < UNDO_WINDOW_MS;
}

/**
 * Recomputes the rollup columns on the property a job belongs to.
 *
 * `property.last_visit_at`, `next_visit_at` and `visit_count` are stored, and
 * before the write path existed they were only ever computed by the pipeline.
 * The moment the agent can book, move or cancel, they go stale, and they are
 * exactly the fields the Property page and the agent's own dossier read: "when
 * were you last out here" and "what is coming up". A caller would have been
 * told the old answer for the visit that had just been moved for them.
 *
 * Same definitions as src/pipeline/derive/09_property_rollup.sql, scoped to one
 * property. A visit happened when a technician finished, not when a date was
 * typed into a calendar.
 */
export async function refreshPropertyRollup(sql: Sql, propertyId: number | null): Promise<void> {
  if (!propertyId) return;
  await sql`
    update property p set
      last_visit_at = roll.last_visit_at,
      next_visit_at = roll.next_visit_at,
      visit_count   = roll.visit_count
    from (
      select
        p2.id,
        max(j.completed_at) as last_visit_at,
        min(j.scheduled_start) filter (
          -- now(), not EXPORT_ANCHOR. The anchor is where the import stopped;
          -- a visit scheduled between it and today has already happened, and
          -- reading it back as "next scheduled" tells a caller we are coming
          -- on a date that is in their past.
          where j.is_canceled = false and j.scheduled_start > now()
        ) as next_visit_at,
        count(*) filter (where j.id is not null and j.is_canceled = false)::integer as visit_count
      from property p2
      left join job j on j.property_id = p2.id
      where p2.id = ${propertyId}
      group by p2.id
    ) roll
    where roll.id = p.id
  `;
}

/** The property a job sits at, for the rollup refresh. */
async function propertyOf(sql: Sql, jobId: number): Promise<number | null> {
  const [row] = await sql`select property_id from job where id = ${jobId}`;
  const id = (row as { property_id: number | null } | undefined)?.property_id;
  return id ? Number(id) : null;
}

async function writeChange(
  ctx: WriteContext,
  jobId: number,
  kind: ChangeKind,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  summary: string,
): Promise<number> {
  // The metric in `.claude/prds/front-desk-platform.prd.md` is 100%: a change
  // the agent made that nobody can explain is a failed gate rather than a
  // warning. Enforced here rather than trusted to every call site, because the
  // one that forgot was a debugging script and the next one will be something
  // in a hurry.
  //
  // A CALL **OR** A TICKET, since 0005. The rule was "must carry the call that
  // caused it", which was the only kind of cause that existed. A low-risk
  // board ticket the agent now runs on its own (src/read/tickets.ts, RISK) has
  // no call and is not unexplained: the ticket holds the goal, the facts it
  // read, the risks it weighed and the literal steps. That is a better answer
  // to "why did this happen" than a call id, not a worse one. What stays
  // forbidden is the thing the rule was written for — an agent change with no
  // cause attached at all.
  requireCause(ctx);

  const [row] = await ctx.sql`
    insert into job_change (tenant_id, job_id, call_id, ticket_id, actor, actor_label, kind, before, after, summary)
    values (
      current_setting('app.tenant_id', true), ${jobId}, ${ctx.callId ?? null}, ${ctx.ticketId ?? null},
      ${ctx.actor}, ${ctx.actorLabel ?? null}, ${kind},
      ${before as never}, ${after as never}, ${summary}
    )
    returning id
  `;
  return Number((row as { id: number }).id);
}

// --- move ------------------------------------------------------------------

export async function moveJob(
  ctx: WriteContext,
  jobId: number,
  startsAt: Date,
  durationMinutes = 120,
): Promise<ChangeResult> {
  const before = await snapshot(ctx.sql, jobId);
  if (!before) throw new Error(`No job ${jobId}`);
  if (before.is_canceled) throw new Error(`Job ${before.job_ref ?? jobId} is canceled`);
  refuseIfUnderWay(before, "moved");

  const end = new Date(startsAt.getTime() + durationMinutes * 60_000);

  // Moving a job to where it already is files a change that says nothing and
  // offers an undo that restores the same state. It happens for an ordinary
  // reason: the caller confirms a move the agent has already made, and the
  // agent obliges twice.
  const current = before["scheduled_start"] as Date | null;
  if (current && Math.abs(new Date(current).getTime() - startsAt.getTime()) < 60_000) {
    return {
      changeId: -1, jobId, jobRef: before.job_ref, kind: "move",
      summary: "Already at that time", undoable: false,
    };
  }

  await ctx.sql`
    update job set scheduled_start = ${startsAt}, scheduled_end = ${end}, window_end = ${end}
    where id = ${jobId}
  `;
  const after = await snapshot(ctx.sql, jobId);

  const when = startsAt.toLocaleString("en-US", {
    timeZone: TZ, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  const summary = `Moved to ${when}`;
  const changeId = await writeChange(ctx, jobId, "move", pick(before), pick(after!), summary);
  await refreshPropertyRollup(ctx.sql, await propertyOf(ctx.sql, jobId));

  return {
    changeId, jobId, jobRef: before.job_ref, kind: "move", summary,
    undoable: isUndoable(before, new Date()),
  };
}

// --- reassign --------------------------------------------------------------

export async function assignJob(
  ctx: WriteContext,
  jobId: number,
  employeeId: number | null,
): Promise<ChangeResult> {
  const before = await snapshot(ctx.sql, jobId);
  if (!before) throw new Error(`No job ${jobId}`);

  if (before.is_canceled) {
    throw new Error(`Job ${before.job_ref ?? jobId} is canceled, so nobody can be put on it.`);
  }
  refuseIfUnderWay(before, "reassigned");

  const prior = await ctx.sql`
    select e.id, e.first_name, e.last_name from job_employee je
    join employee e on e.id = je.employee_id where je.job_id = ${jobId}
  `;
  const priorIds = (prior as unknown as { id: number }[]).map((r) => Number(r.id));

  await ctx.sql`delete from job_employee where job_id = ${jobId}`;
  let name = "nobody";
  if (employeeId) {
    await ctx.sql`
      insert into job_employee (tenant_id, job_id, employee_id)
      values (current_setting('app.tenant_id', true), ${jobId}, ${employeeId})
    `;
    const [e] = await ctx.sql`
      select first_name, last_name from employee where id = ${employeeId}
    `;
    const emp = e as { first_name?: string; last_name?: string } | undefined;
    name = `${emp?.first_name ?? ""} ${emp?.last_name ?? ""}`.trim() || `employee ${employeeId}`;
  }

  const summary = employeeId ? `Assigned to ${name}` : "Unassigned";
  const changeId = await writeChange(
    ctx, jobId, "assign",
    { assigned: priorIds }, { assigned: employeeId ? [employeeId] : [] },
    summary,
  );
  return { changeId, jobId, jobRef: before.job_ref, kind: "assign", summary, undoable: true };
}

// --- cancel ----------------------------------------------------------------

export async function cancelJob(
  ctx: WriteContext,
  jobId: number,
  reason: string,
): Promise<ChangeResult> {
  const before = await snapshot(ctx.sql, jobId);
  if (!before) throw new Error(`No job ${jobId}`);
  if (before.completed_at) {
    throw new Error(`Job ${before.job_ref ?? jobId} is already finished, so it cannot be canceled.`);
  }
  if (before.is_canceled) {
    throw new Error(`Job ${before.job_ref ?? jobId} is already canceled.`);
  }

  await ctx.sql`
    update job set is_canceled = true, canceled_at = now(),
                   work_status = ${ctx.actor === "agent" ? "user canceled" : "pro canceled"}
    where id = ${jobId}
  `;
  const after = await snapshot(ctx.sql, jobId);
  const summary = `Canceled: ${reason}`;
  const changeId = await writeChange(ctx, jobId, "cancel", pick(before), pick(after!), summary);
  await refreshPropertyRollup(ctx.sql, await propertyOf(ctx.sql, jobId));
  return {
    changeId, jobId, jobRef: before.job_ref, kind: "cancel", summary,
    undoable: isUndoable(before, new Date()),
  };
}

// --- note ------------------------------------------------------------------

/**
 * Appends a note. Notes are never edited: a correction is another note, so the
 * history reads as one story and nothing a technician wrote can be quietly
 * rewritten by a machine.
 */
export async function addNote(
  ctx: WriteContext,
  jobId: number,
  content: string,
): Promise<ChangeResult & { noteId: number }> {
  const before = await snapshot(ctx.sql, jobId);
  if (!before) throw new Error(`No job ${jobId}`);

  const stamp = ctx.actor === "agent" ? "[agent] " : "";
  const text = `${stamp}${content}`;
  const [row] = await ctx.sql`
    insert into note (tenant_id, source_id, job_id, note_index, content, content_scrubbed)
    values (
      current_setting('app.tenant_id', true),
      ${`local_note_${Date.now()}_${Math.floor(Math.random() * 1e6)}`},
      ${jobId},
      (select coalesce(max(note_index), 0) + 1 from note where job_id = ${jobId}),
      ${text}, ${text}
    )
    returning id
  `;
  const noteId = Number((row as { id: number }).id);
  const summary = `Note added`;
  const changeId = await writeChange(ctx, jobId, "note", {}, { note_id: noteId, content: text }, summary);
  return { changeId, jobId, jobRef: before.job_ref, kind: "note", summary, undoable: false, noteId };
}

// --- running late ----------------------------------------------------------

export async function markLate(
  ctx: WriteContext,
  jobId: number,
  minutes: number,
): Promise<ChangeResult> {
  const before = await snapshot(ctx.sql, jobId);
  if (!before) throw new Error(`No job ${jobId}`);

  const start = before["scheduled_start"] as Date | null;
  const moved = start ? new Date(start.getTime() + minutes * 60_000) : null;
  if (moved) {
    await ctx.sql`
      update job set window_end = ${new Date(moved.getTime() + 60 * 60_000)} where id = ${jobId}
    `;
  }
  await addNote(
    { ...ctx },
    jobId,
    `Running late by about ${minutes} minutes. Customer to be told.`,
  );
  const after = await snapshot(ctx.sql, jobId);
  const summary = `Running ${minutes} min late`;
  const changeId = await writeChange(ctx, jobId, "late", pick(before), pick(after!), summary);
  return { changeId, jobId, jobRef: before.job_ref, kind: "late", summary, undoable: true };
}

// --- book ------------------------------------------------------------------

export interface BookInput {
  propertyId: number;
  startsAt: Date;
  durationMinutes?: number;
  description: string;
  employeeId?: number | null;
}

/**
 * The traceability rule, checked BEFORE anything is written.
 *
 * It used to live only inside `writeChange`, which runs at the END of bookJob —
 * so an agent booking with no call and no ticket inserted the job row, then
 * threw. The caller saw a refusal and the book quietly gained a job. The
 * write-path suite has a test asserting exactly this throws, and every run of
 * it left one more real job at a real address; fourteen had piled up before
 * anyone looked at the board.
 *
 * A guard that fires after the write is an apology, not a guard.
 */
function requireCause(ctx: WriteContext): void {
  if (
    ctx.actor === "agent" &&
    (ctx.callId === null || ctx.callId === undefined) &&
    (ctx.ticketId === null || ctx.ticketId === undefined)
  ) {
    throw new Error(
      "An agent change must carry the call or the ticket that caused it. " +
        "Without one there is no way to answer 'why did this move?', which is the " +
        "only question that matters when a customer rings up about it.",
    );
  }
}

export async function bookJob(ctx: WriteContext, input: BookInput): Promise<ChangeResult> {
  requireCause(ctx);

  const [prop] = await ctx.sql`
    select id, street_raw from property where id = ${input.propertyId}
  `;
  if (!prop) throw new Error(`No property ${input.propertyId}`);

  // Customer is inherited from the property's most recent job rather than asked
  // for. 53.8% of work comes from property managers, so the caller is usually
  // not the account, and guessing the account from the caller is the mistake
  // this whole system exists to avoid.
  const [prior] = await ctx.sql`
    select customer_id from job where property_id = ${input.propertyId}
      and customer_id is not null order by scheduled_start desc nulls last limit 1
  `;

  const end = new Date(input.startsAt.getTime() + (input.durationMinutes ?? 120) * 60_000);
  const [refRow] = await ctx.sql`
    select coalesce(max(job_ref::bigint), 0) + 1 as next from job
    where job_ref ~ '^[0-9]+$'
  `;
  const jobRef = String((refRow as { next: string | number }).next);

  const [row] = await ctx.sql`
    insert into job (
      tenant_id, source_id, customer_id, property_id, description, work_status,
      scheduled_start, scheduled_end, window_end, time_zone, job_ref, tags, created_at
    ) values (
      current_setting('app.tenant_id', true),
      ${`local_job_${Date.now()}_${Math.floor(Math.random() * 1e6)}`},
      ${(prior as { customer_id?: number } | undefined)?.customer_id ?? null},
      ${input.propertyId}, ${input.description}, 'scheduled',
      ${input.startsAt}, ${end}, ${end}, ${TZ}, ${jobRef},
      ${JSON.stringify(ctx.actor === "agent" ? ["booked-by-agent"] : ["booked-by-office"]) as never},
      now()
    )
    returning id
  `;
  const jobId = Number((row as { id: number }).id);

  if (input.employeeId) {
    await ctx.sql`
      insert into job_employee (tenant_id, job_id, employee_id)
      values (current_setting('app.tenant_id', true), ${jobId}, ${input.employeeId})
    `;
  }

  const when = input.startsAt.toLocaleString("en-US", {
    timeZone: TZ, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  const summary = `Booked ${when} at ${(prop as { street_raw: string }).street_raw}`;
  const changeId = await writeChange(
    ctx, jobId, "book", {},
    { property_id: input.propertyId, scheduled_start: input.startsAt, description: input.description },
    summary,
  );
  await refreshPropertyRollup(ctx.sql, input.propertyId);
  return { changeId, jobId, jobRef, kind: "book", summary, undoable: true };
}

// --- undo ------------------------------------------------------------------

/**
 * Restores the state a change moved away from, and records the restoration.
 *
 * Undo APPENDS. It does not delete the change it reverses, because the office
 * needs to fix something the agent got wrong without deleting the record of it
 * having happened, which is the only way the correction rate stays countable.
 */
export async function undoChange(ctx: WriteContext, changeId: number): Promise<ChangeResult> {
  const [row] = await ctx.sql`
    select id, job_id, kind, before, after, created_at, undone_at
    from job_change where id = ${changeId}
  `;
  if (!row) throw new Error(`No change ${changeId}`);
  const change = row as unknown as {
    job_id: number; kind: ChangeKind;
    before: Record<string, unknown>; after: Record<string, unknown>;
    created_at: Date; undone_at: Date | null;
  };
  if (change.undone_at) throw new Error("That change was already undone");

  // A note has nothing to put back. `addNote` records an empty `before`, and the
  // generic restore below writes `before` over the schedule columns — so undoing
  // a note set scheduled_start, scheduled_end, window_end and work_status to
  // NULL and the job fell off every board. The change that destroyed the data
  // reported success, and the only clue was the job quietly vanishing.
  //
  // Notes are append-only by design: the way to take one back is to add another
  // saying so, which is exactly what the record should show anyway.
  if (change.kind === "note") {
    throw new Error("A note cannot be taken back. Add another note that corrects it.");
  }

  const job = await snapshot(ctx.sql, change.job_id);
  if (!job) throw new Error(`No job ${change.job_id}`);
  if (!isUndoable(job, change.created_at)) {
    throw new Error(
      job.started_at
        ? "The technician has already started this job, so it can no longer be taken back"
        : "That change is older than the undo window",
    );
  }

  if (change.kind === "book") {
    await ctx.sql`
      update job set is_canceled = true, canceled_at = now(), work_status = 'pro canceled'
      where id = ${change.job_id}
    `;
  } else if (change.kind === "assign") {
    const prior = (change.before["assigned"] as number[]) ?? [];
    await ctx.sql`delete from job_employee where job_id = ${change.job_id}`;
    for (const id of prior) {
      await ctx.sql`
        insert into job_employee (tenant_id, job_id, employee_id)
        values (current_setting('app.tenant_id', true), ${change.job_id}, ${id})
      `;
    }
  } else {
    const b = change.before;
    await ctx.sql`
      update job set
        scheduled_start = ${(b["scheduled_start"] as string | null) ?? null},
        scheduled_end   = ${(b["scheduled_end"] as string | null) ?? null},
        window_end      = ${(b["window_end"] as string | null) ?? null},
        work_status     = ${(b["work_status"] as string | null) ?? null},
        is_canceled     = ${Boolean(b["is_canceled"])},
        canceled_at     = ${(b["canceled_at"] as string | null) ?? null}
      where id = ${change.job_id}
    `;
  }

  await ctx.sql`
    update job_change set undone_at = now(), undone_by = ${ctx.actorLabel ?? ctx.actor}
    where id = ${changeId}
  `;
  // Number(), because the driver hands a bigint back as a string and every
  // other action here returns a number. A client comparing jobId after an undo
  // silently matched nothing.
  const undoneJobId = Number(change.job_id);
  const summary = `Undid: ${change.kind}`;
  const newId = await writeChange(ctx, change.job_id, "undo", change.after ?? {}, change.before, summary);
  await refreshPropertyRollup(ctx.sql, await propertyOf(ctx.sql, change.job_id));
  return { changeId: newId, jobId: undoneJobId, jobRef: job.job_ref, kind: "undo", summary, undoable: false };
}
