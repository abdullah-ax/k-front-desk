-- ---------------------------------------------------------------------------
-- 08_invoice_item — invoices.jsonl items[] -> invoice_item
-- (.claude/plans/front-desk.plan.md, Part B task 5)
--
-- 4,390 lines across 1,700 invoices (49 invoices have none). `name` is stored
-- verbatim — including the `**` prefix that splits 21 item names from their
-- twin, and the 2 empty names — because this table is the paper bill. The
-- canonicalization that fixes the price book lives on the job
-- (job.service_code, 04_job.sql); doing it here would rewrite what the customer
-- was actually sent.
--
-- unit_price, amount: integer cents. qty_in_hundredths: the source's own
-- fixed-point quantity (100 = 1). amount = unit_price * qty / 100 holds on all
-- 4,390 rows and is checked by the assertion layer, not restated here.
--
-- Idempotent: upsert on (tenant_id, source_id).
-- ---------------------------------------------------------------------------

insert into invoice_item (
  tenant_id, source_id, invoice_id, line_no, name, item_type,
  unit_price_cents, qty_in_hundredths, amount_cents
)
select
  r.tenant_id,
  it.value ->> 'id',
  i.id,
  it.ordinality::integer,
  it.value ->> 'name',
  nullif(btrim(coalesce(it.value ->> 'type', '')), ''),
  nullif(it.value ->> 'unit_price', '')::bigint,
  nullif(it.value ->> 'qty_in_hundredths', '')::integer,
  nullif(it.value ->> 'amount', '')::bigint
from raw_record r
cross join lateral jsonb_array_elements(coalesce(r.payload -> 'items', '[]'::jsonb))
  with ordinality as it(value, ordinality)
join invoice i
  on i.tenant_id = r.tenant_id and i.source_id = r.payload ->> 'id'
where r.file = 'invoices.jsonl'
  and it.value ->> 'id' is not null
on conflict (tenant_id, source_id) do update set
  invoice_id        = excluded.invoice_id,
  line_no           = excluded.line_no,
  name              = excluded.name,
  item_type         = excluded.item_type,
  unit_price_cents  = excluded.unit_price_cents,
  qty_in_hundredths = excluded.qty_in_hundredths,
  amount_cents      = excluded.amount_cents;
