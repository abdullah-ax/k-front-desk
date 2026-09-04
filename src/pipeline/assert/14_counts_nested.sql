-- group: Counts
-- title: Nested array cardinalities match the audited export
--
-- Proves the four counts that 00_load_present.sql cannot: the row counts there
-- prove every LINE arrived, these prove every element INSIDE those lines
-- arrived. Prior analysis, all cross-checked against the CSV projection:
--   notes                 6,954   (jobs[].notes[])
--   invoice items         4,390   (invoices[].items[])
--   customer addresses    1,390   (customers[].addresses[])
--   employee assignments  2,551   (jobs[].assigned_employees[])
--
-- Why a violation matters: a nested array is where a defensive loader loses
-- data without erroring — a truncated payload, a dropped element, a re-run that
-- double-inserts. None of it shows up in a row count and none of it shows up as
-- a null. It shows up here, and only here, before task 9 spends real money
-- extracting facts from a notes corpus that is quietly missing 30 notes.
--
-- These are also the denominators the later gates are measured against: task 9
-- must recover access codes on >=80% of 869 jobs, and a percentage computed
-- over the wrong denominator passes a gate it should have failed.

with actual as (
  select 'notes (jobs[].notes[])' as what, 6954::bigint as expected, (
    select coalesce(sum(jsonb_array_length(payload -> 'notes')), 0)
    from raw_record where file = 'jobs.jsonl'
  ) as actual
  union all
  select 'invoice items (invoices[].items[])', 4390::bigint, (
    select coalesce(sum(jsonb_array_length(payload -> 'items')), 0)
    from raw_record where file = 'invoices.jsonl'
  )
  union all
  select 'addresses (customers[].addresses[])', 1390::bigint, (
    select coalesce(sum(jsonb_array_length(payload -> 'addresses')), 0)
    from raw_record where file = 'customers.jsonl'
  )
  union all
  select 'assignments (jobs[].assigned_employees[])', 2551::bigint, (
    select coalesce(sum(jsonb_array_length(payload -> 'assigned_employees')), 0)
    from raw_record where file = 'jobs.jsonl'
  )
)
select what, expected, actual, actual - expected as delta
from actual
where actual <> expected
order by what;
