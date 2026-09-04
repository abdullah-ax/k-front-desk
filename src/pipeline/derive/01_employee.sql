-- ---------------------------------------------------------------------------
-- 01_employee — employees.jsonl -> employee
-- (.claude/plans/front-desk.plan.md, Part B task 5)
--
-- The flattest file in the export: 23 rows, one key set, no nesting. `jobs` is
-- the source's own claim about how many jobs a tech worked; it is stored as
-- `job_count` and is NOT a count we made. The count we made comes from
-- job_employee (06). Nothing downstream should read job_count as truth.
--
-- Idempotent: upsert on (tenant_id, source_id). Re-running keeps employee.id
-- stable, which matters because job_employee and extracted_fact point at it.
-- ---------------------------------------------------------------------------

insert into employee (
  tenant_id, source_id, raw_record_id, first_name, last_name, role, job_count
)
select
  r.tenant_id,
  r.payload ->> 'id',
  r.id,
  nullif(btrim(coalesce(r.payload ->> 'first_name', '')), ''),
  nullif(btrim(coalesce(r.payload ->> 'last_name', '')), ''),
  nullif(btrim(coalesce(r.payload ->> 'role', '')), ''),
  nullif(r.payload ->> 'jobs', '')::integer
from raw_record r
where r.file = 'employees.jsonl'
  and r.payload ->> 'id' is not null
on conflict (tenant_id, source_id) do update set
  raw_record_id = excluded.raw_record_id,
  first_name    = excluded.first_name,
  last_name     = excluded.last_name,
  role          = excluded.role,
  job_count     = excluded.job_count;
