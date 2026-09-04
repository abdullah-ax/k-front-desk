-- ---------------------------------------------------------------------------
-- 03_property — stg_address -> property
-- (.claude/plans/front-desk.plan.md, Part B tasks 5 and 6)
--
-- stg_address is built in run.ts, not here, because the canonical key comes from
-- src/domain/address.ts (canonicalizeAddress -> normalizeStreet / extractUnit /
-- normalizeUnit). That module is built and tested; address normalization is
-- never reimplemented in SQL. One row per source address id, plus one row for
-- each job address that carries no id (4 of them), in first-seen order.
--
-- One physical place is one row. The source has 1,390 address ids that collapse
-- to 1,330 canonical keys, so an address id is NOT a property identity —
-- canonical_key is. Every id that collapsed is kept in source_address_ids so a
-- raw record stays traceable.
--
-- Attributes are first-seen-non-null rather than arbitrary: city and ZIP
-- contradict each other across duplicate records (ZIP 33162 carries 7 different
-- city names) and neither is identity, so picking deterministically beats
-- picking cleverly.
--
-- Idempotent: upsert on (tenant_id, canonical_key). property.id stays stable, so
-- job.property_id and any extracted fact pointing at a property survive a re-run.
-- ---------------------------------------------------------------------------

insert into property (
  tenant_id, canonical_key, source_address_ids,
  street_raw, street_norm, unit, city, state, zip
)
select
  current_setting('app.tenant_id'),
  s.canonical_key,
  coalesce(
    array_agg(distinct s.address_source_id) filter (where s.address_source_id is not null),
    '{}'::text[]
  ),
  coalesce((array_agg(s.street_raw  order by s.ord) filter (where s.street_raw  is not null))[1], ''),
           (array_agg(s.street_norm order by s.ord) filter (where s.street_norm is not null))[1],
           (array_agg(s.unit        order by s.ord) filter (where s.unit        is not null))[1],
           (array_agg(s.city        order by s.ord) filter (where s.city        is not null))[1],
           (array_agg(s.state       order by s.ord) filter (where s.state       is not null))[1],
           (array_agg(s.zip         order by s.ord) filter (where s.zip         is not null))[1]
from stg_address s
group by s.canonical_key
on conflict (tenant_id, canonical_key) do update set
  source_address_ids = excluded.source_address_ids,
  street_raw         = excluded.street_raw,
  street_norm        = excluded.street_norm,
  unit               = excluded.unit,
  city               = excluded.city,
  state              = excluded.state,
  zip                = excluded.zip;
