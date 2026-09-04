-- group: Uniqueness
-- title: jobs[].invoice_number is unique across all 1,992 jobs, with no nulls
--
-- Proves: the number staff and callers actually say out loud identifies exactly
-- one job. Prior analysis: 1,992 distinct values over 1,992 jobs, zero nulls.
--
-- Why a violation matters: this is the only human-speakable key in the dataset.
-- A caller says "I'm calling about 3695" and the agent must land on one job. If
-- the value were ever duplicated or null, the lookup returns two jobs or none
-- and the agent is guessing between two customers' records. Uniqueness is what
-- makes a confident single-record answer defensible at all.
--
-- Two shapes of violation are reported, so read the `problem` column:
--   'null or empty' — a job with no speakable reference
--   'duplicate'     — one number, several jobs
--
-- Note what this does NOT say: that this number can be looked up in
-- invoices.jsonl. It cannot. See 15_trap_invoice_number_collision.sql.

with jn as (
  select line_no,
         payload ->> 'id'             as job_id,
         payload ->> 'invoice_number' as invoice_number
  from raw_record
  where file = 'jobs.jsonl'
)
select
  'null or empty' as problem,
  '<null>'        as invoice_number,
  count(*)        as occurrences,
  array_agg(job_id order by job_id) as job_ids
from jn
where invoice_number is null or invoice_number = ''
having count(*) > 0

union all

select
  'duplicate',
  invoice_number,
  count(*),
  array_agg(job_id order by job_id)
from jn
where invoice_number is not null and invoice_number <> ''
group by invoice_number
having count(*) > 1

order by 1, 2;
