/**
 * Agent tickets (.claude/prds/front-desk-platform.prd.md; NOTES.md §28).
 *
 * Two kinds of thing land on the tickets screen, and they are deliberately not
 * the same thing:
 *
 *   ACTIVITY   what the agent already did on a call. Read straight off
 *              job_change and call_event — no new table, nothing to drift.
 *              Each one carries the call it came from, the whole trace, and an
 *              Undo that works for exactly as long as src/write/jobs.ts says.
 *
 *   PROPOSALS  what a derivation noticed on the board and wants a person to
 *              approve before anything happens. These are the only rows in
 *              `ticket`. Nothing in this file executes a proposal on its own;
 *              approveTicket runs the steps through the same write path the
 *              buttons use, with the person's name on the change.
 *
 * The live call is untouched by any of this. On a call the agent still acts
 * and files an undoable change; that model is tested and gated, and a queue
 * in the middle of a phone conversation would be dead air. A ticket is for
 * the case where nobody is waiting on the line and there is time to ask.
 *
 * EVERY FACT ON A TICKET IS READ, NOT WRITTEN. The first prototype of this
 * screen had hand-typed tickets with hand-typed trails, and the owner said so.
 * Here a risk is a number from the book ("her nearest job that day is 20
 * minutes from this window"), and a gap is something the record genuinely
 * does not hold ("nothing here knows travel times"). Where the system cannot
 * do a thing — text a customer, for one — the ticket says that out loud
 * rather than proposing a tool that does not exist.
 */
import type { Sql } from "../db/client.js";
import { TZ } from "../config.js";
import type { TicketStep, TicketFact } from "../db/schema/tickets.js";
import {
  assignJob, markLate, moveJob, cancelJob, addNote, bookJob, UNDO_WINDOW_MS,
  type WriteContext, type ChangeResult,
} from "../write/jobs.js";

export type { TicketStep, TicketFact };

export interface Ticket {
  id: number;
  source: string;
  kind: string;
  callId: number | null;
  jobId: number | null;
  jobRef: string | null;
  description: string | null;
  address: string | null;
  unit: string | null;
  customer: string | null;
  goal: string;
  why: string | null;
  steps: TicketStep[];
  facts: TicketFact[];
  risks: string[];
  gaps: string[];
  closeCondition: string;
  dueAt: string | null;
  status: string;
  /** 'low' ran itself and this is the receipt; 'high' is waiting for a person. */
  risk: "low" | "high";
  result: Record<string, unknown>;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface AgentActivity {
  changeId: number;
  jobId: number;
  jobRef: string | null;
  description: string | null;
  address: string | null;
  unit: string | null;
  customer: string | null;
  kind: string;
  summary: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
  actorLabel: string | null;
  /** True while POST /data/actions/undo would actually work. */
  undoable: boolean;
  undoWindowEndsAt: string;
  callId: number | null;
  call: {
    channel: string;
    callerLabel: string | null;
    fromNumber: string | null;
    startedAt: string;
    status: string;
    handoffReason: string | null;
    turnCount: number;
    toolCount: number;
  } | null;
}

export type TicketListItem =
  | ({ type: "proposal" } & Ticket)
  | ({ type: "activity" } & AgentActivity);

// --- formatting, in the company's timezone ---------------------------------

function fmtWhen(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}
function place(street: string | null, unit: string | null): string {
  return street ? `${street}${unit ? ` unit ${unit}` : ""}` : "no address on file";
}
function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}
function spanText(mins: number): string {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}

// --- reading -----------------------------------------------------------------

const TICKET_COLUMNS = `
  t.id, t.source, t.kind, t.call_id, t.job_id, t.goal, t.why, t.steps, t.facts, t.risks, t.gaps,
  t.close_condition, t.due_at, t.status, t.risk, t.result, t.resolved_at, t.resolved_by,
  t.resolution_note, t.created_at,
  j.job_ref, j.description, p.street_raw, p.unit,
  coalesce(c.company, nullif(trim(c.first_name || ' ' || c.last_name), '')) as customer
`;
const TICKET_JOINS = `
  from ticket t
  left join job j on j.id = t.job_id
  left join property p on p.id = j.property_id
  left join customer c on c.id = j.customer_id
`;

function toTicket(r: Record<string, unknown>): Ticket {
  return {
    id: Number(r["id"]),
    source: String(r["source"]),
    kind: String(r["kind"]),
    callId: r["call_id"] ? Number(r["call_id"]) : null,
    jobId: r["job_id"] ? Number(r["job_id"]) : null,
    jobRef: (r["job_ref"] as string) ?? null,
    description: (r["description"] as string) ?? null,
    address: (r["street_raw"] as string) ?? null,
    unit: (r["unit"] as string) ?? null,
    customer: (r["customer"] as string) ?? null,
    goal: String(r["goal"]),
    why: (r["why"] as string) ?? null,
    steps: (r["steps"] as TicketStep[]) ?? [],
    facts: (r["facts"] as TicketFact[]) ?? [],
    risks: (r["risks"] as string[]) ?? [],
    gaps: (r["gaps"] as string[]) ?? [],
    closeCondition: String(r["close_condition"]),
    dueAt: (r["due_at"] as Date | null)?.toISOString() ?? null,
    status: String(r["status"]),
    risk: String(r["risk"] ?? "high") as "low" | "high",
    result: (r["result"] as Record<string, unknown>) ?? {},
    resolvedAt: (r["resolved_at"] as Date | null)?.toISOString() ?? null,
    resolvedBy: (r["resolved_by"] as string) ?? null,
    resolutionNote: (r["resolution_note"] as string) ?? null,
    createdAt: (r["created_at"] as Date).toISOString(),
  };
}

export async function readTickets(sql: Sql, status = "open"): Promise<Ticket[]> {
  const rows =
    status === "all"
      ? await sql`
          select ${sql.unsafe(TICKET_COLUMNS)} ${sql.unsafe(TICKET_JOINS)}
          order by (t.status = 'open') desc, t.due_at nulls last, t.created_at desc limit 200
        `
      : await sql`
          select ${sql.unsafe(TICKET_COLUMNS)} ${sql.unsafe(TICKET_JOINS)}
          where t.status = ${status}
          order by t.due_at nulls last, t.created_at desc limit 100
        `;
  return (rows as unknown as Record<string, unknown>[]).map(toTicket);
}

export async function getTicket(sql: Sql, id: number): Promise<Ticket | null> {
  const [row] = await sql`
    select ${sql.unsafe(TICKET_COLUMNS)} ${sql.unsafe(TICKET_JOINS)} where t.id = ${id}
  `;
  return row ? toTicket(row as Record<string, unknown>) : null;
}

/**
 * What the agent did on calls, recently, with the call attached.
 *
 * No table of its own. job_change already carries the actor, the call and the
 * before/after snapshots, so this is a read, and a read cannot disagree with
 * the record it is reading. The trail for a change is the call's own trace,
 * fetched by the screen through GET /data/calls/:id — the same assembly the
 * Calls screen uses, so there is one rendering of "what happened".
 */
export async function getAgentActivity(sql: Sql, limit = 40): Promise<AgentActivity[]> {
  const rows = await sql`
    select ch.id, ch.job_id, ch.call_id, ch.kind, ch.summary, ch.before, ch.after,
           ch.created_at, ch.actor_label,
           j.job_ref, j.description, j.started_at, p.street_raw, p.unit,
           coalesce(cu.company, nullif(trim(cu.first_name || ' ' || cu.last_name), '')) as customer,
           c.channel, c.caller_label, c.from_number, c.started_at as call_started_at,
           c.status as call_status, c.handoff_reason, c.turn_count, c.tool_count
    from job_change ch
    join job j on j.id = ch.job_id
    left join property p on p.id = j.property_id
    left join customer cu on cu.id = j.customer_id
    left join "call" c on c.id = ch.call_id
    where ch.actor = 'agent' and ch.undone_at is null and ch.kind <> 'undo'
      and ch.created_at > now() - interval '3 days'
    order by ch.created_at desc limit ${limit}
  `;
  return (rows as unknown as Record<string, unknown>[]).map((r) => {
    const createdAt = r["created_at"] as Date;
    const kind = String(r["kind"]);
    return {
      changeId: Number(r["id"]),
      jobId: Number(r["job_id"]),
      jobRef: (r["job_ref"] as string) ?? null,
      description: (r["description"] as string) ?? null,
      address: (r["street_raw"] as string) ?? null,
      unit: (r["unit"] as string) ?? null,
      customer: (r["customer"] as string) ?? null,
      kind,
      summary: (r["summary"] as string) ?? null,
      before: (r["before"] as Record<string, unknown>) ?? {},
      after: (r["after"] as Record<string, unknown>) ?? {},
      createdAt: createdAt.toISOString(),
      // Whether this was caused by a rehearsal rather than a customer. The
      // scripted demo and the write-path suite both write real changes through
      // the real path — that is the point of them — so 38 of the 40 cards on
      // the board were work nobody had to look at. Flagged, not deleted: the
      // change happened and the record should say so.
      rehearsal:
        r["channel"] === "web" &&
        (r["caller_label"] === "Test line" ||
          r["caller_label"] === "write-path gate" ||
          /^demo:/i.test(String(r["caller_label"] ?? ""))),
      actorLabel: (r["actor_label"] as string) ?? null,
      // The same rule src/read/job.ts applies, so the button is never a lie.
      undoable:
        !r["started_at"] && kind !== "note" &&
        Date.now() - createdAt.getTime() < UNDO_WINDOW_MS,
      undoWindowEndsAt: new Date(createdAt.getTime() + UNDO_WINDOW_MS).toISOString(),
      callId: r["call_id"] ? Number(r["call_id"]) : null,
      call: r["call_id"]
        ? {
            channel: String(r["channel"] ?? "phone"),
            callerLabel: (r["caller_label"] as string) ?? null,
            fromNumber: (r["from_number"] as string) ?? null,
            startedAt: (r["call_started_at"] as Date).toISOString(),
            status: String(r["call_status"] ?? "done"),
            handoffReason: (r["handoff_reason"] as string) ?? null,
            turnCount: Number(r["turn_count"] ?? 0),
            toolCount: Number(r["tool_count"] ?? 0),
          }
        : null,
    };
  });
}

// --- deriving proposals from the board ---------------------------------------

/**
 * Re-deriving on every poll would run the candidate queries every 2.5 seconds
 * for a board that changes a few times an hour. Once every 15 seconds per
 * instance is well inside the staleness the console promises and keeps the
 * shared connection free for the reads that actually paint the screen.
 */
const DERIVE_EVERY_MS = 15_000;
let lastDerived = 0;

export async function deriveBoardProposals(sql: Sql, force = false): Promise<number> {
  if (!force && Date.now() - lastDerived < DERIVE_EVERY_MS) return 0;
  lastDerived = Date.now();
  let made = 0;
  made += await proposeAssignments(sql);
  made += await proposeLateNotices(sql);
  return made;
}

interface Proposal {
  kind: string;
  jobId: number;
  goal: string;
  why: string;
  steps: TicketStep[];
  facts: TicketFact[];
  risks: string[];
  gaps: string[];
  closeCondition: string;
  dueAt: Date | null;
}

/**
 * WHAT THE AGENT MAY DO WITHOUT ASKING.
 *
 * One rule, in one place, so it can be argued with instead of being spread
 * across call sites as a habit. The line is not "how big is this change" but
 * **whose plan does it disturb**:
 *
 *   LOW  — records something already true, or adds something that did not
 *          exist. Nobody's existing commitment moves. Undoable for an hour
 *          like every other change, and it lands in the agent-activity list
 *          where a person sees it and can take it back.
 *
 *   HIGH — takes something back that was already promised, or commits a named
 *          person's time. A customer was told a window; a technician planned a
 *          day. Those get a human, every time.
 *
 * `mark_late` is the clearest low: the job IS late, forty minutes ago, whether
 * or not anybody clicks Approve, and marking it contacts nobody. `book_job`
 * fills an empty slot for work that did not exist. `assign_tech` is high on
 * purpose even though it fills a hole — the derivation picks "whoever is free
 * with the lightest day" and this system models neither skills nor travel, so
 * the pick is a guess worth a person's two seconds.
 */
const RISK: Record<string, "low" | "high"> = {
  mark_late: "low",
  add_note: "low",
  book_job: "low",
  assign_tech: "high",
  move_job: "high",
  cancel_job: "high",
};

/** A ticket is only as safe as its riskiest step. Unknown tools are high. */
export function riskOf(steps: TicketStep[]): "low" | "high" {
  return steps.some((s) => (RISK[s.tool] ?? "high") === "high") ? "high" : "low";
}

/** Inserts one proposal; the unique index makes a repeat a no-op. */
async function file(sql: Sql, p: Proposal): Promise<number> {
  const risk = riskOf(p.steps);
  const rows = await sql`
    insert into ticket (
      tenant_id, source, kind, job_id, goal, why, steps, facts, risks, gaps, close_condition, due_at, risk
    ) values (
      current_setting('app.tenant_id', true), 'board', ${p.kind}, ${p.jobId}, ${p.goal}, ${p.why},
      ${sql.json(p.steps as never)}, ${sql.json(p.facts as never)},
      ${sql.json(p.risks)}, ${sql.json(p.gaps)}, ${p.closeCondition}, ${p.dueAt}, ${risk}
    )
    on conflict do nothing
    returning id
  `;
  return rows.length;
}

interface OpenJobRow {
  id: number; job_ref: string | null; description: string | null;
  scheduled_start: Date; scheduled_end: Date; window_end: Date | null;
  property_id: number | null; street_raw: string | null; unit: string | null;
  customer: string | null; booked_by_agent: boolean;
}

/**
 * A visit with nobody on it, starting within two days.
 *
 * The pick is whoever is free for the window with the lightest day, and a
 * previous visit to the same property breaks ties — the one signal in this
 * book that says "knows the building". It is a proposal, not a dispatch: the
 * export has no skills, no travel times and no positions, and the ticket says
 * so in its gaps rather than pretending the pick is more than it is.
 */
async function proposeAssignments(sql: Sql): Promise<number> {
  const jobs = await sql`
    select j.id, j.job_ref, j.description, j.scheduled_start,
           coalesce(j.scheduled_end, j.scheduled_start + interval '2 hours') as scheduled_end,
           j.window_end, j.property_id, p.street_raw, p.unit,
           coalesce(c.company, nullif(trim(c.first_name || ' ' || c.last_name), '')) as customer,
           exists (
             select 1 from job_change ch where ch.job_id = j.id and ch.actor = 'agent' and ch.kind = 'book'
           ) as booked_by_agent
    from job j
    left join property p on p.id = j.property_id
    left join customer c on c.id = j.customer_id
    where not j.is_canceled and j.completed_at is null and j.started_at is null
      and j.scheduled_start between now() - interval '1 hour' and now() + interval '48 hours'
      and not exists (select 1 from job_employee je where je.job_id = j.id)
      and not exists (select 1 from ticket t where t.job_id = j.id and t.kind = 'assign_unassigned')
    order by j.scheduled_start limit 10
  `;

  let made = 0;
  for (const raw of jobs as unknown as OpenJobRow[]) {
    const start = raw.scheduled_start;
    const end = raw.scheduled_end;

    const techs = await sql`
      select e.id, e.first_name, e.last_name,
        (select count(*)::int from job_employee je join job j2 on j2.id = je.job_id
          where je.employee_id = e.id and not j2.is_canceled
            and (j2.scheduled_start at time zone ${TZ})::date
              = (${start}::timestamptz at time zone ${TZ})::date) as day_jobs,
        exists (select 1 from job_employee je join job j2 on j2.id = je.job_id
          where je.employee_id = e.id and not j2.is_canceled
            and j2.scheduled_start < ${end}::timestamptz
            and coalesce(j2.scheduled_end, j2.scheduled_start + interval '2 hours') > ${start}::timestamptz) as busy,
        (select count(*)::int from job_employee je join job j3 on j3.id = je.job_id
          where je.employee_id = e.id and j3.property_id = ${raw.property_id}) as visits_here,
        (select min(least(
            abs(extract(epoch from (j4.scheduled_start - ${end}::timestamptz))),
            abs(extract(epoch from (coalesce(j4.scheduled_end, j4.scheduled_start + interval '2 hours') - ${start}::timestamptz)))
          ))::int
          from job_employee je join job j4 on j4.id = je.job_id
          where je.employee_id = e.id and not j4.is_canceled
            and (j4.scheduled_start at time zone ${TZ})::date
              = (${start}::timestamptz at time zone ${TZ})::date) as nearest_gap_s
      from employee e where e.role = 'field tech' order by e.last_name, e.first_name
    `;
    const crew = (techs as unknown as {
      id: number; first_name: string | null; last_name: string | null;
      day_jobs: number; busy: boolean; visits_here: number; nearest_gap_s: number | null;
    }[]).map((t) => ({
      id: Number(t.id),
      name: `${t.first_name ?? ""} ${t.last_name ?? ""}`.trim(),
      dayJobs: Number(t.day_jobs),
      busy: Boolean(t.busy),
      visitsHere: Number(t.visits_here),
      nearestGapMin: t.nearest_gap_s === null ? null : Math.round(Number(t.nearest_gap_s) / 60),
    }));
    if (!crew.length) continue;

    const rank = (a: typeof crew[number], b: typeof crew[number]) =>
      b.visitsHere - a.visitsHere || a.dayJobs - b.dayJobs || a.name.localeCompare(b.name);
    const free = crew.filter((t) => !t.busy).sort(rank);
    const pick = free[0] ?? [...crew].sort((a, b) => a.dayJobs - b.dayJobs || a.name.localeCompare(b.name))[0]!;
    const others = free.filter((t) => t.id !== pick.id).slice(0, 4);

    const ref = raw.job_ref ?? String(raw.id);
    const where = place(raw.street_raw, raw.unit);
    const startsIn = minutesBetween(new Date(), start);

    const facts: TicketFact[] = [
      { label: "The visit", value: `Job ${ref} · ${where} · ${raw.description ?? "service call"} · ${fmtWhen(start)} to ${fmtTime(end)}`, source: "job" },
      { label: "Customer", value: raw.customer ?? "nobody on file", source: "customer" },
      { label: "Booked", value: raw.booked_by_agent ? "by the agent on a call, unassigned by design — the caller was not told a name" : "in the book, with nobody assigned", source: "job_change" },
      { label: pick.name, value: `${pick.dayJobs} job${pick.dayJobs === 1 ? "" : "s"} that day · ${pick.visitsHere} previous visit${pick.visitsHere === 1 ? "" : "s"} to this property · ${pick.busy ? "already booked in this window" : "free in this window"}`, source: "job_employee" },
      { label: "Also free", value: others.length ? others.map((t) => `${t.name} (${t.dayJobs})`).join(", ") : "nobody else is free for this window", source: "job_employee" },
    ];

    const risks: string[] = [];
    if (pick.nearestGapMin !== null && pick.nearestGapMin < 30) {
      risks.push(`${pick.name}'s nearest job that day is ${pick.nearestGapMin} minutes from this window, and the book has no travel times.`);
    }
    if (pick.dayJobs >= 3) risks.push(`${pick.name} already has ${pick.dayJobs} jobs that day.`);
    if (startsIn >= 0 && startsIn < 120) risks.push(`Starts in ${spanText(startsIn)}.`);
    if (startsIn < 0) risks.push(`Was due to start ${spanText(startsIn)} ago.`);

    const gaps: string[] = [
      "Nothing here knows technician skills or where anyone is right now; the pick is whoever is free with the lightest day.",
    ];
    if (pick.busy) {
      gaps.push(`No technician is free for this window. ${pick.name} has the lightest day but would be double-booked.`);
    }

    made += await file(sql, {
      kind: "assign_unassigned",
      jobId: Number(raw.id),
      goal: `Put ${pick.name} on job ${ref} at ${raw.street_raw ?? "the property"}`,
      why: `Job ${ref} starts ${fmtWhen(start)} and nobody is assigned to it.`,
      steps: [{
        tool: "assign_tech",
        args: { jobId: Number(raw.id), employeeId: pick.id },
        description: `Assign job ${ref} to ${pick.name}`,
      }],
      facts, risks, gaps,
      closeCondition: "Closes on approval. Nobody was promised a name, so nothing further needs to happen.",
      dueAt: start,
    });
  }
  return made;
}

interface LateJobRow {
  id: number; job_ref: string | null; description: string | null;
  scheduled_start: Date; window_end: Date;
  street_raw: string | null; unit: string | null; customer: string | null;
  techs: string | null; lane_jobs: number;
}

/**
 * A visit whose promised window has passed with nobody on the way.
 *
 * Half of this company's arrivals land past the window, by 44 minutes on
 * average, so "late" is the normal state and the customer is the one person
 * who does not know it yet. There is no notification log in this system and
 * no way to send a text, so the honest proposal is the real action that
 * exists: mark the job late, which moves the promised window and puts a note
 * on the job for the office to relay. The ticket says approving does not
 * contact anyone, because it does not.
 */
async function proposeLateNotices(sql: Sql): Promise<number> {
  const jobs = await sql`
    select j.id, j.job_ref, j.description, j.scheduled_start,
           coalesce(j.window_end, j.scheduled_end) as window_end,
           p.street_raw, p.unit,
           coalesce(c.company, nullif(trim(c.first_name || ' ' || c.last_name), '')) as customer,
           (select string_agg(e.first_name || ' ' || e.last_name, ', ')
              from job_employee je join employee e on e.id = je.employee_id where je.job_id = j.id) as techs,
           (select count(*)::int from job_employee je join job j2 on j2.id = je.job_id
              where je.employee_id in (select employee_id from job_employee where job_id = j.id)
                and j2.id <> j.id and not j2.is_canceled and j2.completed_at is null
                and (j2.scheduled_start at time zone ${TZ})::date = (now() at time zone ${TZ})::date) as lane_jobs
    from job j
    left join property p on p.id = j.property_id
    left join customer c on c.id = j.customer_id
    where not j.is_canceled and j.completed_at is null and j.started_at is null
      and coalesce(j.window_end, j.scheduled_end) < now() - interval '15 minutes'
      and (j.scheduled_start at time zone ${TZ})::date = (now() at time zone ${TZ})::date
      and not exists (select 1 from note n where n.job_id = j.id and n.content like '%Running late by about%')
      and not exists (select 1 from ticket t where t.job_id = j.id and t.kind = 'late_notice')
    order by coalesce(j.window_end, j.scheduled_end) limit 10
  `;

  let made = 0;
  const now = new Date();
  for (const raw of jobs as unknown as LateJobRow[]) {
    const ref = raw.job_ref ?? String(raw.id);
    const past = minutesBetween(raw.window_end, now);
    // markLate moves the window to start + minutes + one hour. Choose the
    // smallest quarter hour that lands the new window at least half an hour
    // out, so the record does not promise a time that has already passed.
    const sinceStart = minutesBetween(raw.scheduled_start, now);
    const minutes = Math.max(15, Math.ceil((sinceStart - 30) / 15) * 15);
    const newEnd = new Date(raw.scheduled_start.getTime() + (minutes + 60) * 60_000);
    const who = raw.techs ?? "nobody assigned";
    const where = place(raw.street_raw, raw.unit);

    const facts: TicketFact[] = [
      { label: "Promised", value: `by ${fmtTime(raw.window_end)} today (${fmtWhen(raw.scheduled_start)} start)`, source: "job.window_end" },
      { label: "Now", value: `${spanText(past)} past the window, and the visit has not started`, source: "job.started_at" },
      { label: "Technician", value: raw.techs ? `${who} · ${raw.lane_jobs} more open job${raw.lane_jobs === 1 ? "" : "s"} today` : "nobody is assigned", source: "job_employee" },
      { label: "The visit", value: `Job ${ref} · ${where} · ${raw.description ?? "service call"}`, source: "job" },
      { label: "Customer", value: raw.customer ?? "nobody on file", source: "customer" },
    ];

    const risks: string[] = [
      `The new window (until ${fmtTime(newEnd)}) is arithmetic, not a report from ${raw.techs ?? "a technician"}. Nobody has said when they will arrive.`,
    ];
    if (raw.lane_jobs > 0) {
      risks.push(`${who} has ${raw.lane_jobs} more job${raw.lane_jobs === 1 ? "" : "s"} today; each one after this is late now too.`);
    }
    const gaps: string[] = [
      "This system cannot text or call the customer. The note asks the office to tell them; approving does not contact anyone.",
    ];
    if (!raw.techs) gaps.push("No technician is on this job, so there is no one to ask for an arrival time.");

    made += await file(sql, {
      kind: "late_notice",
      jobId: Number(raw.id),
      goal: `Tell ${raw.customer ?? where} the technician is running late`,
      why: `Job ${ref} was promised by ${fmtTime(raw.window_end)} and has not started.`,
      steps: [{
        tool: "mark_late",
        args: { jobId: Number(raw.id), minutes },
        description: `Mark job ${ref} about ${minutes} minutes behind: the promised window becomes until ${fmtTime(newEnd)} and a note goes on the job for the technician`,
      }],
      facts, risks, gaps,
      closeCondition: "Closes when the office has told the customer the new window. Approving records the delay; it does not send anything.",
      dueAt: raw.window_end,
    });
  }
  return made;
}

// --- the list the screen renders --------------------------------------------

export async function listTickets(sql: Sql, opts: { status?: string } = {}): Promise<TicketListItem[]> {
  await deriveBoardProposals(sql);
  // Anything low-risk runs here rather than sitting in the queue waiting for
  // somebody to rubber-stamp a fact that is already true. It leaves the list
  // as an activity row with Undo, not a proposal — so the screen shows what
  // the agent DID next to what it wants to do, which is the whole point.
  await runLowRiskTickets({ sql, actor: "agent" });
  const [proposals, activity] = await Promise.all([
    readTickets(sql, opts.status ?? "open"),
    getAgentActivity(sql),
  ]);
  return [
    ...proposals.map((p) => ({ type: "proposal" as const, ...p })),
    ...activity.map((a) => ({ type: "activity" as const, ...a })),
  ];
}

// --- deciding ----------------------------------------------------------------

/**
 * One step of a ticket, run through the write path the buttons use.
 *
 * The tool names are the ticket's vocabulary, not the agent's registry: a
 * ticket can only propose what this function can run, which is how "propose
 * a text message" is impossible by construction rather than by review.
 */
async function runStep(ctx: WriteContext, step: TicketStep): Promise<ChangeResult> {
  const a = step.args ?? {};
  const jobId = Number(a["jobId"]);
  switch (step.tool) {
    case "assign_tech":
      return assignJob(ctx, jobId, a["employeeId"] === null || a["employeeId"] === undefined ? null : Number(a["employeeId"]));
    case "mark_late":
      return markLate(ctx, jobId, Number(a["minutes"] ?? 30));
    case "move_job":
      return moveJob(ctx, jobId, new Date(String(a["startsAt"])), a["durationMinutes"] ? Number(a["durationMinutes"]) : 120);
    case "cancel_job":
      return cancelJob(ctx, jobId, String(a["reason"] ?? "no reason given"));
    case "add_note":
      return addNote(ctx, jobId, String(a["note"] ?? ""));
    case "book_job":
      return bookJob(ctx, {
        propertyId: Number(a["propertyId"]),
        startsAt: new Date(String(a["startsAt"])),
        durationMinutes: a["durationMinutes"] ? Number(a["durationMinutes"]) : 120,
        description: String(a["description"] ?? "Service call"),
        employeeId: a["employeeId"] ? Number(a["employeeId"]) : null,
      });
    default:
      throw new Error(`A ticket step called "${step.tool}" is not something this system can run`);
  }
}

async function openTicket(sql: Sql, id: number): Promise<Ticket> {
  const t = await getTicket(sql, id);
  if (!t) throw new Error(`No ticket ${id}`);
  if (t.status !== "open") throw new Error(`Ticket #${id} was already ${t.status}`);
  return t;
}

/**
 * Runs the steps as the person approving, then marks the ticket. The change
 * rows carry "<name>, approved ticket #n" and the ticket carries the change
 * ids, so each links to the other and Undo on the change still works.
 */
export async function approveTicket(ctx: WriteContext, id: number, by: string): Promise<Ticket> {
  const t = await openTicket(ctx.sql, id);
  const label = `${by || "office"}, approved ticket #${id}`;
  const ran: { tool: string; changeId: number; jobId: number; jobRef: string | null; summary: string }[] = [];
  for (const step of t.steps) {
    const r = await runStep({ ...ctx, actor: "office", actorLabel: label }, step);
    ran.push({ tool: step.tool, changeId: r.changeId, jobId: r.jobId, jobRef: r.jobRef, summary: r.summary });
  }
  await ctx.sql`
    update ticket set status = 'approved', resolved_at = now(), resolved_by = ${by || "office"},
                      result = ${ctx.sql.json({ ran } as never)}
    where id = ${id}
  `;
  return (await getTicket(ctx.sql, id))!;
}

/**
 * Runs every open LOW-risk ticket, as the agent, without asking anybody.
 *
 * Deliberately a separate call from `deriveBoardProposals` rather than a
 * clause inside it: deriving is a read that happens to file rows, this is a
 * write that changes the book, and a function that quietly did both would be
 * the kind of thing nobody notices until it has run four hundred times.
 *
 * The change is attributed to the AGENT and carries `ticketId`, not a call —
 * see the widened rule in src/write/jobs.ts. It is undoable for the usual
 * hour and shows up in the agent-activity list, so "it did this on its own"
 * and "I can take it back" are the same screen.
 *
 * A step that throws marks its ticket `failed` with the reason and does not
 * stop the others. One bad job must not wedge the queue.
 */
export async function runLowRiskTickets(ctx: WriteContext): Promise<number> {
  const open = await ctx.sql`
    select id from ticket where status = 'open' and risk = 'low' order by id
  `;
  let ran = 0;
  for (const row of open as unknown as { id: number }[]) {
    const id = Number(row.id);
    try {
      const t = await getTicket(ctx.sql, id);
      if (!t || t.status !== "open") continue;
      const done: { tool: string; changeId: number; jobId: number; jobRef: string | null; summary: string }[] = [];
      for (const step of t.steps) {
        const r = await runStep(
          { ...ctx, actor: "agent", callId: null, ticketId: id, actorLabel: `agent, low risk, ticket #${id}` },
          step,
        );
        done.push({ tool: step.tool, changeId: r.changeId, jobId: r.jobId, jobRef: r.jobRef, summary: r.summary });
      }
      await ctx.sql`
        update ticket set status = 'auto', resolved_at = now(), resolved_by = 'agent',
                          result = ${ctx.sql.json({ ran: done } as never)}
        where id = ${id}
      `;
      ran += 1;
    } catch (err) {
      await ctx.sql`
        update ticket set status = 'failed', resolved_at = now(), resolved_by = 'agent',
                          resolution_note = ${(err as Error).message}
        where id = ${id}
      `;
    }
  }
  return ran;
}

export async function dismissTicket(sql: Sql, id: number, by: string, reason: string): Promise<Ticket> {
  await openTicket(sql, id);
  await sql`
    update ticket set status = 'dismissed', resolved_at = now(), resolved_by = ${by || "office"},
                      resolution_note = ${reason}
    where id = ${id}
  `;
  return (await getTicket(sql, id))!;
}

/**
 * The person is doing something else instead, in their own words. Nothing
 * runs: a countered ticket is a note on the record, and whatever they do next
 * goes through the ordinary board and is attributed to them there.
 */
export async function counterTicket(sql: Sql, id: number, by: string, note: string): Promise<Ticket> {
  await openTicket(sql, id);
  if (!note.trim()) throw new Error("Say what you are doing instead — it goes on the record");
  await sql`
    update ticket set status = 'countered', resolved_at = now(), resolved_by = ${by || "office"},
                      resolution_note = ${note.trim()}
    where id = ${id}
  `;
  return (await getTicket(sql, id))!;
}
