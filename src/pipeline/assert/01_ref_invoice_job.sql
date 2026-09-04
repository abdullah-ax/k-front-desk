-- group: Referential integrity
-- title: Every invoice.job_id resolves to a job
--
-- Proves: all 1,700 records in invoices.jsonl carry a job_id that exists as an
-- id in jobs.jsonl. Prior analysis: 1,700/1,700 resolve, zero orphans.
--
-- Why a violation matters: the invoice -> job edge is the only path from money
-- to work. An orphan invoice is a balance we can state on a call but cannot
-- attach to a property, a date or a technician — the agent would either drop
-- the charge or, worse, attach it to whatever job the loader happened to
-- adjoin. This edge is perfectly clean in the source, so a single orphan means
-- the loader mangled a payload, not that the export changed.

with jobs as (
  select payload ->> 'id' as id
  from raw_record
  where file = 'jobs.jsonl'
),
invoices as (
  select line_no,
         payload ->> 'id'     as invoice_id,
         payload ->> 'job_id' as job_id
  from raw_record
  where file = 'invoices.jsonl'
)
select
  i.line_no,
  i.invoice_id,
  coalesce(i.job_id, '<null>') as unresolved_job_id
from invoices i
left join jobs j on j.id = i.job_id
where j.id is null
order by i.line_no;
