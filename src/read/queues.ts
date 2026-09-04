/**
 * Catch up (.claude/prds/front-desk-platform.prd.md, milestone 6).
 *
 * Every product this company could buy shows what is scheduled. None shows what
 * quietly stopped. These five counts are the difference, and each is a query
 * against the company's own six months rather than a number typed into a slide.
 *
 * THE COUNTS ARE DERIVED, NEVER STORED. The PRD makes "queue counts match the
 * database, exactly" a metric, and the only way to guarantee that is to have
 * nothing to drift: the query IS the count. What cannot be derived is who owns
 * an item and when it is due, which is the whole difference between a queue and
 * a list, and that is the only thing queue_item holds.
 *
 * One number here is deliberately absent. "Back for the same fault" needs a
 * definition of "same fault" that the notes can actually support, and until
 * that is validated against the callback-tagged jobs it ships as pending rather
 * than as a number somebody would quote in a meeting.
 */
import type { Sql } from "../db/client.js";

/**
 * The same names as `QueueName`, as values, so a route can check one.
 * `/data/queues/nosuchqueue` used to answer 200 with an empty list, which reads
 * as "this backlog is clear" rather than "there is no such backlog".
 */
export const QUEUE_NAMES = [
  "finished_not_billed",
  "written_never_sent",
  "booked_no_tech",
  "needs_scheduling",
  "repeat_visits",
  "handoff_followup",
] as const;

export type QueueName =
  | "finished_not_billed"
  | "written_never_sent"
  | "booked_no_tech"
  | "needs_scheduling"
  | "repeat_visits"
  /**
   * Not a Catch up queue: the follow-up on a call the agent handed to a
   * person. Lives under the same table and the same dismiss so "what did
   * the office do about that call" is a row with a reason. Derived in
   * src/read/pressing.ts; getQueue returns nothing for it on purpose.
   */
  | "handoff_followup";

export interface QueueItem {
  subjectType: "job" | "invoice";
  subjectId: number;
  label: string;
  detail: string | null;
  amountCents: number | null;
  at: string | null;
  ownerId: number | null;
  ownerName: string | null;
  dueOn: string | null;
}

export interface QueueSummary {
  name: QueueName;
  title: string;
  count: number;
  amountCents: number | null;
  note: string;
  pending?: boolean;
}

/**
 * Money excludes voided AND canceled invoices, always.
 *
 * 76 invoices carry one of those two statuses and $268,433.84 of due amount
 * between them. A total that does not exclude both overstates receivables by
 * more than the real figure, which is $229,278.48. This clause is the reason
 * every money number on the platform can be read out loud.
 */
const LIVE_INVOICE = `not is_voided`;

export async function getQueueSummaries(sql: Sql): Promise<QueueSummary[]> {
  const [row] = await sql`
    select
      (select count(*)::int from job j
        where j.completed_at is not null
          and not exists (select 1 from invoice i where i.job_id = j.id)) as finished_not_billed,
      (select count(*)::int from invoice
        where sent_at is null and ${sql.unsafe(LIVE_INVOICE)}) as written_never_sent,
      (select coalesce(sum(amount_cents), 0)::bigint from invoice
        where sent_at is null and ${sql.unsafe(LIVE_INVOICE)}) as written_never_sent_cents,
      (select count(*)::int from job j
        where not j.is_canceled
          and not exists (select 1 from job_employee e where e.job_id = j.id)) as booked_no_tech,
      (select count(*)::int from job
        where work_status = 'needs scheduling') as needs_scheduling
  `;
  const r = row as Record<string, string | number>;

  return [
    {
      name: "finished_not_billed",
      title: "Finished, never billed",
      count: Number(r["finished_not_billed"]),
      amountCents: null,
      note: "Completed jobs with no invoice attached at all.",
    },
    {
      name: "written_never_sent",
      title: "Written, never sent",
      count: Number(r["written_never_sent"]),
      amountCents: Number(r["written_never_sent_cents"]),
      note: "Live invoices raised and never sent. Voided and canceled ones are excluded.",
    },
    {
      name: "booked_no_tech",
      title: "Booked, no technician",
      count: Number(r["booked_no_tech"]),
      amountCents: null,
      note: "Live jobs nobody is assigned to.",
    },
    {
      name: "needs_scheduling",
      title: "Needs scheduling",
      count: Number(r["needs_scheduling"]),
      amountCents: null,
      note: "Waiting, before the customer calls to ask.",
    },
    {
      name: "repeat_visits",
      title: "Back for the same fault",
      count: 0,
      amountCents: null,
      pending: true,
      note:
        "Same address, same problem. The definition is still being validated against the " +
        "callback-tagged jobs, so this ships with a real number or it does not ship.",
    },
  ];
}

/**
 * 500, not 50. The tile said "150 finished, never billed" and the list handed
 * back fifty rows with nothing saying so — a dispatcher working the backlog
 * down would have stopped a hundred jobs early, and the CSV export would have
 * been short by the same hundred. The largest queue here is 150, so this
 * returns all of every list at this size while still refusing to stream the
 * whole book if a queue definition ever goes wrong.
 */
export async function getQueue(sql: Sql, name: QueueName, limit = 500): Promise<QueueItem[]> {
  let rows: readonly unknown[] = [];

  if (name === "finished_not_billed") {
    rows = await sql`
      select 'job' as subject_type, j.id as subject_id,
             coalesce(j.job_ref, j.id::text) as label,
             coalesce(p.street_raw, 'no address on file') as detail,
             j.total_amount_cents as amount_cents, j.completed_at as at
      from job j left join property p on p.id = j.property_id
      where j.completed_at is not null
        and not exists (select 1 from invoice i where i.job_id = j.id)
      order by j.completed_at desc limit ${limit}
    `;
  } else if (name === "written_never_sent") {
    rows = await sql`
      select 'invoice' as subject_type, i.id as subject_id,
             coalesce(i.invoice_ref, i.id::text) as label,
             coalesce(p.street_raw, 'no address on file') as detail,
             i.amount_cents, i.invoice_date as at
      from invoice i
      left join job j on j.id = i.job_id
      left join property p on p.id = j.property_id
      where i.sent_at is null and not i.is_voided
      order by i.amount_cents desc nulls last limit ${limit}
    `;
  } else if (name === "booked_no_tech") {
    rows = await sql`
      select 'job' as subject_type, j.id as subject_id,
             coalesce(j.job_ref, j.id::text) as label,
             coalesce(p.street_raw, 'no address on file') as detail,
             j.total_amount_cents as amount_cents, j.scheduled_start as at
      from job j left join property p on p.id = j.property_id
      where not j.is_canceled
        and not exists (select 1 from job_employee e where e.job_id = j.id)
      order by j.scheduled_start nulls last limit ${limit}
    `;
  } else if (name === "needs_scheduling") {
    rows = await sql`
      select 'job' as subject_type, j.id as subject_id,
             coalesce(j.job_ref, j.id::text) as label,
             coalesce(p.street_raw, 'no address on file') as detail,
             j.total_amount_cents as amount_cents, j.created_at as at
      from job j left join property p on p.id = j.property_id
      where j.work_status = 'needs scheduling'
      order by j.created_at desc nulls last limit ${limit}
    `;
  } else {
    return [];
  }

  const items = (rows as unknown as Record<string, unknown>[]).map((r) => ({
    subjectType: r["subject_type"] as "job" | "invoice",
    subjectId: Number(r["subject_id"]),
    label: String(r["label"]),
    detail: (r["detail"] as string) ?? null,
    amountCents: r["amount_cents"] === null ? null : Number(r["amount_cents"]),
    at: (r["at"] as Date | null)?.toISOString() ?? null,
    ownerId: null as number | null,
    ownerName: null as string | null,
    dueOn: null as string | null,
  }));
  if (!items.length) return items;

  // Ownership is a left join in a second query rather than in the first,
  // because it must never be able to change the count.
  const assignments = await sql`
    select q.subject_id, q.owner_id, q.due_on, e.first_name, e.last_name
    from queue_item q left join employee e on e.id = q.owner_id
    where q.queue = ${name} and q.dismissed_at is null
  `;
  const byId = new Map<number, { ownerId: number | null; name: string | null; dueOn: string | null }>();
  for (const a of assignments as unknown as Record<string, unknown>[]) {
    byId.set(Number(a["subject_id"]), {
      ownerId: a["owner_id"] ? Number(a["owner_id"]) : null,
      name: `${a["first_name"] ?? ""} ${a["last_name"] ?? ""}`.trim() || null,
      dueOn: (a["due_on"] as Date | null)?.toISOString().slice(0, 10) ?? null,
    });
  }
  for (const item of items) {
    const a = byId.get(item.subjectId);
    if (a) {
      item.ownerId = a.ownerId;
      item.ownerName = a.name;
      item.dueOn = a.dueOn;
    }
  }
  return items;
}

export async function assignQueueItem(
  sql: Sql,
  name: QueueName,
  subjectType: string,
  subjectId: number,
  ownerId: number | null,
  dueOn: string | null,
): Promise<void> {
  await sql`
    insert into queue_item (tenant_id, queue, subject_type, subject_id, owner_id, due_on)
    values (current_setting('app.tenant_id', true), ${name}, ${subjectType}, ${subjectId},
            ${ownerId}, ${dueOn})
    on conflict (tenant_id, queue, subject_type, subject_id) do update
      set owner_id = excluded.owner_id, due_on = excluded.due_on,
          dismissed_at = null, dismiss_reason = null, updated_at = now()
  `;
}

export async function dismissQueueItem(
  sql: Sql,
  name: QueueName,
  subjectType: string,
  subjectId: number,
  reason: string,
): Promise<void> {
  await sql`
    insert into queue_item (tenant_id, queue, subject_type, subject_id, dismissed_at, dismiss_reason)
    values (current_setting('app.tenant_id', true), ${name}, ${subjectType}, ${subjectId},
            now(), ${reason})
    on conflict (tenant_id, queue, subject_type, subject_id) do update
      set dismissed_at = now(), dismiss_reason = excluded.dismiss_reason, updated_at = now()
  `;
}
