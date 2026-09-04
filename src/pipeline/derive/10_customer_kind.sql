-- ---------------------------------------------------------------------------
-- 10_customer_kind — job + property -> customer.derived_kind
-- (.claude/plans/front-desk.plan.md, Part B task 5)
--
-- The source `kind` is wrong for a third of the business: 629 of 1,992 jobs are
-- filed as `homeowner` for a customer that is a management company, and all four
-- of the largest accounts — 145, 101, 83 and 59 jobs — are mislabelled
-- (eda/05-data-quality.md §7.4). Greeting a 145-job property manager as a
-- homeowner, or asking one "is this your residence?", loses the call in the
-- first sentence.
--
-- Derived from BEHAVIOUR, not from the name. Any one of:
--
--   1. a non-null `company`
--   2. >= 3 distinct service addresses
--   3. >= 2 addresses we have been to more than once
--
-- Name tokens are deliberately not used. Every management company in this
-- anonymized export is literally named "<Word> Hospitality", so a name-token
-- rule would score 100% here and 0% on the next export — it would be fitting the
-- pseudonymizer, not the business. Addresses and repeat visits are what actually
-- distinguish a manager from a homeowner, and they survive anonymization.
--
-- Distinct addresses are counted as distinct PROPERTIES (canonical keys), not as
-- distinct source address ids: 1,390 ids collapse to 1,330 places, and counting
-- ids would promote a homeowner whose one house is spelled three ways.
--
-- The source value stays in customer.kind for provenance. Nothing reads it.
-- ---------------------------------------------------------------------------

with served as (
  select j.customer_id, j.property_id, count(*) as visits
  from job j
  where j.customer_id is not null and j.property_id is not null
  group by j.customer_id, j.property_id
),
behaviour as (
  select
    c.id                                                      as customer_id,
    count(s.property_id)                                      as distinct_properties,
    count(s.property_id) filter (where s.visits >= 2)         as repeat_properties
  from customer c
  left join served s on s.customer_id = c.id
  group by c.id
)
update customer c set derived_kind = case
    when nullif(btrim(coalesce(c.company, '')), '') is not null then 'property_manager'
    when b.distinct_properties >= 3                            then 'property_manager'
    when b.repeat_properties >= 2                              then 'property_manager'
    else 'homeowner'
  end
from behaviour b
where b.customer_id = c.id
  and c.derived_kind is distinct from (case
    when nullif(btrim(coalesce(c.company, '')), '') is not null then 'property_manager'
    when b.distinct_properties >= 3                            then 'property_manager'
    when b.repeat_properties >= 2                              then 'property_manager'
    else 'homeowner'
  end);
