-- group: Uniqueness
-- title: id is unique within each of the four files
--
-- Proves: jobs 1,992 · invoices 1,700 · customers 732 · employees 23 distinct
-- ids, with no duplicates and no nulls. Prior analysis: zero duplicates
-- anywhere in the export.
--
-- Why a violation matters: these ids are the primary keys the core tables will
-- be built on in task 5. A duplicate id does not fail at load — it fails at
-- upsert, where the second row silently overwrites the first and one real job
-- disappears from history. A null id is worse: it joins to nothing and the
-- record becomes unreachable. Both are loader bugs (a re-run without a truncate,
-- a mis-parsed line), not export bugs, which is exactly what this gate exists to
-- catch before anything derives from the load.

with ids as (
  select file, line_no, payload ->> 'id' as id
  from raw_record
  where file in ('jobs.jsonl', 'invoices.jsonl', 'customers.jsonl', 'employees.jsonl')
)
select
  file,
  coalesce(id, '<null>')            as id,
  count(*)                          as occurrences,
  array_agg(line_no order by line_no) as source_lines
from ids
group by file, id
having count(*) > 1 or id is null
order by file, id;
