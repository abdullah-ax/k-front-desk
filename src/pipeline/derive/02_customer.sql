-- ---------------------------------------------------------------------------
-- 02_customer — customers.jsonl -> customer
-- (.claude/plans/front-desk.plan.md, Part B task 5)
--
-- The source `kind` column is copied in for provenance ONLY. It mislabels
-- 31.6% of jobs (629/1,992) and files all four of the largest accounts —
-- 145, 101, 83 and 59 jobs, every one a property-management company — as
-- `homeowner` (eda/05-data-quality.md §7.4). `derived_kind` is what downstream
-- reads, and it is computed from behaviour in 10_customer_kind.sql, after the
-- jobs and properties it depends on exist.
--
-- Deliberately NOT loaded: `first_job` / `last_job`. `last_job` is a schedule or
-- creation date, not a visit, and is in the FUTURE for 26 customers
-- (eda/05-data-quality.md §5.6). There is no column for it and there must not
-- be; the real last visit is property.last_visit_at (09_property_rollup.sql).
--
-- Idempotent: upsert on (tenant_id, source_id). derived_kind is untouched here.
-- ---------------------------------------------------------------------------

insert into customer (
  tenant_id, source_id, raw_record_id, first_name, last_name, company, kind, tags
)
select
  r.tenant_id,
  r.payload ->> 'id',
  r.id,
  nullif(btrim(coalesce(r.payload ->> 'first_name', '')), ''),
  nullif(btrim(coalesce(r.payload ->> 'last_name', '')), ''),
  nullif(btrim(coalesce(r.payload ->> 'company', '')), ''),
  nullif(btrim(coalesce(r.payload ->> 'kind', '')), ''),
  coalesce(r.payload -> 'tags', '[]'::jsonb)
from raw_record r
where r.file = 'customers.jsonl'
  and r.payload ->> 'id' is not null
on conflict (tenant_id, source_id) do update set
  raw_record_id = excluded.raw_record_id,
  first_name    = excluded.first_name,
  last_name     = excluded.last_name,
  company       = excluded.company,
  kind          = excluded.kind,
  tags          = excluded.tags;
