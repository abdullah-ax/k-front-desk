-- group: Domain and shape
-- title: Every record in a file has an identical key set
--
-- Proves: this export has exactly ONE shape per file, and one shape per nested
-- object and array element within it. Prior analysis: jobs 1 key-set over
-- 1,992 records, invoices 1 over 1,700, customers 1 over 732, employees 1 over
-- 23; nested variants 0 across work_timestamps, schedule, customer, address,
-- assigned_employees[] (2,551), notes[] (6,954), items[] (4,390) and
-- addresses[] (1,390). Absence is always expressed as null, never as a missing
-- key.
--
-- Why a violation matters: every extractor, every derived column and every
-- typed table downstream was written against this one shape, and none of them
-- defend against a key that is not there — deliberately, because defending
-- against a key set that never varies is dead code that hides real drift. A new
-- key appearing means the source export CHANGED, and the correct response is a
-- human reading the diff, not a pipeline coping silently. A key disappearing is
-- worse: the field it fed becomes null everywhere and the agent starts saying
-- "I don't have that on file" about data the company still holds.
--
-- Scopes are reported as 'file' for the record itself and 'file:path' for a
-- nested object or array element. Each violating scope lists ALL of its key
-- sets with a record count and the first source line carrying each, so the
-- odd-one-out is visible immediately.

with shapes as (
  select r.file as scope, r.line_no, r.payload as obj
  from raw_record r

  union all
  select r.file || ':' || k.key, r.line_no, r.payload -> k.key
  from raw_record r
  cross join (values ('work_timestamps'), ('schedule'), ('customer'), ('address')) as k(key)
  where r.file = 'jobs.jsonl'
    and jsonb_typeof(r.payload -> k.key) = 'object'

  union all
  select r.file || ':assigned_employees[]', r.line_no, e
  from raw_record r
  cross join lateral jsonb_array_elements(r.payload -> 'assigned_employees') as e
  where r.file = 'jobs.jsonl'

  union all
  select r.file || ':notes[]', r.line_no, e
  from raw_record r
  cross join lateral jsonb_array_elements(r.payload -> 'notes') as e
  where r.file = 'jobs.jsonl'

  union all
  select r.file || ':items[]', r.line_no, e
  from raw_record r
  cross join lateral jsonb_array_elements(r.payload -> 'items') as e
  where r.file = 'invoices.jsonl'

  union all
  select r.file || ':addresses[]', r.line_no, e
  from raw_record r
  cross join lateral jsonb_array_elements(r.payload -> 'addresses') as e
  where r.file = 'customers.jsonl'
),
key_sets as (
  select scope,
         line_no,
         (select string_agg(k, ', ' order by k) from jsonb_object_keys(obj) as k) as key_set
  from shapes
),
tally as (
  select scope,
         coalesce(key_set, '<no keys>') as key_set,
         count(*)     as records,
         min(line_no) as first_source_line
  from key_sets
  group by 1, 2
)
select
  scope,
  records,
  first_source_line,
  left(key_set, 300) as key_set
from tally
where scope in (select scope from tally group by scope having count(*) > 1)
order by scope, records desc;
