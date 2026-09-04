# Front Desk — the platform

*Milestone 2 of the Gulf Breeze Air front desk. Milestone 1 (grounded answers on a live phone number) is complete and shipped.*

## Problem

Gulf Breeze Air's voice agent can now answer questions from the company's own records, but nobody can see it work. The office manager runs the day out of Housecall Pro in one window and has no idea a call is even happening; the owner's complaint — *"I have no idea what it promised anyone"* — is untouched by anything built so far. Until the office can watch a call, check a past call, and undo something the agent got wrong, the safe move is to leave the agent switched off, and every hour of work in the data layer earns nothing.

A second, quieter cost sits in the same gap. The records already know about 150 finished jobs nobody billed and 38 invoices written and never sent. No product the company pays for surfaces work that quietly stopped, so it stays stopped.

## Evidence

- **Owner, verbatim:** "It can't tell a customer when we were last out there, it can't tell them if they're under warranty, it can't move an appointment, I have no idea what it promised anyone, and it's pretty slow." Four of the five are agent problems and are addressed. The fifth is a platform problem and is not.
- **The last bot failed exactly here.** All 89 call notes from the incumbent booking bot end at the words `Call transcript:` with nothing after them. Of the 40 jobs it booked, 31 were canceled — 77.5%, against 11.3% for every other job. An agent nobody can audit produces bookings nobody trusts.
- **Work stops silently, and it is countable** (verified against the loaded database, 3 Sep 2026): 150 completed jobs with no invoice; 38 live invoices written and never sent, worth $55,207.19; 95 jobs never assigned to anyone (46 of them not canceled); 40 jobs sitting in "needs scheduling".
- **The naive balance is wrong.** 76 voided or canceled invoices still carry $268,433.84 of due amount. The real open balance is $229,278.48. Any screen that sums `due` without excluding them overstates receivables by more than the true figure.
- **The day is small enough to draw whole.** 188 scheduled days: median 9 jobs, 95th percentile 21, maximum 25. 15 field techs, all of whom take jobs. The entire worst day fits on one screen — so it should be one screen.
- **The caller is usually not the customer.** 53.8% of jobs come from property managers; 63.9% are at an address seen before. 3,697 contact facts and 2,818 access facts were extracted from prose that has no fields for them.

## Users

- **Primary — the office manager.** Sits on the phone most of the day, holding a handset in one hand. Triggers: a customer calls, a tech is running late, the agent books something, a caller says "your robot told me Tuesday". Needs the whole day visible without clicking, and needs to check the agent in under ten seconds.
- **Secondary — the owner.** Checks in a few times a day, mostly from a phone. Triggers: wondering whether today is going badly, and whether the agent can be trusted with more. Needs the audit trail and the queues of stopped work.
- **Secondary — the field tech.** Standing outside a building. Needs the property page on a phone: what we did here last time, and how to get in.
- **Not for:** technicians as a primary daily surface (no tech app), bookkeepers (invoicing and payments stay in Housecall Pro), and end customers (no customer-facing portal).

## Hypothesis

We believe **a shared write path plus five screens that show what the agent did, as it does it** will **convert the agent from a liability the office switches off into a coworker the office supervises** for **the office manager and the owner**.

We'll know we're right when **every change the agent makes appears on the board before the call ends, carries the call that caused it, and can be undone in one click — and a five-minute demo can be run end to end with zero wrong records.**

## Success Metrics

| Metric | Target | How measured |
|---|---|---|
| Wrong-record rate | 0 | The milestone-1 gate, re-run against the write path: no change ever lands on a property or job the caller did not identify |
| Agent write visible on the board | < 2s, while the call is still connected | Timestamp on the change row vs. the board's render, measured across the rehearsal calls |
| Agent writes carrying their cause | 100% | Every change row has a call reference; a change without one is a failed gate, not a warning |
| Undo available | 100% of agent changes on jobs that have not started | Counted directly; undo restores the prior state and appends rather than deletes |
| Queue counts match the database | Exact | Each queue's displayed count re-derived by a direct query and compared |
| Worst-day board | 25 jobs, 15 tech rows, no horizontal scroll of the page | Rendered against the busiest day in the export |
| Demo runs without dialing | Full five-minute script completes | Rehearsed on the browser test line with the phone number left live and untouched |

## Scope

**MVP** — A shared write path (book, move, cancel, add note) where every change records what caused it and can be undone, plus five screens over it: **Today** (the day on one board, drag to move or reassign, live), **Calls** (a call in progress and every past call, with each lookup and each change shown inline), **Property** (the dossier the agent reads, drawn as a page, every fact linked to the verbatim note it came from), **Job** (one visit, one ordered history including the agent's entries), **Catch up** (the five queues of work that stopped, each item assignable with an owner and a date). Plus a **test line**: a browser console that opens a real call against the same agent and the same write path, so the demo does not depend on a phone in hand — while the live phone number keeps working, unchanged.

**Out of scope**

- **Login and user accounts** — one shared link behind a passphrase. Real accounts are a day of work that proves nothing about the thesis.
- **A technician phone app** — the property page is readable on a phone. A separate app is a second product.
- **Invoicing and payments** — Housecall Pro does this well, and moving money is not a thing to prototype.
- **Price-book editing** — read only. 41% of revenue sits in items priced fewer than five times, so there is nothing stable enough to edit.
- **Two-way sync with Housecall Pro** — real and worth doing, later. Not needed to prove anything here.
- **The Ask box** — the agent's brain with a keyboard. Genuinely useful, first thing cut, because the phone number already proves the point.
- **Install quotes, warranty verdicts, ETA and who-is-closest, discounts, and reading out entry codes** — carried forward unchanged from milestone 1. Each is refused for a counted reason, not a time reason, and each ends in a handoff to a person.

## Delivery Milestones

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Every change carries its cause | Booking, moving, cancelling and noting a job all go through one path that records what caused the change and can be undone. Nothing writes straight into the record. | complete | `src/write/jobs.ts`, `pnpm test:write` |
| 2 | The day on one screen | The office manager sees every job today across every tech, drags one to move or reassign it, marks a tech running late, and books a new job in about fifteen seconds. Unassigned work is impossible to miss. | complete | `src/read/board.ts`, Today |
| 3 | The call is visible | A call in progress shows the caller, the transcript as it is spoken, every lookup the agent made with what came back, and every change it made linked to the job. The same view opens any past call, searchable by number, address or job. | complete | `src/read/calls.ts`, Calls |
| 4 | A call without a phone | The full demo can be driven from a browser by typing each caller turn, against the same agent, the same tools and the same write path, while the published phone number stays live and answers exactly as before. Browser microphone input is not built; voice is the phone. | complete | `/data/testline/*`, Test line |
| 5 | The office can check the agent without trusting it | Property and Job pages show the same evidence the agent read, with every fact linking to the verbatim note it came from, and the agent's entries in the same ordered history as everyone else's. | complete | Property and Job |
| 6 | Nothing falls through quietly | Five queues of stopped work, counts matching the database exactly, each item assignable to a person with a date or dismissable with a reason. | complete | `src/read/queues.ts`, Catch up |

## Open Questions

- [ ] **Which figures the demo quotes.** Several counts in the source brief disagree with the loaded database: facts 12,737 → **10,645** (the brief predates the field-provenance gate that removed ungrounded extractions); voided invoices 66/$267,700 → **76/$268,433.84** (the source has both "voided" and "canceled" statuses and neither owes money); unsent invoices 48/$55,941 → **38/$55,207.19** live, 65 including voided ones; unassigned jobs 95 all-time → **46** excluding cancelled. Every screen and every spoken number must use one set, and it should be the verified set.
- [ ] **What "running late" actually does to the customer.** The button writes a note and marks the job. Notifying the customer means SMS or a call, and no messaging channel is in scope. TBD — needs a decision on whether the button promises something it cannot do.
- [ ] **What counts as a repeat visit for the same fault.** Same property inside N days is measurable; "same fault" is not, without a comparison the notes can support. TBD — needs validation against the callback-tagged jobs before the queue claims it.
- [x] **How long undo stays available.** DECIDED: until the technician starts the job, and where there is no start timestamp, one hour. Long enough that a person notices a mistake on a call they just heard, short enough that nobody unwinds work already done. Stated in `UNDO_WINDOW_MS` and asserted by the write-path gate, so the button is never offered when it would not work.
- [ ] **Whether a shared passphrase is defensible for a link that shows entry-code presence and customer balances.** It is the accepted trade for a 24-hour build; it should be stated out loud rather than assumed.
- [ ] **Conflict when the office and the agent touch the same job at the same moment.** 60.3% of work is booked same-day, so this is not hypothetical. TBD — needs a rule, and the rule needs to be visible on screen.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Live updates fail during the demo and the board becomes a refresh button | Medium | High — "while we are still on the phone" is the whole thesis | The board must degrade to a short poll rather than to nothing; rehearse the failure, not just the success |
| The demo depends on a phone call that does not connect (reception, carrier, mic) | Medium | High — the last thing to fail is always the live call | Milestone 4 exists for exactly this: the browser test line runs the identical path, and the phone number stays live as the second route |
| An agent write lands on the wrong job or the wrong property | Low | Severe — this is the one failure that ends the pilot | Every write is a change with the caller-identified subject attached; wrong-record rate stays a hard gate at zero, carried over from milestone 1 |
| Drag-to-move is fiddly under demo pressure | Medium | Medium — a fumbled interaction reads as a broken product | Every drag action must also exist as a click action on the job page; never leave a capability reachable only by dragging |
| The undo window closes before anyone notices the mistake | Medium | Medium | Undo is visible on the change itself, not buried in a menu, and the Calls screen lists changes newest-first so the last few minutes are always on screen |
| Shared-link passphrase leaks | Low | High — the platform shows balances and reveals which properties have entry codes on file | Codes are never rendered, only their presence; the link is rotatable and the demo link is short-lived |
| Scope creep into invoicing because the queues touch money | Medium | Medium — five hours of the twenty-four are reserved for deploy and rehearsal, and they are the ones that get eaten | Queues are read-only over money; the only writes are assign, dismiss, and note |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
