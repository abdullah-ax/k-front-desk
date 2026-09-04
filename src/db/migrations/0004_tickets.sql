-- ---------------------------------------------------------------------------
-- 0004_tickets — the agent proposes, a person decides.
--
-- 0003 gave the agent a write path it can be trusted with on a call: act,
-- attach the call, stay undoable for an hour. That model is kept exactly as it
-- is. This file is for the other case, the one the owner asked for in so many
-- words: things the system notices on the board OUTSIDE a call, where nobody
-- is waiting on the line and there is time to ask first. A job with no
-- technician an hour before it starts. A customer whose window has passed with
-- nobody on the way. Those are not tool calls; they are tickets — a goal, the
-- exact steps that would run, what could go wrong, what the system did not
-- know, and what makes the thing actually finished.
--
-- One table. The steps are stored as the literal plan (`tool`, `args`,
-- `description`) so what the person approves is byte for byte what executes,
-- through the same src/write/jobs.ts path the buttons use, with the person's
-- name on the change. A ticket never runs itself.
--
-- What is NOT here: the agent's finished work. That is already in job_change
-- with the call attached, and the tickets screen reads it from there rather
-- than copying it, so there is nothing to drift.
--
-- Steps:
--   1. ticket
--   2. RLS, forced, exactly as 0003 does it
-- ---------------------------------------------------------------------------

set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. ticket
--
-- `kind` plus `job_id` is the identity of a proposal: one late notice per job,
-- one assignment per job, however many times the board is re-read. A dismissed
-- ticket therefore stays dismissed rather than coming back on the next refresh,
-- which is the difference between a suggestion and a nag.
-- ---------------------------------------------------------------------------

create table if not exists ticket (
  id               bigint generated always as identity primary key,
  tenant_id        text        not null,
  -- 'board' for something a derivation noticed with no call involved. Left as
  -- text rather than a check constraint so a call-sourced ticket is a value,
  -- not a migration.
  source           text        not null,
  -- What was noticed: 'assign_unassigned', 'late_notice'. The dedupe key.
  kind             text        not null,
  call_id          bigint      references "call" (id),
  job_id           bigint      references job (id),
  goal             text        not null,
  -- The one sentence of evidence that made this worth raising.
  why              text,
  -- [{tool, args, description}]. The literal plan; approval runs exactly this.
  steps            jsonb       not null default '[]'::jsonb,
  -- [{label, value, source}]. Read from the record, never typed.
  facts            jsonb       not null default '[]'::jsonb,
  risks            jsonb       not null default '[]'::jsonb,
  -- What the derivation could not know. Honest by construction: this system
  -- has no travel times, no skills matrix and no way to text a customer, and
  -- a ticket says so rather than implying otherwise.
  gaps             jsonb       not null default '[]'::jsonb,
  close_condition  text        not null,
  -- The real timestamp the proposal hangs on: the visit's start, the promised
  -- window's end. Urgency on screen is arithmetic on this, not a stored rank.
  due_at           timestamptz,
  -- 'open' | 'approved' | 'dismissed' | 'countered'
  status           text        not null default 'open',
  -- What actually ran on approval: the job_change ids and their summaries, so
  -- a ticket links forward to the changes it caused and they link back.
  result           jsonb       not null default '{}'::jsonb,
  resolved_at      timestamptz,
  -- A name, not an account. The platform has one shared passphrase and says so.
  resolved_by      text,
  -- Free text for what the person did instead, when they countered.
  resolution_note  text,
  created_at       timestamptz not null default now()
);

create unique index if not exists ticket_subject_uniq
  on ticket (tenant_id, source, kind, job_id) where job_id is not null;
create index if not exists ticket_open_idx   on ticket (tenant_id, status, created_at desc);
create index if not exists ticket_job_idx    on ticket (job_id);
create index if not exists ticket_call_idx   on ticket (call_id);

comment on table ticket is
  'A proposal from the board. Nothing in it runs until a person approves it, and then it runs as that person.';

-- ---------------------------------------------------------------------------
-- 2. Row level security, forced, exactly as 0003 does it
--
-- FORCE matters: without it the table owner is exempt and every policy here is
-- decoration. The application drops to front_desk_app (NOBYPASSRLS) before it
-- touches any of this; see src/db/client.ts.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['ticket']
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
