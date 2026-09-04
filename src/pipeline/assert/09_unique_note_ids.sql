-- group: Uniqueness
-- title: note ids are unique across all 6,954 notes
--
-- Proves: notes are globally distinct, not merely distinct within their parent
-- job. Prior analysis: 6,954/6,954 unique, zero duplicates.
--
-- Why a violation matters: notes are the corpus every extracted fact cites.
-- Task 9's integrity gate checks that each extracted snippet appears VERBATIM in
-- its source_note_id's text — that check is only meaningful if source_note_id
-- names one note. A duplicated note id makes provenance ambiguous, and a fact
-- can then "verify" against a note it did not come from, which is precisely the
-- failure the citation requirement exists to prevent.
--
-- Note that duplicate note CONTENT is expected and is NOT checked here: 335
-- rows repeat text elsewhere and 14 are exact repeats within one job. Identical
-- words are a real thing office staff do; identical ids are not.

with notes as (
  select r.line_no,
         r.payload ->> 'id' as job_id,
         t.ord              as position_in_array,
         t.n ->> 'id'       as note_id
  from raw_record r
  cross join lateral jsonb_array_elements(r.payload -> 'notes')
       with ordinality as t(n, ord)
  where r.file = 'jobs.jsonl'
)
select
  coalesce(note_id, '<null>')        as note_id,
  count(*)                           as occurrences,
  array_agg(job_id order by job_id)  as job_ids,
  array_agg(line_no order by line_no) as source_lines
from notes
group by note_id
having count(*) > 1 or note_id is null
order by note_id;
