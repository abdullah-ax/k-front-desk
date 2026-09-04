/**
 * pnpm test:derived — the derived columns, asserted against the live database.
 * (.claude/plans/front-desk.plan.md, Part B task 5.)
 *
 * Every assertion below is one measured defect from eda/05-data-quality.md, and
 * the number in it is the number the EDA measured — not a number chosen to make
 * a test pass. If the source export changes, these fail loudly, which is the
 * point: they are the proof that nothing downstream reads a broken source field.
 *
 * Reads go through withTenant (src/db/client.ts) exactly like production. A test
 * that queried as the connection role would run with BYPASSRLS and prove nothing
 * about what the agent can actually see.
 *
 * Requires: pnpm pipeline:load && pnpm pipeline:derive.
 */
import { afterAll, describe, expect, it } from "vitest";

import { EXPECTED_COUNTS, EXPORT_ANCHOR, TZ } from "../src/config.js";
import { closeDb, withTenant } from "../src/db/client.js";

afterAll(async () => {
  await closeDb();
});

/** postgres.js hands back bigint counts as strings; every assertion wants a number. */
const num = (v: unknown): number => Number(v ?? 0);

describe("row counts", () => {
  it("every core table holds exactly what the export carries", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          (select count(*) from employee)     as employees,
          (select count(*) from customer)     as customers,
          (select count(*) from job)          as jobs,
          (select count(*) from note)         as notes,
          (select count(*) from invoice)      as invoices,
          (select count(*) from invoice_item) as invoice_items,
          (select count(*) from job_employee) as assignments,
          (select count(*) from property)     as properties`,
    );
    const r = rows[0]!;
    expect(num(r.jobs)).toBe(EXPECTED_COUNTS.jobs);
    expect(num(r.notes)).toBe(EXPECTED_COUNTS.notes);
    expect(num(r.customers)).toBe(EXPECTED_COUNTS.customers);
    expect(num(r.employees)).toBe(EXPECTED_COUNTS.employees);
    expect(num(r.invoices)).toBe(EXPECTED_COUNTS.invoices);
    expect(num(r.invoice_items)).toBe(EXPECTED_COUNTS.invoice_items);
    expect(num(r.assignments)).toBe(EXPECTED_COUNTS.assigned_employees);
    // 1,390 source address ids collapse to fewer physical places; never more.
    expect(num(r.properties)).toBeLessThan(EXPECTED_COUNTS.addresses);
  });

  it("every job resolves to a customer and a property", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*) filter (where customer_id is null) as orphan_customer,
          count(*) filter (where property_id is null) as orphan_property
        from job`,
    );
    expect(num(rows[0]!.orphan_customer)).toBe(0);
    expect(num(rows[0]!.orphan_property)).toBe(0);
  });
});

describe("job_ref and invoice_ref are two namespaces, never conflated", () => {
  it("disagrees on at least 99% of the jobs carrying both", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*)                                  as both,
          count(*) filter (where job_ref <> invoice_ref) as differ
        from job
        where job_ref is not null and invoice_ref is not null`,
    );
    const both = num(rows[0]!.both);
    const differ = num(rows[0]!.differ);
    expect(both).toBeGreaterThan(1000);
    // 1,531 / 1,536 = 99.67%. Anything near zero would mean one column was
    // filled from the other — the exact conflation this schema exists to stop.
    expect(differ / both).toBeGreaterThanOrEqual(0.99);
  });

  it("keeps job_ref from the job record, not from the invoice", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as mismatched
        from job j
        join raw_record r on r.id = j.raw_record_id
        where j.job_ref is distinct from nullif(btrim(coalesce(r.payload ->> 'invoice_number', '')), '')`,
    );
    expect(num(rows[0]!.mismatched)).toBe(0);
  });

  it("keeps invoice_ref inside the invoice namespace", async () => {
    // Every invoice_ref on a job must be a real invoice number for THAT job.
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as foreign_refs
        from job j
        where j.invoice_ref is not null
          and not exists (
            select 1 from invoice i
            where i.job_id = j.id and i.invoice_ref = j.invoice_ref
          )`,
    );
    expect(num(rows[0]!.foreign_refs)).toBe(0);
  });
});

describe("is_canceled needs both source fields", () => {
  it("is true for all 225 jobs whose work_status says canceled", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*)                                as by_status,
          count(*) filter (where is_canceled)     as flagged
        from job
        where work_status ilike '%cancel%'`,
    );
    expect(num(rows[0]!.by_status)).toBe(225);
    expect(num(rows[0]!.flagged)).toBe(225);
  });

  it("catches the 67 'pro canceled' jobs that never set canceled_at", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as n
        from job
        where work_status = 'pro canceled' and canceled_at is null and is_canceled`,
    );
    expect(num(rows[0]!.n)).toBe(67);
  });

  it("catches the 7 jobs canceled after being marked complete", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as n
        from job
        where canceled_at is not null and work_status not ilike '%cancel%' and is_canceled`,
    );
    expect(num(rows[0]!.n)).toBe(7);
  });

  it("never flags a job that neither field calls canceled", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as n
        from job
        where is_canceled and canceled_at is null and work_status not ilike '%cancel%'`,
    );
    expect(num(rows[0]!.n)).toBe(0);
  });

  it("matches the README's dead value on nothing", async () => {
    const rows = await withTenant((sql) => sql`select count(*) as n from job where work_status = 'canceled'`);
    expect(num(rows[0]!.n)).toBe(0);
  });
});

describe("window_end is an arrival window, not a project end date", () => {
  it("is never more than 4 hours after scheduled_start", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*)                                                                as windows,
          count(*) filter (where window_end < scheduled_start)                    as backwards,
          count(*) filter (where window_end > scheduled_start + interval '4 hours') as over_cap,
          coalesce(max(extract(epoch from (window_end - scheduled_start)) / 60), 0) as max_minutes
        from job
        where window_end is not null`,
    );
    expect(num(rows[0]!.windows)).toBeGreaterThan(1000);
    expect(num(rows[0]!.backwards)).toBe(0);
    expect(num(rows[0]!.over_cap)).toBe(0);
    expect(num(rows[0]!.max_minutes)).toBeLessThanOrEqual(240);
  });

  it("is scheduled_start + arrival_window, capped — not scheduled_end", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as wrong
        from job
        where scheduled_start is not null and coalesce(arrival_window_min, 0) > 0
          and window_end is distinct from
              scheduled_start + make_interval(mins => least(arrival_window_min, 240))`,
    );
    expect(num(rows[0]!.wrong)).toBe(0);
  });

  it("ignores scheduled_end on the jobs where it spans more than a day", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*)                                                                    as multi_day,
          count(*) filter (
            where window_end is not null
              and window_end > scheduled_start + interval '4 hours'
          )                                                                           as leaked
        from job
        where scheduled_start is not null and scheduled_end is not null
          and scheduled_end > scheduled_start + interval '1 day'`,
    );
    // 329 jobs whose scheduled_end is a project end date, not an appointment.
    expect(num(rows[0]!.multi_day)).toBeGreaterThan(300);
    expect(num(rows[0]!.leaked)).toBe(0);

    const copied = await withTenant(
      (sql) => sql`
        select count(*) as n from job
        where window_end is not null and scheduled_end is not null
          and window_end = scheduled_end
          and scheduled_end > scheduled_start + interval '4 hours'`,
    );
    expect(num(copied[0]!.n)).toBe(0);
  });
});

describe("service_code canonicalises the price-book strings", () => {
  it("collapses 244 descriptions to a handful of bookable types", async () => {
    const rows = await withTenant(
      (sql) => sql`select service_code, count(*)::int as n from job group by 1 order by n desc`,
    );
    const codes = rows.map((r) => String(r.service_code));
    expect(codes.length).toBeLessThanOrEqual(8);
    expect(codes).toContain("unknown");
    expect(codes).toContain("standard_service");
    expect(codes).toContain("after_hours_service");
    expect(codes).toContain("pm_visit");
    expect(codes).toContain("install");
    expect(new Set(codes).size).toBe(codes.length);
    expect(rows.every((r) => r.service_code !== null)).toBe(true);
  });

  it("maps every blank description to unknown, and only those", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*) filter (where description is null)                          as blank,
          count(*) filter (where service_code = 'unknown')                     as unknown_code,
          count(*) filter (where service_code = 'unknown' and description is not null) as invented
        from job`,
    );
    expect(num(rows[0]!.blank)).toBe(294);
    expect(num(rows[0]!.unknown_code)).toBe(294);
    expect(num(rows[0]!.invented)).toBe(0);
  });

  it("keeps the raw description beside the code, `**` and all", async () => {
    const rows = await withTenant(
      (sql) => sql`select count(*) as n from job where description like '%**%'`,
    );
    expect(num(rows[0]!.n)).toBeGreaterThan(0);
  });

  it("does not split a service across codes because of a `**` prefix", async () => {
    // The `**` twins must land on the same service_code as their clean sibling.
    const rows = await withTenant(
      (sql) => sql`
        with normalized as (
          select lower(btrim(regexp_replace(replace(description, '*', ''), '\\s+', ' ', 'g'))) as norm,
                 service_code
          from job where description is not null
        )
        select count(*) as split from (
          select norm from normalized group by norm having count(distinct service_code) > 1
        ) t`,
    );
    expect(num(rows[0]!.split)).toBe(0);
  });
});

describe("derived_kind is behaviour, not the source label", () => {
  it("calls the four largest accounts property managers, though the source says homeowner", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select c.source_id, c.kind, c.derived_kind, count(j.id)::int as jobs
        from customer c
        join job j on j.customer_id = c.id
        group by c.id, c.source_id, c.kind, c.derived_kind
        order by jobs desc
        limit 4`,
    );
    expect(rows.map((r) => num(r.jobs))).toEqual([145, 101, 83, 59]);
    for (const r of rows) {
      expect(r.kind).toBe("homeowner");
      expect(r.derived_kind).toBe("property_manager");
    }
  });

  it("never leaves derived_kind unset", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) filter (where derived_kind is null) as unset,
               count(*) filter (where derived_kind not in ('homeowner', 'property_manager')) as strange
        from customer`,
    );
    expect(num(rows[0]!.unset)).toBe(0);
    expect(num(rows[0]!.strange)).toBe(0);
  });

  it("promotes every customer with a company, three addresses, or two repeat addresses", async () => {
    const rows = await withTenant(
      (sql) => sql`
        with served as (
          select customer_id, property_id, count(*) as visits
          from job where customer_id is not null and property_id is not null
          group by 1, 2
        ),
        behaviour as (
          select c.id,
                 c.company,
                 c.derived_kind,
                 count(s.property_id)                              as properties,
                 count(s.property_id) filter (where s.visits >= 2) as repeats
          from customer c left join served s on s.customer_id = c.id
          group by c.id, c.company, c.derived_kind
        )
        select
          count(*) filter (
            where derived_kind = 'homeowner'
              and (company is not null or properties >= 3 or repeats >= 2)
          ) as missed,
          count(*) filter (
            where derived_kind = 'property_manager'
              and company is null and properties < 3 and repeats < 2
          ) as invented
        from behaviour`,
    );
    expect(num(rows[0]!.missed)).toBe(0);
    expect(num(rows[0]!.invented)).toBe(0);
  });

  it("does not decide on name tokens — Hospitality alone is not a manager", async () => {
    // Every "<Word> Hospitality" in this export happens to be a manager, so a
    // name rule would score perfectly here and fail on the next export. The
    // guard is that at least one such name is decided by behaviour that would
    // hold without the token: it has a company, addresses, or repeat visits.
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as n
        from customer
        where derived_kind = 'property_manager'
          and company is null
          and coalesce(last_name, '') not ilike '%hospitality%'
          and coalesce(first_name, '') not ilike '%hospitality%'`,
    );
    expect(num(rows[0]!.n)).toBeGreaterThan(0);
  });
});

describe("property visit dates come from what happened, not from the calendar", () => {
  it("never puts a last visit in the future", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*) filter (where last_visit_at > ${EXPORT_ANCHOR}::timestamptz) as future,
          count(*) filter (where last_visit_at is not null)                     as visited
        from property`,
    );
    expect(num(rows[0]!.future)).toBe(0);
    expect(num(rows[0]!.visited)).toBeGreaterThan(0);
  });

  it("takes last_visit_at from max(completed_at), never from a scheduled date", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as wrong
        from property p
        where p.last_visit_at is distinct from (
          select max(j.completed_at) from job j where j.property_id = p.id
        )`,
    );
    expect(num(rows[0]!.wrong)).toBe(0);
  });

  it("puts every next visit strictly ahead of the anchor and never on a canceled job", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*) filter (where next_visit_at <= ${EXPORT_ANCHOR}::timestamptz) as past,
          count(*) filter (where next_visit_at is not null)                      as upcoming
        from property`,
    );
    expect(num(rows[0]!.past)).toBe(0);
    expect(num(rows[0]!.upcoming)).toBeGreaterThan(0);

    const canceled = await withTenant(
      (sql) => sql`
        select count(*) as wrong
        from property p
        where p.next_visit_at is distinct from (
          select min(j.scheduled_start) from job j
          where j.property_id = p.id
            and j.is_canceled = false
            and j.scheduled_start > ${EXPORT_ANCHOR}::timestamptz
        )`,
    );
    expect(num(canceled[0]!.wrong)).toBe(0);
  });

  it("counts only non-canceled jobs as visits", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as wrong
        from property p
        where p.visit_count is distinct from (
          select count(*)::int from job j where j.property_id = p.id and j.is_canceled = false
        )`,
    );
    expect(num(rows[0]!.wrong)).toBe(0);
  });
});

describe("balance_due excludes phantom debt", () => {
  it("excludes exactly 68 voided or canceled invoices that still carry a due amount", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*) filter (where is_voided and coalesce(due_amount_cents, 0) > 0) as excluded,
          coalesce(sum(due_amount_cents) filter (where is_voided and coalesce(due_amount_cents, 0) > 0), 0)
                                                                                  as phantom_cents,
          count(*) filter (where status in ('voided', 'canceled') and not is_voided) as unflagged
        from invoice`,
    );
    expect(num(rows[0]!.excluded)).toBe(68);
    expect(num(rows[0]!.phantom_cents)).toBe(26843384);
    expect(num(rows[0]!.unflagged)).toBe(0);
  });

  it("marks every voided and canceled invoice, and nothing else", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*) filter (where is_voided)                                             as flagged,
          count(*) filter (where is_voided and status not in ('voided', 'canceled'))     as overreach
        from invoice`,
    );
    expect(num(rows[0]!.flagged)).toBe(76); // 66 voided + 10 canceled
    expect(num(rows[0]!.overreach)).toBe(0);
  });

  it("differs from the naive sum by exactly the phantom debt", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          coalesce(sum(due_amount_cents) filter (where not is_voided), 0) as balance_due_cents,
          coalesce(sum(due_amount_cents), 0)                              as naive_cents
        from invoice`,
    );
    const balance = num(rows[0]!.balance_due_cents);
    const naive = num(rows[0]!.naive_cents);
    expect(naive - balance).toBe(26843384);
    expect(balance).toBeGreaterThan(0);
  });

  it("leaves no customer owing money purely on voided paper", async () => {
    const rows = await withTenant(
      (sql) => sql`
        with per_customer as (
          select
            j.customer_id,
            coalesce(sum(i.due_amount_cents) filter (where not i.is_voided), 0) as real_cents,
            coalesce(sum(i.due_amount_cents), 0)                                as naive_cents
          from invoice i join job j on j.id = i.job_id
          group by j.customer_id
        )
        select count(*) as wrongly_dunned
        from per_customer
        where naive_cents > 0 and real_cents = 0`,
    );
    // These are the customers a naive balance would chase for nothing.
    expect(num(rows[0]!.wrongly_dunned)).toBeGreaterThan(0);
  });
});

describe("timestamps read as America/New_York", () => {
  it("has no midnight cluster once rendered in the local zone", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*) filter (where extract(hour from scheduled_start at time zone 'UTC') = 0) as midnight_utc,
          count(*) filter (where extract(hour from scheduled_start at time zone ${TZ}) = 0)  as midnight_local,
          count(*) filter (where extract(hour from scheduled_start at time zone ${TZ}) between 0 and 5)
                                                                                            as overnight_local,
          count(*) filter (where scheduled_start is not null)                                as scheduled
        from job`,
    );
    const midnightUtc = num(rows[0]!.midnight_utc);
    const midnightLocal = num(rows[0]!.midnight_local);
    const overnight = num(rows[0]!.overnight_local);
    const scheduled = num(rows[0]!.scheduled);
    // 53 jobs sit at 00:00Z. Read raw they look like midnight starts; read in
    // New York they are 8pm the evening before.
    expect(midnightUtc).toBe(53);
    expect(midnightLocal).toBeLessThan(5);
    expect(overnight / scheduled).toBeLessThan(0.01);
  });

  it("keeps completed_at inside working hours once localised", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select
          count(*) filter (where extract(hour from completed_at at time zone ${TZ}) between 0 and 5) as overnight,
          count(*) filter (where completed_at is not null)                                           as completed
        from job`,
    );
    expect(num(rows[0]!.overnight) / num(rows[0]!.completed)).toBeLessThan(0.01);
  });

  it("stores instants, not wall-clock strings — the local reading is offset from UTC", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as unshifted
        from job
        where scheduled_start is not null
          and (scheduled_start at time zone ${TZ}) = (scheduled_start at time zone 'UTC')`,
    );
    expect(num(rows[0]!.unshifted)).toBe(0);
  });

  it("agrees with the raw export instant on every job", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as drifted
        from job j
        join raw_record r on r.id = j.raw_record_id
        where j.scheduled_start is distinct from
              nullif(r.payload -> 'schedule' ->> 'scheduled_start', '')::timestamptz
           or j.completed_at is distinct from
              nullif(r.payload -> 'work_timestamps' ->> 'completed_at', '')::timestamptz`,
    );
    expect(num(rows[0]!.drifted)).toBe(0);
  });
});

describe("money stays in integer cents", () => {
  it("never rounds a total", async () => {
    const rows = await withTenant(
      (sql) => sql`
        select count(*) as drifted
        from invoice i
        join raw_record r on r.id = i.raw_record_id
        where i.amount_cents     is distinct from nullif(r.payload ->> 'amount', '')::bigint
           or i.subtotal_cents   is distinct from nullif(r.payload ->> 'subtotal', '')::bigint
           or i.due_amount_cents is distinct from nullif(r.payload ->> 'due_amount', '')::bigint`,
    );
    expect(num(rows[0]!.drifted)).toBe(0);
  });
});
