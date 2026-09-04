-- group: Domain and shape
-- title: arrival_window is only ever 0, 60, 120 or 240
--
-- Proves: a closed four-value domain across all 1,992 jobs. Prior analysis:
-- {120 x1,874, 0 x102, 240 x8, 60 x8}, zero nulls, nothing else.
--
-- Why a violation matters: task 5 computes window_end as
-- scheduled_start + arrival_window, capped at four hours. That cap is set by
-- the largest legal value being 240. A fifth value — or a null, or a rescaled
-- unit such as seconds or hours — silently produces a window of the wrong
-- length, and the agent tells a caller to be home for a period that does not
-- match what dispatch believes. Locking the domain means a change in the
-- export's units halts the run instead of quietly shifting every promise we
-- make about arrival.
--
-- Compared as TEXT on purpose: '120.0' or '1.2e2' would be a real change in the
-- export's encoding, and a numeric cast would erase exactly that evidence.

select
  line_no,
  payload ->> 'id' as job_id,
  coalesce(payload -> 'schedule' ->> 'arrival_window', '<null>') as arrival_window,
  jsonb_typeof(payload -> 'schedule' -> 'arrival_window')        as json_type
from raw_record
where file = 'jobs.jsonl'
  and coalesce(payload -> 'schedule' ->> 'arrival_window', '<null>')
      not in ('0', '60', '120', '240')
order by line_no;
