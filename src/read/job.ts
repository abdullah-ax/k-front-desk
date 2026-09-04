/**
 * One visit (.claude/prds/front-desk-platform.prd.md, milestone 5).
 *
 * The point of this screen is that there is ONE history. Office notes,
 * technician notes and the agent's entries are the same list in the order they
 * were written, so the record reads as one story rather than a person's version
 * and a machine's version sitting in separate tabs.
 *
 * Notes are never edited, so a correction appears beside the thing it corrects
 * and the agent's error rate stays countable. That is what tells the owner when
 * the agent has earned more.
 */
import type { Sql } from "../db/client.js";
import { UNDO_WINDOW_MS } from "../write/jobs.js";

export interface JobEntry {
  at: string;
  author: "office" | "technician" | "agent" | "system";
  authorName: string | null;
  body: string;
  kind: "note" | "change";
  changeId?: number;
  callId?: number | null;
  undoable?: boolean;
  undoneAt?: string | null;
}

export interface JobDetail {
  id: number;
  jobRef: string | null;
  description: string | null;
  status: string | null;
  isCanceled: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  completedAt: string | null;
  propertyId: number | null;
  address: string | null;
  unit: string | null;
  city: string | null;
  customer: string | null;
  assigned: { id: number; name: string }[];
  invoice: { ref: string | null; status: string | null; amountCents: number | null; dueCents: number | null } | null;
  entries: JobEntry[];
}

export async function getJob(sql: Sql, id: number): Promise<JobDetail | null> {
  const [row] = await sql`
    select j.id, j.job_ref, j.description, j.work_status, j.is_canceled,
           j.scheduled_start, j.scheduled_end, j.started_at, j.completed_at,
           j.property_id, p.street_raw, p.unit, p.city,
           coalesce(c.company, nullif(trim(c.first_name || ' ' || c.last_name), '')) as customer
    from job j
    left join property p on p.id = j.property_id
    left join customer c on c.id = j.customer_id
    where j.id = ${id}
  `;
  if (!row) return null;
  const j = row as Record<string, never> as unknown as {
    id: number; job_ref: string | null; description: string | null; work_status: string | null;
    is_canceled: boolean; scheduled_start: Date | null; scheduled_end: Date | null;
    started_at: Date | null; completed_at: Date | null; property_id: number | null;
    street_raw: string | null; unit: string | null; city: string | null; customer: string | null;
  };

  const [assigned, notes, changes, invoices] = await Promise.all([
    sql`select e.id, e.first_name, e.last_name from job_employee je
        join employee e on e.id = je.employee_id where je.job_id = ${id}`,
    sql`select id, content, coalesce(content_scrubbed, content) as shown, note_index, ingested_at
        from note where job_id = ${id} order by note_index nulls last, id`,
    sql`select ch.id, ch.actor, ch.actor_label, ch.kind, ch.summary, ch.created_at,
               ch.undone_at, ch.call_id
        from job_change ch where ch.job_id = ${id} order by ch.created_at`,
    sql`select invoice_ref, status, amount_cents, due_amount_cents, is_voided
        from invoice where job_id = ${id} order by invoice_date desc nulls last limit 1`,
  ]);

  const entries: JobEntry[] = [];

  for (const raw of notes as unknown as Record<string, unknown>[]) {
    const body = String(raw["shown"] ?? "");
    // Authorship is read off the text because the source export has no author
    // column on a note. The agent's own entries are stamped by the write path,
    // which is why that stamp exists at all.
    const isAgent = body.startsWith("[agent] ");
    entries.push({
      at: (raw["ingested_at"] as Date).toISOString(),
      author: isAgent ? "agent" : "office",
      authorName: isAgent ? "Front desk agent" : null,
      body: isAgent ? body.slice("[agent] ".length) : body,
      kind: "note",
    });
  }

  for (const raw of changes as unknown as Record<string, unknown>[]) {
    const createdAt = raw["created_at"] as Date;
    entries.push({
      at: createdAt.toISOString(),
      author: raw["actor"] === "agent" ? "agent" : "office",
      authorName: (raw["actor_label"] as string) ?? null,
      body: (raw["summary"] as string) ?? String(raw["kind"]),
      kind: "change",
      changeId: Number(raw["id"]),
      callId: raw["call_id"] ? Number(raw["call_id"]) : null,
      undoneAt: (raw["undone_at"] as Date | null)?.toISOString() ?? null,
      undoable:
        !raw["undone_at"] &&
        !j.started_at &&
        raw["kind"] !== "undo" &&
        raw["kind"] !== "note" &&
        Date.now() - createdAt.getTime() < UNDO_WINDOW_MS,
    });
  }

  // Newest first: the last few minutes are what somebody opening this needs.
  entries.sort((a, b) => b.at.localeCompare(a.at));

  const inv = (invoices as unknown as Record<string, unknown>[])[0];

  return {
    id: Number(j.id),
    jobRef: j.job_ref,
    description: j.description,
    status: j.work_status,
    isCanceled: j.is_canceled,
    scheduledStart: j.scheduled_start?.toISOString() ?? null,
    scheduledEnd: j.scheduled_end?.toISOString() ?? null,
    startedAt: j.started_at?.toISOString() ?? null,
    completedAt: j.completed_at?.toISOString() ?? null,
    propertyId: j.property_id ? Number(j.property_id) : null,
    address: j.street_raw,
    unit: j.unit,
    city: j.city,
    customer: j.customer,
    assigned: (assigned as unknown as Record<string, unknown>[]).map((a) => ({
      id: Number(a["id"]),
      name: `${a["first_name"] ?? ""} ${a["last_name"] ?? ""}`.trim(),
    })),
    invoice: inv
      ? {
          ref: (inv["invoice_ref"] as string) ?? null,
          status: (inv["status"] as string) ?? null,
          amountCents: inv["amount_cents"] === null ? null : Number(inv["amount_cents"]),
          // A voided invoice owes nothing, ever. Showing its due amount is how
          // a balance ends up overstated by more than the real figure.
          dueCents: inv["is_voided"] ? 0 : Number(inv["due_amount_cents"] ?? 0),
        }
      : null,
    entries,
  };
}

/** Address autocomplete for quick-create, over all 1,327 properties. */
export async function searchProperties(
  sql: Sql,
  term: string,
  limit = 8,
): Promise<{ id: number; address: string; unit: string | null; city: string | null; visits: number }[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const rows = await sql`
    select id, street_raw, unit, city, visit_count
    from property
    where street_raw ilike ${`%${t}%`}
    order by visit_count desc, street_raw limit ${limit}
  `;
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: Number(r["id"]),
    address: String(r["street_raw"]),
    unit: (r["unit"] as string) ?? null,
    city: (r["city"] as string) ?? null,
    visits: Number(r["visit_count"] ?? 0),
  }));
}
