-- group: Referential integrity
-- title: Every assigned_employees[].id resolves to an employee
--
-- Proves: all 2,551 employee references embedded across jobs.jsonl point at one
-- of the 23 ids in employees.jsonl. Prior analysis: zero unknown references.
-- (95 jobs carry an EMPTY assigned_employees array — that is legitimate and is
-- not a violation. This asserts only that present references resolve.)
--
-- Why a violation matters: "who came out last time" is answered from this edge.
-- An unresolvable id means the agent either names nobody on a job that was
-- worked, or the loader flattened the array wrongly and it names the wrong
-- technician — a specific, checkable falsehood said out loud to a customer.

with employees as (
  select payload ->> 'id' as id
  from raw_record
  where file = 'employees.jsonl'
),
refs as (
  select r.line_no,
         r.payload ->> 'id' as job_id,
         t.ord              as position_in_array,
         t.e ->> 'id'       as employee_id,
         concat_ws(' ', t.e ->> 'first_name', t.e ->> 'last_name') as embedded_name
  from raw_record r
  cross join lateral jsonb_array_elements(r.payload -> 'assigned_employees')
       with ordinality as t(e, ord)
  where r.file = 'jobs.jsonl'
)
select
  refs.line_no,
  refs.job_id,
  refs.position_in_array,
  coalesce(refs.employee_id, '<null>') as unresolved_employee_id,
  refs.embedded_name
from refs
left join employees e on e.id = refs.employee_id
where e.id is null
order by refs.line_no, refs.position_in_array;
