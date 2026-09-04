-- group: Arithmetic
-- title: item.amount equals unit_price * qty_in_hundredths / 100
--
-- Proves: every one of the 4,390 line items is internally consistent. Prior
-- analysis: 4,390/4,390 exact.
--
-- Units, because two different scalings meet in this one expression:
--   unit_price        integer CENTS
--   qty_in_hundredths integer, quantity x 100 (100 = 1.0 units)
--   amount            integer CENTS
-- so amount = unit_price * qty_in_hundredths / 100.
--
-- The test is written as the CROSS-MULTIPLIED form
--
--     amount * 100 = unit_price * qty_in_hundredths
--
-- rather than dividing. Division by 100 in integer arithmetic truncates, which
-- would quietly accept an item that is off by up to 99 cents from a fractional
-- quantity, and would also hide whether the source rounds or truncates. The
-- cross-multiplied form has no rounding to argue about: it holds on all 4,390
-- rows today, so the exact relation is the real invariant and is what we lock
-- in. Both candidate expected values are emitted on a violation so the operator
-- can see instantly whether a genuine rounding case appeared or the loader
-- corrupted a number.
--
-- Why a violation matters: same reason as 05 — it is a checksum over the item
-- array, and these cents become a spoken balance.

with items as (
  select r.line_no,
         r.payload ->> 'id'                   as invoice_id,
         t.ord                                as position_in_array,
         t.it ->> 'id'                        as item_id,
         t.it ->> 'name'                      as item_name,
         (t.it ->> 'unit_price')::bigint      as unit_price_cents,
         (t.it ->> 'qty_in_hundredths')::bigint as qty_in_hundredths,
         (t.it ->> 'amount')::bigint          as amount_cents
  from raw_record r
  cross join lateral jsonb_array_elements(r.payload -> 'items')
       with ordinality as t(it, ord)
  where r.file = 'invoices.jsonl'
)
select
  line_no,
  invoice_id,
  item_id,
  left(item_name, 40) as item_name,
  unit_price_cents,
  qty_in_hundredths,
  amount_cents,
  (unit_price_cents * qty_in_hundredths) / 100                as expected_truncated,
  round((unit_price_cents * qty_in_hundredths)::numeric / 100, 4) as expected_exact
from items
where amount_cents * 100 <> unit_price_cents * qty_in_hundredths
order by line_no, position_in_array;
