/**
 * The Today board (.claude/prds/front-desk-platform.prd.md, milestone 2).
 *
 * One query set, one day, everything on it. The shape is dictated by what the
 * export actually says about this company rather than by what a dispatch board
 * usually looks like:
 *
 *   median day 9 jobs, worst 25, 15 field technicians
 *     -> the whole day fits on one screen, so there are no filters. A filter
 *        would only ever hide the job that is about to go wrong.
 *   60.3% booked same day, median 3.1 hours notice
 *     -> there is no planning horizon to design for. Today and tomorrow is the
 *        whole product, and the board has to update while a call is running.
 *   half of arrivals land past the window, by 44 minutes
 *     -> late is the normal state, not an exception, so it is a first-class
 *        field rather than something computed in a template.
 *
 * The same query also serves a date RANGE (`getSchedule`), because "the way
 * FSM software actually does it" is a list that spans the book — next week's
 * five jobs, the two on the 15th — and the owner asked for exactly that. The
 * board stays one day; the list is the one view that spans the ten-day book,
 * as the console PRD's milestone 4b puts it.
 */
import type { Sql } from "../db/client.js";
import { TZ } from "../config.js";
import { closeStaleCalls } from "../calls/record.js";

export interface BoardJob {
  id: number;
  jobRef: string | null;
  description: string | null;
  status: string | null;
  isCanceled: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lateMinutes: number | null;
  employeeId: number | null;
  propertyId: number | null;
  address: string | null;
  unit: string | null;
  customer: string | null;
  /** A change from a call that is still connected. The dashed block. */
  agentLive: boolean;
  /** Any agent change at all, undone or not. */
  byAgent: boolean;
}

export interface BoardRow {
  employeeId: number | null;
  name: string;
  jobs: BoardJob[];
}

export interface Board {
  date: string;
  rows: BoardRow[];
  counts: { jobs: number; unassigned: number; late: number; canceled: number };
  liveCalls: number;
}

/** One job in the list view: one row per job, technicians collapsed. */
export interface ScheduleJob extends BoardJob {
  /** Local calendar day, YYYY-MM-DD, so the list can group without a timezone dance. */
  day: string;
  technicians: { id: number; name: string }[];
}

export interface Schedule {
  from: string;
  to: string;
  jobs: ScheduleJob[];
  counts: { jobs: number; unassigned: number; late: number; canceled: number };
}

/** Local midnight to local midnight, so a day is the day the office means. */
function dayBounds(date: string): { from: string; to: string } {
  return { from: `${date} 00:00:00`, to: `${date} 23:59:59.999` };
}

interface JobRow {
  id: number; job_ref: string | null; description: string | null;
  work_status: string | null; is_canceled: boolean;
  scheduled_start: Date | null; scheduled_end: Date | null; window_end: Date | null;
  started_at: Date | null; completed_at: Date | null;
  property_id: number | null; street_raw: string | null; unit: string | null;
  customer: string | null; employee_id: number | null;
  first_name: string | null; last_name: string | null;
  by_agent: boolean; agent_live: boolean;
}

/** Every job whose local start falls between two local wall-clock bounds. */
async function jobsBetween(sql: Sql, from: string, to: string): Promise<JobRow[]> {
  const rows = await sql`
    select
      j.id, j.job_ref, j.description, j.work_status, j.is_canceled,
      j.scheduled_start, j.scheduled_end, j.window_end, j.started_at, j.completed_at,
      j.property_id, p.street_raw, p.unit,
      coalesce(c.company, nullif(trim(c.first_name || ' ' || c.last_name), '')) as customer,
      je.employee_id,
      e.first_name, e.last_name,
      -- Two flags, not one. "The agent touched this" and "the agent is touching
      -- it right now" are different things on a board: the second is the dashed
      -- block that no product on the market draws.
      exists (
        select 1 from job_change ch where ch.job_id = j.id and ch.actor = 'agent'
      ) as by_agent,
      exists (
        select 1 from job_change ch
        join "call" cl on cl.id = ch.call_id
        where ch.job_id = j.id and ch.actor = 'agent' and cl.status = 'live'
      ) as agent_live
    from job j
    left join property p on p.id = j.property_id
    left join customer c on c.id = j.customer_id
    left join job_employee je on je.job_id = j.id
    left join employee e on e.id = je.employee_id
    where j.scheduled_start at time zone ${TZ} between ${from} and ${to}
    order by j.scheduled_start, j.id
  `;
  return rows as unknown as JobRow[];
}

function lateOf(r: JobRow): number | null {
  const windowEnd = r.window_end ?? r.scheduled_end;
  const arrived = r.started_at;
  return arrived && windowEnd && arrived > windowEnd
    ? Math.round((arrived.getTime() - windowEnd.getTime()) / 60_000)
    : null;
}

function toBoardJob(r: JobRow): BoardJob {
  return {
    id: Number(r.id),
    jobRef: r.job_ref,
    description: r.description,
    status: r.work_status,
    isCanceled: r.is_canceled,
    scheduledStart: r.scheduled_start?.toISOString() ?? null,
    scheduledEnd: (r.scheduled_end ?? r.window_end)?.toISOString() ?? null,
    startedAt: r.started_at?.toISOString() ?? null,
    completedAt: r.completed_at?.toISOString() ?? null,
    lateMinutes: lateOf(r),
    employeeId: r.employee_id ? Number(r.employee_id) : null,
    propertyId: r.property_id ? Number(r.property_id) : null,
    address: r.street_raw,
    unit: r.unit,
    customer: r.customer,
    agentLive: Boolean(r.agent_live),
    byAgent: Boolean(r.by_agent),
  };
}

function techName(r: JobRow, id: number): string {
  return `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || `Employee ${id}`;
}

export async function getBoard(sql: Sql, date: string): Promise<Board> {
  const { from, to } = dayBounds(date);
  // The live count in the header has to be true, or every other count on the
  // screen becomes suspect.
  await closeStaleCalls(sql);

  const rows = await jobsBetween(sql, from, to);

  const byEmployee = new Map<number | null, BoardRow>();
  const counts = { jobs: 0, unassigned: 0, late: 0, canceled: 0 };
  const seen = new Set<number>();

  for (const r of rows) {
    const id = Number(r.id);
    // A job assigned to two technicians appears on both rows and counts once.
    if (!seen.has(id)) {
      seen.add(id);
      counts.jobs += 1;
      if (r.is_canceled) counts.canceled += 1;
      if (!r.employee_id && !r.is_canceled) counts.unassigned += 1;
    }

    const job = toBoardJob(r);
    if (job.lateMinutes && !seen.has(-id)) {
      seen.add(-id);
      counts.late += 1;
    }

    const key = job.employeeId;
    const name = key ? techName(r, key) : "Unassigned";
    const row = byEmployee.get(key) ?? { employeeId: key, name, jobs: [] };
    row.jobs.push(job);
    byEmployee.set(key, row);
  }

  const [live] = await sql`select count(*)::int as n from "call" where status = 'live'`;

  // Technicians with work first, alphabetically; the unassigned row is pinned
  // last and is never hidden, because it is the one that has to be impossible
  // to miss.
  const list = [...byEmployee.values()];
  const assigned = list.filter((r) => r.employeeId !== null).sort((a, b) => a.name.localeCompare(b.name));
  const unassigned = list.filter((r) => r.employeeId === null);

  return {
    date,
    rows: [...assigned, ...unassigned],
    counts,
    liveCalls: Number((live as { n: number }).n),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Two months is the whole planning horizon this book has ever shown. */
const MAX_RANGE_DAYS = 62;

/**
 * The list across a range of days. One row per job; a job with two
 * technicians lists both rather than appearing twice, because a list is read
 * top to bottom and a duplicate row reads as a second visit.
 */
export async function getSchedule(sql: Sql, from: string, to: string): Promise<Schedule> {
  if (!DATE.test(from) || !DATE.test(to)) throw new Error("Dates must be YYYY-MM-DD");
  let end = to < from ? from : to;
  const span = (new Date(`${end}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000;
  if (span > MAX_RANGE_DAYS) {
    const capped = new Date(new Date(`${from}T12:00:00Z`).getTime() + MAX_RANGE_DAYS * 86_400_000);
    end = capped.toISOString().slice(0, 10);
  }

  const rows = await jobsBetween(sql, dayBounds(from).from, dayBounds(end).to);
  const dayOf = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });

  const byId = new Map<number, ScheduleJob>();
  const counts = { jobs: 0, unassigned: 0, late: 0, canceled: 0 };
  for (const r of rows) {
    const id = Number(r.id);
    let job = byId.get(id);
    if (!job) {
      const base = toBoardJob(r);
      job = {
        ...base,
        day: r.scheduled_start ? dayOf.format(r.scheduled_start) : from,
        technicians: [],
      };
      byId.set(id, job);
      counts.jobs += 1;
      if (job.isCanceled) counts.canceled += 1;
      if (job.lateMinutes) counts.late += 1;
      if (!r.employee_id && !job.isCanceled) counts.unassigned += 1;
    }
    if (r.employee_id) {
      const eid = Number(r.employee_id);
      if (!job.technicians.some((t) => t.id === eid)) {
        job.technicians.push({ id: eid, name: techName(r, eid) });
      }
    }
  }

  return { from, to: end, jobs: [...byId.values()], counts };
}

/** Technicians who can take work, for the assign control. */
export async function getTechnicians(
  sql: Sql,
): Promise<{ id: number; name: string; role: string | null }[]> {
  const rows = await sql`
    select id, first_name, last_name, role from employee
    where role in ('field tech', 'office staff') order by role, last_name
  `;
  return (rows as unknown as { id: number; first_name: string; last_name: string; role: string }[])
    .map((r) => ({
      id: Number(r.id),
      name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
      role: r.role,
    }));
}
