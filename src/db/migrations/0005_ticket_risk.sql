-- ---------------------------------------------------------------------------
-- 0005_ticket_risk — not everything needs a person.
--
-- 0004 made every board-derived proposal wait for approval. That is right for
-- a change that disturbs something already promised, and wrong for one that
-- records a fact already true: a job whose window passed forty minutes ago is
-- late whether or not anybody clicks Approve, and queueing that behind a human
-- turns the desk into a list of chores nobody reads. The owner said so
-- directly — the agent should act on what does not need intervention, and ask
-- about what does.
--
-- Two columns, one idea.
--
--   ticket.risk        'low'  the agent runs it itself, undoably, and the
--                             ticket is a receipt rather than a request
--                      'high' it waits for a person, as before
--
--   job_change.ticket_id
--                      The traceability rule in src/write/jobs.ts was "an
--                      agent change must carry the call that caused it",
--                      because a change nobody can explain is a failed gate.
--                      A board ticket is an explanation — a better one than a
--                      call, since it carries the goal, the facts it read, the
--                      risks it weighed and the exact steps. So the rule
--                      widens to "a call OR a ticket" rather than loosening:
--                      every agent change still has to say why it happened.
--
-- What counts as low risk is a code decision, not a data one, and it lives
-- next to the thing that acts on it (src/read/tickets.ts, RISK). It is written
-- down in one place so it can be argued with.
-- ---------------------------------------------------------------------------

set local search_path = public, extensions;

alter table ticket
  add column if not exists risk text not null default 'high';

comment on column ticket.risk is
  'low = the agent ran it itself and this row is the receipt; high = it waits for a person.';

-- Backfill, because `default 'high'` is the safe default for a NEW row and the
-- wrong answer for rows that already exist: every ticket filed before this
-- migration would have been marked as needing a person regardless of what it
-- actually does, and the queue would open full of things nobody needs to read.
-- The rule mirrors RISK in src/read/tickets.ts — a ticket is only as safe as
-- its riskiest step, and a tool this list does not name is high by omission.
update ticket set risk = 'low'
where status = 'open'
  and jsonb_array_length(steps) > 0
  and not exists (
    select 1 from jsonb_array_elements(steps) s
    where s->>'tool' not in ('mark_late', 'add_note', 'book_job')
  );

alter table job_change
  add column if not exists ticket_id bigint references ticket (id);

create index if not exists job_change_ticket_idx on job_change (ticket_id);

comment on column job_change.ticket_id is
  'The board ticket that caused this change, when no call did. An agent change carries one or the other, never neither.';
