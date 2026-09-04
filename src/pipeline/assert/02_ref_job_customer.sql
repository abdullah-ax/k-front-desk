-- group: Referential integrity
-- title: Every job.customer.id resolves to a customer
--
-- Proves: all 1,992 jobs name a customer that exists in customers.jsonl.
-- Prior analysis: 1,992/1,992 resolve, zero orphans.
--
-- Why a violation matters: the caller is identified by their customer record.
-- A job whose customer does not exist is a job the agent can never reach from
-- an inbound call, and — if the loader silently coerced the id — a job that
-- could be reached by the WRONG caller. Identity is the one thing a read-only
-- agent must never get wrong.

with customers as (
  select payload ->> 'id' as id
  from raw_record
  where file = 'customers.jsonl'
),
jobs as (
  select line_no,
         payload ->> 'id'                  as job_id,
         payload -> 'customer' ->> 'id'    as customer_id
  from raw_record
  where file = 'jobs.jsonl'
)
select
  j.line_no,
  j.job_id,
  coalesce(j.customer_id, '<null>') as unresolved_customer_id
from jobs j
left join customers c on c.id = j.customer_id
where c.id is null
order by j.line_no;
