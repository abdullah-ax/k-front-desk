-- ---------------------------------------------------------------------------
-- 09_property_rollup — job -> property.last_visit_at / next_visit_at / visit_count
-- (.claude/plans/front-desk.plan.md, Part B task 5)
--
-- "When were you last out here?" is the assignment's headline question, and the
-- source field that looks like the answer is the most dangerous field in the
-- export. `customer.last_job` is derived from scheduled_start for 709 customers
-- and from created_at for 23, and it is in the FUTURE for 26 of them
-- (eda/05-data-quality.md §5.6). It is not loaded anywhere in this pipeline.
--
--   last_visit_at  max(completed_at). A visit happened when a tech finished,
--                  not when someone typed a date into a calendar. Canceled jobs
--                  are not filtered out here because a canceled job has no
--                  completed_at — with one exception, the 7 jobs that carry a
--                  canceled_at while `complete*`; those were genuinely worked,
--                  so the visit is real even though is_canceled is true.
--   next_visit_at  min(scheduled_start) still ahead of NOW, canceled jobs
--                  excluded. Not the export anchor: the anchor is where the
--                  import stopped, and every visit booked between it and today
--                  has already happened. Reading one of those back as "next
--                  scheduled" promises a caller a date in their own past.
--   visit_count    non-canceled jobs.
--
-- The left join covers EVERY property, so a re-run after jobs change resets a
-- property that has lost its jobs back to NULL / 0 rather than leaving a stale
-- date on screen.
-- ---------------------------------------------------------------------------

update property p set
  last_visit_at = roll.last_visit_at,
  next_visit_at = roll.next_visit_at,
  visit_count   = roll.visit_count
from (
  select
    p2.id,
    max(j.completed_at)                                          as last_visit_at,
    min(j.scheduled_start) filter (
      where j.is_canceled = false
        and j.scheduled_start > now()
    )                                                            as next_visit_at,
    count(*) filter (where j.id is not null and j.is_canceled = false)::integer as visit_count
  from property p2
  left join job j on j.property_id = p2.id
  group by p2.id
) roll
where roll.id = p.id
  and (
    p.last_visit_at is distinct from roll.last_visit_at
    or p.next_visit_at is distinct from roll.next_visit_at
    or p.visit_count is distinct from roll.visit_count
  );
