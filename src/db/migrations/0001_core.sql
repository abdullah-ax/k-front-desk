-- ---------------------------------------------------------------------------
-- 0001_core — core schema for Front Desk milestone 1
-- (.claude/plans/front-desk.plan.md, Part B task 1).
--
-- Hand-written, not drizzle-kit generated: drizzle-kit does not emit RLS, and
-- RLS is the one thing in here that cannot be added later "when we get to it".
-- The Drizzle definitions in src/db/schema/ mirror this file for typed queries;
-- THIS FILE IS THE SOURCE OF TRUTH.
--
-- Applied by scripts/migrate.ts inside a single transaction. Re-running is a
-- no-op because the ledger row already exists; it is not idempotent DDL and is
-- not meant to be.
--
-- Steps, each independently readable:
--   1. Extensions
--   2. Raw landing               raw_record
--   3. Parties                   employee, customer, property
--   4. Work                      job, note, job_employee
--   5. Billing                   invoice, invoice_item
--   6. Derived knowledge         extracted_fact
--   7. Operations                pipeline_run
--   8. Tenant isolation          RLS on every table above, no exceptions
-- ---------------------------------------------------------------------------

set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Extensions
--    Already installed by setup step A4; restated so this file stands alone.
-- ---------------------------------------------------------------------------

create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists fuzzystrmatch;

-- ---------------------------------------------------------------------------
-- 2. Raw landing
--
--    Every source line lands here verbatim before anything interprets it, so a
--    derivation bug is always re-runnable from inside the database rather than
--    from the files. Immutable by convention: the pipeline inserts, nothing
--    updates.
-- ---------------------------------------------------------------------------

create table raw_record (
  id         bigint generated always as identity primary key,
  tenant_id  text        not null,
  file       text        not null,
  line_no    integer     not null,
  payload    jsonb       not null,
  loaded_at  timestamptz not null default now(),
  constraint raw_record_line_no_positive check (line_no > 0)
);

create unique index raw_record_tenant_file_line_key on raw_record (tenant_id, file, line_no);
create index raw_record_tenant_file_idx on raw_record (tenant_id, file);
create index raw_record_payload_gin on raw_record using gin (payload jsonb_path_ops);

comment on table raw_record is
  'Immutable landing zone. One row per JSONL line, untransformed.';

-- ---------------------------------------------------------------------------
-- 3. Parties
-- ---------------------------------------------------------------------------

create table employee (
  id             bigint generated always as identity primary key,
  tenant_id      text        not null,
  source_id      text        not null,   -- pro_9ff5524f...
  raw_record_id  bigint      references raw_record (id),
  first_name     text,
  last_name      text,
  role           text,
  job_count      integer,                -- source `jobs`; a claim, not a count we made
  ingested_at    timestamptz not null default now()
);

create unique index employee_tenant_source_key on employee (tenant_id, source_id);
create index employee_raw_record_id_idx on employee (raw_record_id);
create index employee_last_name_trgm on employee using gin (last_name gin_trgm_ops);

create table customer (
  id             bigint generated always as identity primary key,
  tenant_id      text        not null,
  source_id      text        not null,   -- cus_3fa02a2e...
  raw_record_id  bigint      references raw_record (id),
  first_name     text,
  last_name      text,
  company        text,
  kind           text,                   -- source value, kept for provenance only
  derived_kind   text,                   -- what we concluded; downstream reads THIS
  tags           jsonb       not null default '[]'::jsonb,
  ingested_at    timestamptz not null default now()
);

create unique index customer_tenant_source_key on customer (tenant_id, source_id);
create index customer_raw_record_id_idx on customer (raw_record_id);
create index customer_tenant_derived_kind_idx on customer (tenant_id, derived_kind);
create index customer_last_name_trgm on customer using gin (last_name gin_trgm_ops);
create index customer_company_trgm on customer using gin (company gin_trgm_ops);
create index customer_tags_gin on customer using gin (tags jsonb_path_ops);

comment on column customer.derived_kind is
  'Derived customer kind. The source `kind` column is unreliable; nothing downstream reads it.';

-- One property is one physical place. The source has 263 duplicate address
-- records and 48 addresses spelled two or more ways, so an address id is NOT a
-- property identity — canonical_key is. Every address id that collapsed into a
-- property is kept in source_address_ids so a raw record can still be traced.
create table property (
  id                 bigint generated always as identity primary key,
  tenant_id          text        not null,
  canonical_key      text        not null,   -- (normalized_street, unit, zip)
  source_address_ids text[]      not null default '{}'::text[],
  street_raw         text        not null,   -- as first seen; fuzzy matching target
  street_norm        text,                   -- suffix/directional expanded
  unit               text,
  city               text,
  state              text,
  zip                text,
  last_visit_at      timestamptz,            -- max(job.completed_at)
  next_visit_at      timestamptz,            -- min(future job.scheduled_start)
  visit_count        integer     not null default 0,
  ingested_at        timestamptz not null default now(),
  constraint property_visit_count_nonneg check (visit_count >= 0)
);

create unique index property_tenant_canonical_key on property (tenant_id, canonical_key);
create index property_street_raw_trgm on property using gin (street_raw gin_trgm_ops);
create index property_street_norm_trgm on property using gin (street_norm gin_trgm_ops);
create index property_source_address_ids_gin on property using gin (source_address_ids);
create index property_tenant_zip_idx on property (tenant_id, zip);
create index property_tenant_last_visit_idx on property (tenant_id, last_visit_at desc);

comment on table property is
  'Physical service locations. Deliberately has NO latitude, longitude or '
  'geography column: 87.6% of the source coordinates plot in the Atlantic '
  'Ocean and are unusable. Their absence is enforced by scripts/check-rls.ts.';

-- ---------------------------------------------------------------------------
-- 4. Work
-- ---------------------------------------------------------------------------

create table job (
  id                   bigint generated always as identity primary key,
  tenant_id            text        not null,
  source_id            text        not null,   -- job_dd4866de...
  raw_record_id        bigint      references raw_record (id),
  customer_id          bigint      references customer (id),
  property_id          bigint      references property (id),
  customer_source_id   text,                   -- link target before customer rows exist
  address_source_id    text,                   -- link target before property rows exist

  description          text,
  work_status          text,
  lead_source          text,

  on_my_way_at         timestamptz,
  started_at           timestamptz,
  completed_at         timestamptz,
  scheduled_start      timestamptz,
  scheduled_end        timestamptz,
  time_zone            text,
  arrival_window_min   integer,

  tags                 jsonb       not null default '[]'::jsonb,

  total_amount_cents        bigint,
  outstanding_balance_cents bigint,

  created_at           timestamptz,            -- source created_at
  updated_at           timestamptz,            -- source updated_at
  canceled_at          timestamptz,
  ingested_at          timestamptz not null default now(),

  -- Derived. These fix broken source fields; nothing downstream reads originals.
  job_ref              text,
  invoice_ref          text,
  is_canceled          boolean     not null default false,
  window_end           timestamptz,
  service_code         text
);

create unique index job_tenant_source_key on job (tenant_id, source_id);
create index job_raw_record_id_idx on job (raw_record_id);
create index job_customer_id_idx on job (customer_id);
create index job_property_id_idx on job (property_id);
create index job_tenant_customer_source_idx on job (tenant_id, customer_source_id);
create index job_tenant_address_source_idx on job (tenant_id, address_source_id);
create index job_tenant_job_ref_idx on job (tenant_id, job_ref);
create index job_tenant_invoice_ref_idx on job (tenant_id, invoice_ref);
create index job_tenant_service_code_idx on job (tenant_id, service_code);
create index job_tenant_scheduled_start_idx on job (tenant_id, scheduled_start desc);
create index job_tenant_completed_at_idx on job (tenant_id, completed_at desc);
create index job_property_completed_idx on job (property_id, completed_at desc);

comment on column job.job_ref is
  'The number on the JOB record. The source calls this "invoice_number" and it '
  'disagrees with the invoice''s own number on 99.2% of jobs. Kept separate '
  'from invoice_ref on purpose: comparing the two is always a bug.';
comment on column job.invoice_ref is
  'The number on the INVOICE for this job. See job_ref — never compare the two.';
comment on column job.window_end is
  'scheduled_start + arrival_window, capped at 4h. Derived; the source has no such field.';

create table note (
  id               bigint generated always as identity primary key,
  tenant_id        text        not null,
  source_id        text        not null,   -- nte_2c65b859...
  raw_record_id    bigint      references raw_record (id),
  job_id           bigint      references job (id),
  note_index       integer,                -- position within the job's notes array
  content          text        not null,   -- verbatim source text
  content_scrubbed text,                   -- anonymizer artifacts removed; extractors read THIS
  search_tsv       tsvector generated always as (
                     to_tsvector('english', coalesce(content_scrubbed, content, ''))
                   ) stored,
  embedding        vector(1536),           -- populated by a later pass; nullable by design
  ingested_at      timestamptz not null default now()
);

create unique index note_tenant_source_key on note (tenant_id, source_id);
create index note_raw_record_id_idx on note (raw_record_id);
create index note_job_id_idx on note (job_id);
create index note_search_tsv_gin on note using gin (search_tsv);
create index note_embedding_hnsw on note using hnsw (embedding vector_cosine_ops);

comment on column note.content is
  'Verbatim source text. Extraction snippets are checked against this column, '
  'so it must never be edited in place.';

create table job_employee (
  id           bigint generated always as identity primary key,
  tenant_id    text        not null,
  job_id       bigint      not null references job (id),
  employee_id  bigint      not null references employee (id),
  ingested_at  timestamptz not null default now()
);

create unique index job_employee_tenant_job_employee_key
  on job_employee (tenant_id, job_id, employee_id);
create index job_employee_job_id_idx on job_employee (job_id);
create index job_employee_employee_id_idx on job_employee (employee_id);

-- ---------------------------------------------------------------------------
-- 5. Billing
--    Money is integer cents in the source. Stored as bigint: exact, matches the
--    source byte for byte, and no float ever touches a balance we read aloud.
-- ---------------------------------------------------------------------------

create table invoice (
  id                    bigint generated always as identity primary key,
  tenant_id             text        not null,
  source_id             text        not null,   -- invoice_7072f181...
  raw_record_id         bigint      references raw_record (id),
  job_id                bigint      references job (id),
  job_source_id         text,                   -- link target before job rows exist

  invoice_ref           text,                   -- source invoice_number
  status                text,
  is_voided             boolean     not null default false,  -- derived from status

  amount_cents          bigint,
  subtotal_cents        bigint,
  due_amount_cents      bigint,
  discount_total_cents  bigint,
  payment_total_cents   bigint,

  paid_at               timestamptz,
  sent_at               timestamptz,
  service_date          timestamptz,
  invoice_date          timestamptz,
  ingested_at           timestamptz not null default now()
);

create unique index invoice_tenant_source_key on invoice (tenant_id, source_id);
create index invoice_raw_record_id_idx on invoice (raw_record_id);
create index invoice_job_id_idx on invoice (job_id);
create index invoice_tenant_job_source_idx on invoice (tenant_id, job_source_id);
create index invoice_tenant_invoice_ref_idx on invoice (tenant_id, invoice_ref);
create index invoice_tenant_status_idx on invoice (tenant_id, status);
create index invoice_tenant_open_balance_idx on invoice (tenant_id, job_id)
  where is_voided = false;

comment on column invoice.is_voided is
  'Derived. Balance answers must exclude these; the source status column has '
  'both "voided" and "canceled" and neither owes money.';

create table invoice_item (
  id                bigint generated always as identity primary key,
  tenant_id         text        not null,
  source_id         text        not null,   -- invitm_01a05f9b...
  invoice_id        bigint      not null references invoice (id),
  line_no           integer,
  name              text,
  item_type         text,                   -- source `type`
  unit_price_cents  bigint,
  qty_in_hundredths integer,
  amount_cents      bigint,
  ingested_at       timestamptz not null default now()
);

create unique index invoice_item_tenant_source_key on invoice_item (tenant_id, source_id);
create index invoice_item_invoice_id_idx on invoice_item (invoice_id);
create index invoice_item_tenant_name_idx on invoice_item (tenant_id, name);

-- ---------------------------------------------------------------------------
-- 6. Derived knowledge
--
--    One generic landing table for everything pulled out of note text. The
--    shape is deliberately open: a new fact type (access codes, contacts, unit
--    identifiers, warranty assertions, policies, part orders, whatever comes
--    next) is a new `fact_type` value and a payload shape, not a migration.
--
--    snippet is NOT NULL because a fact that cannot point at the words it came
--    from is not evidence, and the integrity test rejects it.
-- ---------------------------------------------------------------------------

create table extracted_fact (
  id             bigint generated always as identity primary key,
  tenant_id      text        not null,
  fact_type      text        not null,
  subject_type   text        not null,   -- 'property' | 'job' | 'customer' | ...
  subject_id     bigint      not null,   -- polymorphic; no FK by design
  payload        jsonb       not null default '{}'::jsonb,
  source_note_id bigint      references note (id),
  snippet        text        not null,   -- must appear verbatim in the source note
  confidence     real,
  extractor      text        not null,   -- name@version
  superseded_by  bigint      references extracted_fact (id),
  created_at     timestamptz not null default now(),
  constraint extracted_fact_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index extracted_fact_payload_gin on extracted_fact using gin (payload jsonb_path_ops);
create index extracted_fact_source_note_id_idx on extracted_fact (source_note_id);
create index extracted_fact_superseded_by_idx on extracted_fact (superseded_by);
create index extracted_fact_tenant_type_idx on extracted_fact (tenant_id, fact_type);
create index extracted_fact_tenant_subject_idx
  on extracted_fact (tenant_id, subject_type, subject_id);
create index extracted_fact_tenant_extractor_idx on extracted_fact (tenant_id, extractor);
create index extracted_fact_live_idx on extracted_fact (tenant_id, subject_type, subject_id)
  where superseded_by is null;

-- ---------------------------------------------------------------------------
-- 7. Operations
--    What ran, when, how much it cost. Read by the morning report.
-- ---------------------------------------------------------------------------

create table pipeline_run (
  id           bigint generated always as identity primary key,
  tenant_id    text        not null,
  task         text        not null,
  status       text        not null,   -- 'running' | 'ok' | 'failed' | 'halted'
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  rows_in      bigint,
  rows_out     bigint,
  cost_usd     numeric(14, 6),
  detail       jsonb       not null default '{}'::jsonb,
  error        text
);

create index pipeline_run_tenant_task_idx on pipeline_run (tenant_id, task, started_at desc);
create index pipeline_run_detail_gin on pipeline_run using gin (detail jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- 8. Tenant isolation
--
--    Applied by loop rather than by hand, so a table cannot ship without it —
--    which is the failure the check in scripts/check-rls.ts exists to catch.
--
--    FORCE is what makes this real: the connection role owns these tables, and
--    without FORCE the owner bypasses every policy silently.
--
--    current_setting() is wrapped in a SELECT so the planner evaluates it once
--    per query instead of once per row (skill rule security-rls-performance).
--    The `true` second argument makes an unset tenant return NULL rather than
--    raise, so a connection that forgets to set it sees zero rows — the
--    failure mode we want, not everyone's rows.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'raw_record', 'customer', 'property', 'job', 'note', 'invoice',
    'invoice_item', 'employee', 'job_employee', 'extracted_fact', 'pipeline_run'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_isolation', t);
    execute format(
      'create policy %I on public.%I for all '
      'using (tenant_id = (select current_setting(''app.tenant_id'', true)))',
      t || '_tenant_isolation', t
    );
    execute format('create index if not exists %I on public.%I (tenant_id)',
                   t || '_tenant_id_idx', t);
  end loop;
end $$;
