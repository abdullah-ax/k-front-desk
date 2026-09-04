# How it is put together, and why

Every choice here was made against one question: **what happens when this is
wrong?** A phone agent that is right 95% of the time is not 95% of a product —
the other 5% is a customer told the wrong thing about their own home.

## The shape

```
  phone ──▶ Vapi ──▶ /vapi/tools ─┐
                                  ├─▶ tools ─▶ src/write ─▶ the book
  test line ──▶ src/agent/loop ───┘                │
                                                   ▼
  office screen ◀── src/read ◀────────────── the same book
```

Two ways in, one way to change anything.

## One write path, no exceptions

`src/write/jobs.ts` is the only code that changes a job. The agent goes through
it. The office screen goes through it. The test suite goes through it.

That was not for tidiness. It means there is **one place to audit** and **one
set of guards**, and it means the office and the agent cannot drift apart — a
correction rate measured across two half-implementations is two half-numbers.

Every write carries the call or the ticket that caused it. `requireCause()`
refuses an agent change with neither, and it runs **before** the insert — a
guard that fires after the write is an apology, not a guard. We learned that the
hard way: fourteen orphan jobs existed because a test asserting "this throws" was
right about the throw and wrong about the order.

## The agent decides; the code decides the dangerous parts

The model is good at conversation and unreliable at consequences, so the things
that must not vary are taken away from it:

- **Safety.** If a caller says gas, smoke, fire, flooding or carbon monoxide and
  no handoff was made, the code makes one. This lives in `src/agent/emergency.ts`
  because **both** paths need it — it used to live in the test line's loop, and
  on a real call Vapi drives the model and that loop never runs, so the backstop
  was protecting the one path where it was already true.
- **Confirm before write.** Rule 7 in the prompt, and the scripted scenes check
  it turn by turn.
- **Said it, did it.** If a reply claims a write and no write tool ran that turn,
  the model gets one chance to do what it said. It told a caller "I've added that
  note" and never called the tool, about one time in six.

## Two database pools

The pooler allows **fifteen** clients. A live call reserves one connection for
the whole call so its scoping is set once and every tool call shares it — that
needs session mode. Everything else is one short transaction and works fine in
transaction mode, where the same pooler allows hundreds.

Sharing one session pool between them was a real outage: a few live calls plus
two browser tabs polling exhausted all fifteen, every read answered "max clients
reached", and that reached a caller as *"there's been a system error"*.

## Row-level security, forced

Every table is tenant-isolated and RLS is **forced**, because Supabase's
`postgres` role holds `BYPASSRLS` and would silently defeat a policy. The app
connects as `front_desk_app`, which does not. `withTenant()` proves the scoping
took before handing back a connection — an unscoped connection returns rows
happily, just the wrong tenant's.

## The console is one HTML file

`src/server/app.html` is vanilla JS, no framework, no build step. That was right
for getting a working product in front of someone quickly, and it is the thing
most worth revisiting: it is now large enough that a class name collided with an
older rule and quietly broke a panel's layout.

## Why these models

`anthropic/claude-haiku-4.5` answers the phone: **962 ms** against deepseek's
6,767 ms on the same suite, with the same scores. Speed is the product on a
phone call. `deepseek-v4-flash` does the bulk note extraction, where 95% of the
token spend sits. `kimi-k2` judges the replay tests, because the judge should not
be the thing being judged.

## The gates

- `pnpm demo` — ten scripted calls through the real loop and the real model
- `pnpm test:redteam` — nineteen attempts to make it leak a code, quote a price,
  or follow an instruction hidden in a caller's sentence
- `pnpm test:boundaries` — the eight refusals, three times each, because at
  temperature 0.3 the same eight gave 6/8, 5/8 and 7/8 on unchanged code
- `pnpm verify:source` — every job still where the export put it

A check that cannot fail is not a check. The guard tests were mutation-tested:
neuter the guard and they fail; move it after the write and they fail on the row
assertion alone.
