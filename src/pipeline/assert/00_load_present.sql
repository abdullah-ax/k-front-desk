-- group: Load
-- title: raw_record holds every source line
--
-- Proves: all four JSONL files landed, at their exact expected row counts
-- (jobs 1,992 · invoices 1,700 · customers 732 · employees 23).
--
-- Why this runs first: every other assertion in this directory is written as
-- "return zero rows". An EMPTY raw_record satisfies all of them vacuously — a
-- load that never happened would look identical to a load that is perfect. This
-- file is the guard that makes the rest of the suite mean something. If it
-- fails, nothing below it can be trusted either way.
--
-- Measured: 1,992 / 1,700 / 732 / 23.

with expected (file, rows) as (
  values ('jobs.jsonl', 1992),
         ('invoices.jsonl', 1700),
         ('customers.jsonl', 732),
         ('employees.jsonl', 23)
),
actual as (
  select file, count(*)::int as n
  from raw_record
  group by file
)
select
  e.file,
  e.rows              as expected_rows,
  coalesce(a.n, 0)    as actual_rows,
  coalesce(a.n, 0) - e.rows as delta
from expected e
left join actual a using (file)
where coalesce(a.n, 0) <> e.rows
order by e.file;
