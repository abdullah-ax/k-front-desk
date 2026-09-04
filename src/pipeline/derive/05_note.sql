-- ---------------------------------------------------------------------------
-- 05_note — jobs.jsonl notes[] -> note
-- (.claude/plans/front-desk.plan.md, Part B task 5)
--
-- 6,954 notes hang off 1,878 of the 1,992 jobs. `content` is stored VERBATIM and
-- must never be edited in place: the extraction integrity check (task 9) proves
-- every extracted snippet appears character-for-character in this column, and an
-- in-place edit would silently invalidate that proof. The anonymizer repair
-- (task 8) writes to content_scrubbed instead, which is why this file never
-- touches that column on conflict.
--
-- note_index is 1-based position within the job's notes array — the order the
-- office wrote them, which is the order a human reads them back.
--
-- Idempotent: upsert on (tenant_id, source_id).
-- ---------------------------------------------------------------------------

insert into note (tenant_id, source_id, raw_record_id, job_id, note_index, content)
select
  r.tenant_id,
  n.value ->> 'id',
  r.id,
  j.id,
  n.ordinality::integer,
  coalesce(n.value ->> 'content', '')
from raw_record r
cross join lateral jsonb_array_elements(coalesce(r.payload -> 'notes', '[]'::jsonb))
  with ordinality as n(value, ordinality)
left join job j
  on j.tenant_id = r.tenant_id and j.source_id = r.payload ->> 'id'
where r.file = 'jobs.jsonl'
  and n.value ->> 'id' is not null
on conflict (tenant_id, source_id) do update set
  raw_record_id = excluded.raw_record_id,
  job_id        = excluded.job_id,
  note_index    = excluded.note_index,
  content       = excluded.content;
