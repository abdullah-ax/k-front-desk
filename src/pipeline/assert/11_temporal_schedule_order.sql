-- group: Domain and shape
-- title: No job ends before it starts
--
-- Proves: scheduled_end >= scheduled_start on every job that has both. Prior
-- analysis: 0 violations of 1,898 jobs carrying a schedule (94 jobs have
-- neither, which is legitimate — they are 'needs scheduling').
--
-- Why a violation matters: the appointment window is arithmetic on this pair.
-- An inverted pair yields a negative duration, which propagates into a window
-- readout as nonsense ("between 3pm and 1pm") and into any duration average as
-- a silent negative that drags the mean below the truth.
--
-- What this deliberately does NOT assert: that the window is SENSIBLE. It is
-- often not — 334 jobs have a scheduled span longer than a day and 175 longer
-- than a week (the extreme is 134 days), because scheduled_end on installation
-- jobs is a project end date, not an appointment end. That is a semantic defect
-- for task 5 to handle by capping window_end at arrival_window; it is not a
-- load defect, so it must not halt this gate. Ordering is the load-level
-- invariant; plausibility is not.

with s as (
  select line_no,
         payload ->> 'id' as job_id,
         payload ->> 'work_status' as work_status,
         (payload -> 'schedule' ->> 'scheduled_start')::timestamptz as scheduled_start,
         (payload -> 'schedule' ->> 'scheduled_end')::timestamptz   as scheduled_end
  from raw_record
  where file = 'jobs.jsonl'
)
select
  line_no,
  job_id,
  work_status,
  scheduled_start,
  scheduled_end,
  scheduled_end - scheduled_start as negative_span
from s
where scheduled_start is not null
  and scheduled_end is not null
  and scheduled_end < scheduled_start
order by line_no;
