-- ---------------------------------------------------------------------------
-- 0003_platform — the tables the office can see, and the record of why.
--
-- Milestone 1 was read-only: the agent answered and nothing was written down.
-- Two PRDs turn on the same missing piece. `.claude/prds/call-observability.prd.md`
-- needs a durable record per call, because today the words live in the voice
-- provider's dashboard, the tool traffic lives in function logs, and the model's
-- reasoning and the SQL it caused live nowhere at all. `.claude/prds/front-desk-platform.prd.md`
-- needs a write path where every change carries the call that caused it and can
-- be undone. Both are this file.
--
-- Four tables:
--   call          one row per conversation, phone or web
--   call_event    the ordered trace inside it: turns, reasoning, tools,
--                 queries, proofs, changes, refusals
--   job_change    every mutation to a job, with its cause and its undo
--   queue_item    an owner and a date against work that quietly stopped
--
-- Two properties matter more than the columns:
--
--   1. NOTHING IS OVERWRITTEN. A correction appends a row. `job.scheduled_start`
--      moves, but the previous value is preserved in job_change.before, so the
--      history reads as one story and undo is a fact rather than a guess.
--
--   2. THE TRACE IS A SECRET SURFACE. call_event.result holds tool output, and
--      tool output includes the property dossier, which knows the entry codes
--      for 869 properties. src/security/redact.ts runs before a row is written,
--      and tests/redaction.test.ts proves it. Observability that leaks is worse
--      than no observability.
--
-- Steps:
--   1. call
--   2. call_event
--   3. job_change
--   4. queue_item
--   5. RLS, forced, on all four
-- ---------------------------------------------------------------------------

set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. call
--
-- `provider_call_id` is the voice provider's id and is the natural key on the
-- phone path; the web test line makes its own. Unique per tenant so a webhook
-- retry updates the row it already made instead of forking the record.
-- ---------------------------------------------------------------------------

create table if not exists "call" (
  id                 bigint generated always as identity primary key,
  tenant_id          text        not null,
  provider_call_id   text        not null,
  -- 'phone' or 'web'. The web test line exists so a demo survives a dead
  -- signal; tagging it means a rehearsal is never mistaken for a customer.
  channel            text        not null default 'phone',
  from_number        text,
  caller_label       text,
  customer_id        bigint      references customer (id),
  property_id        bigint      references property (id),
  -- How the property was arrived at. The owner's question is "did it ever give
  -- someone else's information to the wrong caller", and this column is where
  -- that is answered.
  resolution_basis   text,
  status             text        not null default 'live',
  ended_reason       text,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  duration_ms        integer,
  turn_count         integer     not null default 0,
  tool_count         integer     not null default 0,
  change_count       integer     not null default 0,
  handoff_reason     text,
  summary            text,
  ingested_at        timestamptz not null default now()
);

create unique index if not exists call_provider_id_uniq
  on "call" (tenant_id, provider_call_id);
create index if not exists call_started_idx      on "call" (tenant_id, started_at desc);
create index if not exists call_status_idx       on "call" (tenant_id, status);
create index if not exists call_from_number_idx  on "call" (tenant_id, from_number);
create index if not exists call_property_idx     on "call" (property_id);

comment on table "call" is
  'One conversation. The record the office opens when a customer says "your robot told me Tuesday".';

-- ---------------------------------------------------------------------------
-- 2. call_event
--
-- The six layers of the trace, in one ordered table rather than six. A layer is
-- a `kind`, not a table, because the screen renders them interleaved in the
-- order they happened and any join to reassemble that order would be a bug
-- waiting to reorder itself.
--
--   turn       a caller or agent utterance
--   reasoning  the model's own words where the provider returns them
--   decision   our reconstruction where it does not. NEVER labelled 'reasoning'
--              on screen: showing a trace as thinking the model did not report
--              is worse than showing less
--   tool       a tool invocation with its arguments and redacted result
--   query      a statement a tool ran, with duration and row count
--   proof      the verbatim snippet a claim rests on, and the note it is in
--   change     something moved in the record
--   refusal    a boundary held, with which one
--   handoff    a person was asked for
--   system     connection opened, call ended, backstop fired
-- ---------------------------------------------------------------------------

create table if not exists call_event (
  id            bigint generated always as identity primary key,
  tenant_id     text        not null,
  call_id       bigint      not null references "call" (id) on delete cascade,
  -- Monotonic within a call. Timestamps collide at millisecond resolution when
  -- tools run in parallel, so ordering hangs on this and not on `at`.
  seq           integer     not null,
  at            timestamptz not null default now(),
  kind          text        not null,
  role          text,
  body          text,
  tool_name     text,
  args          jsonb,
  -- Redacted before insert. See src/security/redact.ts.
  result        text,
  statement     text,
  duration_ms   integer,
  row_count     integer,
  note_id       bigint      references note (id),
  job_id        bigint      references job (id),
  property_id   bigint      references property (id),
  meta          jsonb       not null default '{}'::jsonb
);

create unique index if not exists call_event_seq_uniq on call_event (call_id, seq);
create index if not exists call_event_call_idx  on call_event (call_id, seq);
create index if not exists call_event_kind_idx  on call_event (tenant_id, kind);
create index if not exists call_event_job_idx   on call_event (job_id);

comment on column call_event.result is
  'Tool output AFTER redaction. Raw output can contain entry codes; this column must never.';

-- ---------------------------------------------------------------------------
-- 3. job_change
--
-- The one rule that makes an agent safe to leave switched on: it does not write
-- straight into the record, it writes a change with the call attached, and the
-- office can undo it for as long as the job has not started.
--
-- `before` and `after` are whole-field snapshots rather than a diff, because an
-- undo has to restore a state and a diff only describes a transition.
-- ---------------------------------------------------------------------------

create table if not exists job_change (
  id            bigint generated always as identity primary key,
  tenant_id     text        not null,
  job_id        bigint      not null references job (id),
  call_id       bigint      references "call" (id),
  -- 'agent' or 'office'. Both go through the same path, so there is one code
  -- path to test and one to audit; this column is the only difference.
  actor         text        not null,
  actor_label   text,
  kind          text        not null,
  before        jsonb       not null default '{}'::jsonb,
  after         jsonb       not null default '{}'::jsonb,
  summary       text,
  created_at    timestamptz not null default now(),
  undone_at     timestamptz,
  undone_by     text
);

create index if not exists job_change_job_idx     on job_change (job_id, created_at desc);
create index if not exists job_change_call_idx    on job_change (call_id);
create index if not exists job_change_recent_idx  on job_change (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. queue_item
--
-- The five Catch up queues are derived by query, not stored, so their counts
-- can never drift from the database. What is NOT derivable is who owns one and
-- when it is due, which is the whole difference between a queue and a list.
-- Only that lives here.
-- ---------------------------------------------------------------------------

create table if not exists queue_item (
  id             bigint generated always as identity primary key,
  tenant_id      text        not null,
  queue          text        not null,
  subject_type   text        not null,
  subject_id     bigint      not null,
  owner_id       bigint      references employee (id),
  due_on         date,
  dismissed_at   timestamptz,
  dismiss_reason text,
  updated_at     timestamptz not null default now()
);

create unique index if not exists queue_item_subject_uniq
  on queue_item (tenant_id, queue, subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- 5. Row level security, forced, exactly as 0001 does it
--
-- FORCE matters: without it the table owner is exempt and every policy here is
-- decoration. The application drops to front_desk_app (NOBYPASSRLS) before it
-- touches any of this; see src/db/client.ts.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['call', 'call_event', 'job_change', 'queue_item']
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
