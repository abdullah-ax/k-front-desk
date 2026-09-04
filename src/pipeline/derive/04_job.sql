-- ---------------------------------------------------------------------------
-- 04_job — jobs.jsonl -> job, with the five derived columns
-- (.claude/plans/front-desk.plan.md, Part B task 5)
--
-- This file is where the source's four worst fields stop being readable. Each
-- derivation below fixes a defect measured in eda/05-data-quality.md; the
-- original value is still stored beside it for provenance, and nothing
-- downstream may read the original.
--
--   job_ref / invoice_ref  §4.2  The source calls two different numbering
--                                systems `invoice_number`. They disagree on
--                                1,695/1,700 invoices (99.7%), and a spoken
--                                number is a valid id in BOTH namespaces
--                                pointing at DIFFERENT jobs on 1,682/1,992
--                                jobs. They are kept apart and NEVER compared:
--                                `job_ref = invoice_ref` is always a bug.
--   is_canceled            §5.2  work_status OR canceled_at, because neither
--                                alone is sufficient: `pro canceled` (67 jobs)
--                                never sets canceled_at, and 7 jobs carry a
--                                canceled_at while `complete*`. The README's
--                                documented value `canceled` matches 0 rows.
--   window_end             §5.5  scheduled_start + arrival_window, capped at
--                                4h. NOT scheduled_end: that is a project end
--                                date — 334 jobs exceed a day, 175 exceed a
--                                week, the worst is 134 days. Reading it aloud
--                                promises "your tech arrives between March and
--                                July".
--   service_code           §6.3  Canonical bookable service. `description` has
--                                244 distinct values that are price-book lines,
--                                not service types, 294 of them blank, and a
--                                systematic `**` prefix that splits the two
--                                highest-volume repair lines in half. The raw
--                                string stays in `description` for display.
--
-- Timestamps: every source value is an unambiguous instant (trailing `Z`), cast
-- straight to timestamptz. Rendering is America/New_York (src/config.ts TZ) and
-- is set by the session, never by rewriting the instant — 53 jobs sit at
-- 00:00Z, which is 20:00 the previous evening in New York, and would read as
-- midnight starts to anyone who prints the raw string.
--
-- Money: the source is integer CENTS. Stored as bigint, exactly as given. No
-- float ever touches a number we read to a customer.
--
-- Idempotent: upsert on (tenant_id, source_id).
-- ---------------------------------------------------------------------------

with inv as (
  -- Read from raw, not from the invoice table, so this file does not depend on
  -- 07 having run: invoice.job_id points back at job, and one direction of that
  -- cycle has to be resolved from the landing zone.
  select
    r.payload ->> 'job_id'                                   as job_source_id,
    nullif(btrim(coalesce(r.payload ->> 'invoice_number', '')), '') as invoice_ref,
    (r.payload ->> 'status') in ('voided', 'canceled')       as is_voided,
    nullif(r.payload ->> 'invoice_date', '')::timestamptz    as invoice_date
  from raw_record r
  where r.file = 'invoices.jsonl'
),
invoice_ref_for_job as (
  -- 135 jobs carry more than one invoice (the pattern is void-and-reissue).
  -- The one worth speaking is the live one: non-voided first, then most recent.
  select distinct on (i.job_source_id) i.job_source_id, i.invoice_ref
  from inv i
  where i.job_source_id is not null
  order by i.job_source_id, i.is_voided asc, i.invoice_date desc nulls last, i.invoice_ref desc
)
insert into job (
  tenant_id, source_id, raw_record_id, customer_id, property_id,
  customer_source_id, address_source_id,
  description, work_status, lead_source,
  on_my_way_at, started_at, completed_at,
  scheduled_start, scheduled_end, time_zone, arrival_window_min,
  tags, total_amount_cents, outstanding_balance_cents,
  created_at, updated_at, canceled_at,
  job_ref, invoice_ref, is_canceled, window_end, service_code
)
select
  r.tenant_id,
  r.payload ->> 'id',
  r.id,
  c.id,
  p.id,
  r.payload -> 'customer' ->> 'id',
  r.payload -> 'address' ->> 'id',

  nullif(btrim(coalesce(r.payload ->> 'description', '')), ''),
  nullif(btrim(coalesce(r.payload ->> 'work_status', '')), ''),
  nullif(btrim(coalesce(r.payload ->> 'lead_source', '')), ''),

  nullif(r.payload -> 'work_timestamps' ->> 'on_my_way_at', '')::timestamptz,
  nullif(r.payload -> 'work_timestamps' ->> 'started_at', '')::timestamptz,
  nullif(r.payload -> 'work_timestamps' ->> 'completed_at', '')::timestamptz,

  s.scheduled_start,
  nullif(r.payload -> 'schedule' ->> 'scheduled_end', '')::timestamptz,
  nullif(btrim(coalesce(r.payload -> 'schedule' ->> 'time_zone', '')), ''),
  s.arrival_window,

  coalesce(r.payload -> 'tags', '[]'::jsonb),
  nullif(r.payload ->> 'total_amount', '')::bigint,
  nullif(r.payload ->> 'outstanding_balance', '')::bigint,

  nullif(r.payload ->> 'created_at', '')::timestamptz,
  nullif(r.payload ->> 'updated_at', '')::timestamptz,
  nullif(r.payload ->> 'canceled_at', '')::timestamptz,

  -- job_ref: the number on the JOB record. Its own namespace.
  nullif(btrim(coalesce(r.payload ->> 'invoice_number', '')), ''),
  -- invoice_ref: the number on the INVOICE for this job. A different namespace.
  ir.invoice_ref,

  -- is_canceled: either signal is enough, neither alone is sufficient.
  (
    coalesce(r.payload ->> 'work_status', '') ilike '%cancel%'
    or nullif(r.payload ->> 'canceled_at', '') is not null
  ),

  -- window_end: the appointment window we can actually promise. NULL when the
  -- source gives no window (arrival_window 0 on 102 jobs) — "unknown" is
  -- honest, a zero-length window would read as "arrives at exactly 10:00".
  case
    when s.scheduled_start is null then null
    when coalesce(s.arrival_window, 0) <= 0 then null
    else s.scheduled_start + make_interval(mins => least(s.arrival_window, 240))
  end,

  -- service_code: roll 243 normalized description strings up to the six things
  -- the office actually books, plus `unknown` for the 294 blanks. Order matters:
  -- warranty language wins over the fee line it sits on, plumbing wins over the
  -- word "install", and everything unclassified lands on standard service
  -- rather than being invented.
  case
    when d.norm = '' then 'unknown'
    when d.norm ~ '(warranty|callback|call back)' then 'warranty_callback'
    when d.norm ~ 'after[ -]hours' then 'after_hours_service'
    when d.norm ~ '(preventative maintenance|preventive maintenance|\yresidential pm\y|inspection report|hvac inspection)'
      then 'pm_visit'
    when d.norm ~ ('(plumbing|toilet|faucet|water heater|tankless|rinnai|hose bibb|\ytub\y|tub spout|shower|lavatory|\ysink\y|disposal|'
                || 'basket strainer|angle stop|fill valve|washer box|branchline|mainline drain|\ypex\y|cpvc|flange|icemaker|'
                || 'expansion tank|pressure reducing valve|gas system|drain repair|tubular|\ygallon\y|moen|pfister|\ydelta\y|'
                || 'baxter valve|water only)')
      then 'plumbing'
    when d.norm ~ '(system installation|new construction|zone system|dehumidifier installation|air handler installation|duct installation)'
      then 'install'
    else 'standard_service'
  end
from raw_record r
cross join lateral (
  select
    nullif(r.payload -> 'schedule' ->> 'scheduled_start', '')::timestamptz as scheduled_start,
    nullif(r.payload -> 'schedule' ->> 'arrival_window', '')::integer      as arrival_window
) s
cross join lateral (
  -- The normalization the price book needs: strip the `**` marker wherever it
  -- appears, collapse whitespace, case-fold. 244 raw values -> 243 normalized.
  select lower(btrim(regexp_replace(
           replace(coalesce(r.payload ->> 'description', ''), '*', ''), '\s+', ' ', 'g'))) as norm
) d
left join customer c
  on c.tenant_id = r.tenant_id and c.source_id = r.payload -> 'customer' ->> 'id'
left join stg_job_address ja
  on ja.job_source_id = r.payload ->> 'id'
left join property p
  on p.tenant_id = r.tenant_id and p.canonical_key = ja.canonical_key
left join invoice_ref_for_job ir
  on ir.job_source_id = r.payload ->> 'id'
where r.file = 'jobs.jsonl'
  and r.payload ->> 'id' is not null
on conflict (tenant_id, source_id) do update set
  raw_record_id             = excluded.raw_record_id,
  customer_id               = excluded.customer_id,
  property_id               = excluded.property_id,
  customer_source_id        = excluded.customer_source_id,
  address_source_id         = excluded.address_source_id,
  description               = excluded.description,
  work_status               = excluded.work_status,
  lead_source               = excluded.lead_source,
  on_my_way_at              = excluded.on_my_way_at,
  started_at                = excluded.started_at,
  completed_at              = excluded.completed_at,
  scheduled_start           = excluded.scheduled_start,
  scheduled_end             = excluded.scheduled_end,
  time_zone                 = excluded.time_zone,
  arrival_window_min        = excluded.arrival_window_min,
  tags                      = excluded.tags,
  total_amount_cents        = excluded.total_amount_cents,
  outstanding_balance_cents = excluded.outstanding_balance_cents,
  created_at                = excluded.created_at,
  updated_at                = excluded.updated_at,
  canceled_at               = excluded.canceled_at,
  job_ref                   = excluded.job_ref,
  invoice_ref               = excluded.invoice_ref,
  is_canceled               = excluded.is_canceled,
  window_end                = excluded.window_end,
  service_code              = excluded.service_code;
