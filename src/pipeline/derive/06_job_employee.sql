-- ---------------------------------------------------------------------------
-- 06_job_employee — jobs.jsonl assigned_employees[] -> job_employee
-- (.claude/plans/front-desk.plan.md, Part B task 5)
--
-- 2,551 assignments across 1,992 jobs, every employee id resolving to one of the
-- 23 employees (eda/05-data-quality.md §4.1: zero orphan references). The join
-- is INNER on both sides on purpose — an assignment we cannot resolve to a real
-- job and a real employee is dropped rather than invented, and the row-count
-- check in run.ts is what surfaces it.
--
-- Idempotent: the stale delete runs first so a re-run after a source change
-- cannot leave a tech attached to a job they were taken off.
-- ---------------------------------------------------------------------------

with assignment as (
  select
    r.tenant_id,
    r.payload ->> 'id'  as job_source_id,
    e.value ->> 'id'    as employee_source_id
  from raw_record r
  cross join lateral jsonb_array_elements(coalesce(r.payload -> 'assigned_employees', '[]'::jsonb)) e
  where r.file = 'jobs.jsonl'
    and e.value ->> 'id' is not null
),
resolved as (
  select a.tenant_id, j.id as job_id, emp.id as employee_id
  from assignment a
  join job j        on j.tenant_id = a.tenant_id   and j.source_id = a.job_source_id
  join employee emp on emp.tenant_id = a.tenant_id and emp.source_id = a.employee_source_id
),
deleted as (
  delete from job_employee je
  where not exists (
    select 1 from resolved x
    where x.tenant_id = je.tenant_id and x.job_id = je.job_id and x.employee_id = je.employee_id
  )
  returning 1
)
insert into job_employee (tenant_id, job_id, employee_id)
select distinct tenant_id, job_id, employee_id from resolved
on conflict (tenant_id, job_id, employee_id) do nothing;
