/**
 * Pressing: everything waiting on a person, in one list.
 *
 * Every product this company could buy shows what is scheduled. What is
 * missing is the thing the owner asked for by name — the calls the agent had
 * to hand to a person, the callbacks that are due, the visit whose window has
 * gone by — with enough context to act without opening anything else.
 *
 * NOTHING HERE IS A NEW TABLE. Three real records make the list:
 *
 *   call          today's calls that ended with a handoff, and any call that
 *                 is live right now. A handoff is a successful outcome on the
 *                 phone and an open item on the desk, and it stays here until
 *                 somebody says what they did about it.
 *   queue_item    the Catch up items somebody gave a due date to.
 *   ticket        proposals whose real deadline is close.
 *
 * Dismissing a handoff reuses queue_item exactly as the five Catch up queues
 * do, under the queue name `handoff_followup`, so "what did the office do
 * about this call" is a row with a reason and a time rather than a checkbox.
 *
 * URGENCY IS NOT INVENTED. It comes from the handoff reason, which is a value
 * from the closed list in src/tools/handoff.ts (plus "empty reply", which
 * src/calls/session.ts records when the model returns no words), and from
 * arithmetic on real timestamps. A safety handoff outranks a quote request
 * because the reason says so, not because somebody ranked the row.
 */
import type { Sql } from "../db/client.js";
import { TZ } from "../config.js";

export type Urgency = "now" | "soon" | "routine";

export interface PressingItem {
  key: string;
  kind: "live" | "callback" | "due" | "ticket";
  urgency: Urgency;
  title: string;
  detail: string;
  /** The handoff reason verbatim, from the closed list. */
  reason: string | null;
  reasonLabel: string | null;
  /** What a person does about this kind of handoff. Fixed per reason. */
  next: string | null;
  /** The agent's own one-line account of the call, recorded by the handoff tool. */
  summary: string | null;
  at: string;
  dueAt: string | null;
  callId: number | null;
  jobId: number | null;
  ticketId: number | null;
  propertyId: number | null;
  channel: string | null;
  /** True for the scripted demo's calls, so a rehearsal is never mistaken for a customer. */
  rehearsal: boolean;
  dismiss: { queue: string; subjectType: string; subjectId: number } | null;
}

/**
 * The closed list, in plain words, with what each one asks of a person.
 * Mirrors src/tools/handoff.ts REASONS. A reason not in this table renders as
 * itself rather than being dropped, so a new value is visible, not lost.
 */
export const REASONS: Record<string, { label: string; urgency: Urgency; next: string }> = {
  safety: { label: "Safety", urgency: "now", next: "Someone calls back now." },
  access_code_unverified_caller: {
    label: "Entry code, caller not verified", urgency: "routine",
    next: "Verify the caller against the account before anything about access is said.",
  },
  install_or_replacement_quote: {
    label: "Install or replacement quote", urgency: "routine",
    next: "A person prices it and calls back. The agent never quotes an installation.",
  },
  warranty_decision: {
    label: "Warranty decision", urgency: "routine",
    next: "A person decides. The agent only gathers the evidence.",
  },
  discount_request: { label: "Discount request", urgency: "routine", next: "A person decides on pricing." },
  ambiguous_identity: {
    label: "Could not tell who was calling", urgency: "routine",
    next: "Match the caller to an account before touching the record.",
  },
  repeat_visit_or_upset_caller: {
    label: "Repeat visit or upset caller", urgency: "soon",
    next: "Call back with the history open.",
  },
  repeated_failure_to_understand: {
    label: "Could not understand the caller", urgency: "soon",
    next: "Call back; the transcript shows where it lost them.",
  },
  "empty reply": {
    label: "The agent went silent", urgency: "soon",
    next: "Call back. The model returned no words and the fallback line was played instead.",
  },
  other: { label: "Other", urgency: "routine", next: "Read the agent's summary; it says why it stopped." },
};

const ORDER: Record<Urgency, number> = { now: 0, soon: 1, routine: 2 };

export function describeReason(reason: string | null): { label: string; urgency: Urgency; next: string } | null {
  if (!reason) return null;
  return REASONS[reason] ?? { label: reason.replace(/_/g, " "), urgency: "routine", next: "Read the call." };
}

export async function getPressing(sql: Sql): Promise<PressingItem[]> {
  const items: PressingItem[] = [];

  // --- handoffs and live calls ---------------------------------------------
  //
  // The handoff tool writes its summary into pipeline_run.detail. That column
  // holds the JSON as a string inside jsonb (the driver serialised an already
  // serialised value), so it is unwrapped here rather than fixed there: the
  // tool is on the live-call path and its tests are the expensive ones.
  const calls = await sql`
    select c.id, c.channel, c.caller_label, c.from_number, c.status, c.started_at,
           c.handoff_reason, c.property_id, c.turn_count, c.change_count, c.summary as call_summary,
           p.street_raw, p.unit,
           (select case when jsonb_typeof(pr.detail) = 'string'
                        then (pr.detail #>> '{}')::jsonb ->> 'summary'
                        else pr.detail ->> 'summary' end
              from pipeline_run pr
              where pr.task = 'handoff'
                and (case when jsonb_typeof(pr.detail) = 'string'
                          then (pr.detail #>> '{}')::jsonb ->> 'callId'
                          else pr.detail ->> 'callId' end) = c.provider_call_id
              order by pr.started_at desc limit 1) as agent_summary
    from "call" c
    left join property p on p.id = c.property_id
    where (c.status = 'live'
           or (c.handoff_reason is not null
               and (c.started_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date))
      and not exists (
        select 1 from queue_item q
        where q.queue = 'handoff_followup' and q.subject_type = 'call'
          and q.subject_id = c.id and q.dismissed_at is not null
      )
    order by (c.status = 'live') desc, c.started_at desc
    limit 80
  `;
  for (const r of calls as unknown as Record<string, unknown>[]) {
    const live = r["status"] === "live";
    const reason = (r["handoff_reason"] as string) ?? null;
    const d = describeReason(reason);
    const label = (r["caller_label"] as string) ?? null;
    const who = (r["street_raw"] as string)
      ? `${r["street_raw"]}${r["unit"] ? ` unit ${r["unit"]}` : ""}`
      : label ?? (r["from_number"] as string) ?? "Unknown caller";
    items.push({
      key: `call:${r["id"]}`,
      kind: live ? "live" : "callback",
      urgency: live ? "now" : (d?.urgency ?? "routine"),
      title: live
        ? (reason ? `${who} is on the line and needs a person` : `${who} is on the line`)
        : `Call back ${who}`,
      detail: d ? d.label : "Call in progress",
      reason,
      reasonLabel: d?.label ?? null,
      next: d?.next ?? null,
      // The agent's own words from the handoff tool first; failing that, the
      // mechanical one-liner src/calls/continuity.ts writes at hangup.
      summary: (r["agent_summary"] as string) ?? (r["call_summary"] as string) ?? null,
      at: (r["started_at"] as Date).toISOString(),
      dueAt: null,
      callId: Number(r["id"]),
      jobId: null,
      ticketId: null,
      propertyId: r["property_id"] ? Number(r["property_id"]) : null,
      channel: String(r["channel"] ?? "phone"),
      // The scripted demo labels its calls "demo: …". A person on the test
      // line is not a rehearsal; the owner's own test call has to pop up.
      rehearsal: r["channel"] === "web" && /^demo:/.test(label ?? ""),
      dismiss: { queue: "handoff_followup", subjectType: "call", subjectId: Number(r["id"]) },
    });
  }

  // --- catch-up items with a date on them ----------------------------------
  const due = await sql`
    select q.queue, q.subject_type, q.subject_id, q.due_on, e.first_name, e.last_name,
      case when q.subject_type = 'job' then
        (select coalesce(j.job_ref, j.id::text) || ' · ' || coalesce(p.street_raw, 'no address on file')
           from job j left join property p on p.id = j.property_id where j.id = q.subject_id)
      else
        (select 'invoice ' || coalesce(i.invoice_ref, i.id::text) from invoice i where i.id = q.subject_id)
      end as label
    from queue_item q
    left join employee e on e.id = q.owner_id
    where q.dismissed_at is null and q.due_on is not null and q.queue <> 'handoff_followup'
      and q.due_on <= current_date + 7
    order by q.due_on
  `;
  for (const r of due as unknown as Record<string, unknown>[]) {
    const dueOn = (r["due_on"] as Date).toISOString().slice(0, 10);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const owner = `${r["first_name"] ?? ""} ${r["last_name"] ?? ""}`.trim();
    items.push({
      key: `queue:${r["queue"]}:${r["subject_type"]}:${r["subject_id"]}`,
      kind: "due",
      urgency: dueOn <= today ? "soon" : "routine",
      title: String(r["label"] ?? `${r["subject_type"]} ${r["subject_id"]}`),
      detail: `${String(r["queue"]).replace(/_/g, " ")} · due ${dueOn}${owner ? ` · ${owner}` : ""}`,
      reason: null, reasonLabel: null, next: null, summary: null,
      at: dueOn,
      dueAt: dueOn,
      callId: null,
      jobId: r["subject_type"] === "job" ? Number(r["subject_id"]) : null,
      ticketId: null,
      propertyId: null,
      channel: null,
      rehearsal: false,
      dismiss: { queue: String(r["queue"]), subjectType: String(r["subject_type"]), subjectId: Number(r["subject_id"]) },
    });
  }

  // --- proposals whose real deadline is close -------------------------------
  const tickets = await sql`
    select t.id, t.kind, t.goal, t.why, t.due_at, t.job_id
    from ticket t
    where t.status = 'open' and t.due_at is not null and t.due_at < now() + interval '2 hours'
    order by t.due_at
  `;
  for (const r of tickets as unknown as Record<string, unknown>[]) {
    const dueAt = r["due_at"] as Date;
    items.push({
      key: `ticket:${r["id"]}`,
      kind: "ticket",
      urgency: dueAt.getTime() < Date.now() + 60 * 60_000 ? "soon" : "routine",
      title: String(r["goal"]),
      detail: `Ticket #${r["id"]} · ${String(r["why"] ?? "")}`,
      reason: null, reasonLabel: null, next: null, summary: null,
      at: dueAt.toISOString(),
      dueAt: dueAt.toISOString(),
      callId: null,
      jobId: r["job_id"] ? Number(r["job_id"]) : null,
      ticketId: Number(r["id"]),
      propertyId: null,
      channel: null,
      rehearsal: false,
      dismiss: null,
    });
  }

  // Live first, then by what the reason says, then newest.
  return items.sort((a, b) =>
    Number(b.kind === "live") - Number(a.kind === "live") ||
    ORDER[a.urgency] - ORDER[b.urgency] ||
    b.at.localeCompare(a.at));
}
