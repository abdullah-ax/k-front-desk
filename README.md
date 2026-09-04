# Front desk

A phone agent and an office screen for **Gulf Breeze Air**, an air-conditioning
company in Miami. The agent answers the phone, works out which building the
caller is at, answers from the real record, and can move or book a visit. The
office screen shows the day's work, the calls coming in, and everything the
agent did — with a button to undo any of it.

| | |
|---|---|
| **Screen** | https://k-front-desk.vercel.app/app |
| **Phone** | +1 628 256 7499 |
| **Agent model** | `anthropic/claude-haiku-4.5` |

Read **[BRIEFING.md](BRIEFING.md)** first — it explains the product in about
four minutes, no jargon. **[DEMO.md](DEMO.md)** is the run sheet for showing it.

## The one idea

**A building is the customer, not a person.**

Most systems file work under a person's name. That breaks constantly: people
move, companies change managers, two people share a house, a property manager
looks after forty units. The air conditioner never moves. So everything here
hangs off the address, and the agent's first move on every call is to pin down
*which building* before it says anything.

That is why identity is the address — not a name. A name is a courtesy. A
stranger outside the building can read the number off the door and the manager's
name off a sign.

## What is in here

| Folder | What it holds |
|---|---|
| `src/agent` | The system prompt, the turn loop, the safety backstop |
| `src/tools` | The eleven things the agent can do, one file each |
| `src/read` | Everything the screens read: board, calls, tickets, locations |
| `src/write` | The only code that changes a job. Both the agent and the office go through it |
| `src/calls` | Call records, the six-layer trace, resuming a caller by number |
| `src/domain` | Address normalising and property resolution |
| `src/pipeline` | Loading the export, deriving properties, extracting facts from notes |
| `src/server` | The HTTP handler, the Vapi webhook, and the console itself |
| `tests` | The gates. See below |
| `scripts` | The demo runner, the pre-flight check, the cleanup tools |

## Running it

```bash
pnpm install
cp .env.example .env      # then fill it in
pnpm db:migrate
pnpm agent:serve          # the platform, on :3000
```

## Checking it

```bash
pnpm demo:check     nine checks against the live system, before you demo
pnpm demo           ten scripted calls against the deployment
pnpm test:redteam   nineteen attempts to make it leak or misbehave
pnpm test:boundaries the eight refusals that must hold, three times each
pnpm verify:source  proves no job has moved from where the export put it
```

## The three promises

These are what separate a demo from something you would plug in.

1. **It reads the change back before it makes it.** The agent never moves a
   visit in the same breath it suggests one. A misheard house number lands on a
   different real building about 70% of the time, so that gap is the only moment
   a caller can hear it and stop.
2. **Anything the agent did, a person can undo in one click.** Undo adds a
   correction rather than erasing, so the record still shows what happened.
3. **The call log shows what the agent *did*, not just what it said.** Six
   layers: what was said, why it decided, which lookup ran, the exact database
   statement, the rows and timing, and what changed.

## What it will not do, on purpose

It will not read out an entry code, ever. It will not quote a price for a new
system. It will not say whether something is under warranty — it shows the
paperwork and lets a person decide. Say the word *gas* and the call goes to a
person whether or not the agent thinks it should.

Those are not gaps. They are the answer to "what happens when this is wrong".

## The data

The client's export is not in this repo. It was supplied privately and stays
that way. Nothing here modifies it: `pnpm verify:source` compares every job
against the raw JSONL row it was loaded from and reports any that differ.

**1,992 jobs · 1,327 buildings · 23 employees · 10,645 facts read out of 6,978
handwritten notes.**

More on how it is stored and why: **[docs/DATA.md](docs/DATA.md)**.
More on how it is put together and why: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.
The working notes, with every number and every wrong turn: **[NOTES.md](NOTES.md)**.
