-- ---------------------------------------------------------------------------
-- 07_invoice — invoices.jsonl -> invoice
-- (.claude/plans/front-desk.plan.md, Part B task 5)
--
-- The one derived column here is `is_voided`, and it is the whole reason a
-- balance can be spoken out loud. 76 invoices are `voided` (66) or `canceled`
-- (10) — a vocabulary the invoice file shares with nothing else — and 68 of
-- them still carry a non-zero due_amount totalling $268,433.84
-- (eda/05-data-quality.md §8). Summing due_amount naively dunned 33 customers
-- who owe nothing.
--
--   THE CANONICAL BALANCE, and the only form any read model may use:
--
--     sum(invoice.due_amount_cents) filter (where not invoice.is_voided)
--
-- `invoice_tenant_open_balance_idx` (0001_core.sql) exists for exactly this
-- predicate. There is no `balance_due` column on purpose: a stored total goes
-- stale the moment a payment lands, and the partial index makes the live sum
-- cheap.
--
-- payment_total_cents counts SUCCEEDED payments only — 39 failed and 6 pending
-- payments exist, and neither is money the customer has paid.
-- discount_total_cents is the source's own signed value (discounts are stored
-- negative), summed, not re-signed.
--
-- Money: integer cents throughout, bigint. Never a float.
--
-- Idempotent: upsert on (tenant_id, source_id).
-- ---------------------------------------------------------------------------

insert into invoice (
  tenant_id, source_id, raw_record_id, job_id, job_source_id,
  invoice_ref, status, is_voided,
  amount_cents, subtotal_cents, due_amount_cents,
  discount_total_cents, payment_total_cents,
  paid_at, sent_at, service_date, invoice_date
)
select
  r.tenant_id,
  r.payload ->> 'id',
  r.id,
  j.id,
  r.payload ->> 'job_id',

  nullif(btrim(coalesce(r.payload ->> 'invoice_number', '')), ''),
  nullif(btrim(coalesce(r.payload ->> 'status', '')), ''),
  (r.payload ->> 'status') in ('voided', 'canceled'),

  nullif(r.payload ->> 'amount', '')::bigint,
  nullif(r.payload ->> 'subtotal', '')::bigint,
  nullif(r.payload ->> 'due_amount', '')::bigint,
  agg.discount_total_cents,
  agg.payment_total_cents,

  nullif(r.payload ->> 'paid_at', '')::timestamptz,
  nullif(r.payload ->> 'sent_at', '')::timestamptz,
  nullif(r.payload ->> 'service_date', '')::timestamptz,
  nullif(r.payload ->> 'invoice_date', '')::timestamptz
from raw_record r
cross join lateral (
  select
    (select coalesce(sum((d.value ->> 'amount')::bigint), 0)
       from jsonb_array_elements(coalesce(r.payload -> 'discounts', '[]'::jsonb)) d)
      as discount_total_cents,
    (select coalesce(sum((p.value ->> 'amount')::bigint), 0)
       from jsonb_array_elements(coalesce(r.payload -> 'payments', '[]'::jsonb)) p
      where p.value ->> 'status' = 'succeeded')
      as payment_total_cents
) agg
left join job j
  on j.tenant_id = r.tenant_id and j.source_id = r.payload ->> 'job_id'
where r.file = 'invoices.jsonl'
  and r.payload ->> 'id' is not null
on conflict (tenant_id, source_id) do update set
  raw_record_id        = excluded.raw_record_id,
  job_id               = excluded.job_id,
  job_source_id        = excluded.job_source_id,
  invoice_ref          = excluded.invoice_ref,
  status               = excluded.status,
  is_voided            = excluded.is_voided,
  amount_cents         = excluded.amount_cents,
  subtotal_cents       = excluded.subtotal_cents,
  due_amount_cents     = excluded.due_amount_cents,
  discount_total_cents = excluded.discount_total_cents,
  payment_total_cents  = excluded.payment_total_cents,
  paid_at              = excluded.paid_at,
  sent_at              = excluded.sent_at,
  service_date         = excluded.service_date,
  invoice_date         = excluded.invoice_date;
