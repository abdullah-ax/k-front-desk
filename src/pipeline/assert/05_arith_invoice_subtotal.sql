-- group: Arithmetic
-- title: invoice.subtotal equals the sum of its items[].amount
--
-- Proves: the header total and the line items agree, exactly, in cents, on all
-- 1,700 invoices. Prior analysis: 1,700/1,700 exact, no rounding loss anywhere.
--
-- Money is stored in CENTS as integers, so "exact" means exact — there is no
-- tolerance band here and none is wanted. The 49 invoices with an empty items[]
-- are included: their sum is 0 and their subtotal must be 0 too.
--
-- Why a violation matters: this is the single cheapest proof that the loader
-- did not lose, duplicate or reorder an array element. jsonb arrays are the one
-- place a defensive parser can silently drop a row, and the arithmetic notices
-- immediately. Downstream, balance_due is built from these numbers and is read
-- aloud to a caller; an invoice that does not add up is a number we must not
-- say. Note this assertion checks subtotal, NOT `amount` — amount is net of
-- discounts (368 of them) and legitimately differs.

with invoices as (
  select line_no,
         payload ->> 'id'              as invoice_id,
         (payload ->> 'subtotal')::bigint as subtotal_cents,
         coalesce((
           select sum((it ->> 'amount')::bigint)
           from jsonb_array_elements(payload -> 'items') as it
         ), 0) as items_sum_cents,
         jsonb_array_length(payload -> 'items') as item_count
  from raw_record
  where file = 'invoices.jsonl'
)
select
  line_no,
  invoice_id,
  item_count,
  subtotal_cents,
  items_sum_cents,
  subtotal_cents - items_sum_cents as difference_cents
from invoices
where subtotal_cents <> items_sum_cents
order by line_no;
