-- group: Domain and shape
-- title: Every job's schedule.time_zone is America/New_York
--
-- Proves: the timezone field is a constant across all 1,992 jobs. Prior
-- analysis: 1 distinct value, zero anomalies, zero nulls.
--
-- Why a violation matters: because it is constant, task 5 converts every
-- timestamp to America/New_York once, at the ingest boundary, and nothing
-- downstream carries a timezone (src/config.ts TZ). That simplification is only
-- safe while this holds. Every timestamp in the export is a Z-suffixed UTC
-- instant; rendering one raw is off by four or five hours, so a second timezone
-- appearing would mean some jobs are converted with the wrong rule and the
-- agent states appointment times that are hours wrong — for the wrong subset of
-- jobs, invisibly.
--
-- A null is a violation too: a missing rule is not the same as the default rule.

select
  line_no,
  payload ->> 'id'                                   as job_id,
  coalesce(payload -> 'schedule' ->> 'time_zone', '<null>') as time_zone,
  payload -> 'schedule' ->> 'scheduled_start'        as scheduled_start
from raw_record
where file = 'jobs.jsonl'
  and coalesce(payload -> 'schedule' ->> 'time_zone', '<null>') <> 'America/New_York'
order by line_no;
