# The data, and why it is stored this way

## What arrived

An export of a real air-conditioning company's book, anonymised: **1,992 jobs,
1,327 buildings, 23 employees, 1,700 invoices, 6,978 handwritten notes.** The
one rule was: do not modify it.

`pnpm verify:source` holds us to that. It compares every job's schedule against
the raw JSONL row it was loaded from — the one copy nothing here writes to — and
reports any that differ. It currently reports none.

## Three tiers

```
  raw_record   the export, exactly as it arrived. Never written to.
      │
      ▼
  job / property / customer / invoice / note     derived, and reloadable
      │
      ▼
  extracted_fact    10,645 facts read out of the notes by a model
```

Each tier can be rebuilt from the one above it. That matters because the
extraction is the part most likely to be wrong, and being able to throw it away
and run it again is the difference between a pipeline and a one-way door.

## Why the building is the key

The export files work under a customer. Reading it showed why that breaks:

- **53.8%** of the work comes from property managers, so the person who rings is
  usually not the account.
- One street holds **18 different properties** behind a single street name.
- Customers change; the equipment does not.

So `property` is keyed on `(normalized_street, unit)` and everything hangs off
it. `(street_norm, unit)` is unique — checked, zero duplicate pairs. That single
decision is why the agent's first move is always the address, and why it asks
for a unit rather than guessing between eighteen.

## What reading the notes actually found

Six findings shaped the whole design:

| Found | What it forced |
|---|---|
| Everything important is free text, no author, no timestamp | Facts get extracted, and every one carries the note it came from |
| **46%** of jobs need a door code, and there is no door-code field | Access is a fact type, and the agent may never read one out |
| **41%** of revenue sits in items priced fewer than five times | There is no reliable price to quote, so it never quotes one |
| Coordinates are junk | No routing, no maps, no "nearest technician" |
| About **11%** of notes carry a different address from the property they hang off | The dossier rewrites a stray address to the property the resolver picked — at read time; the stored note is untouched |
| Records start March 2026 | The agent says so rather than implying it knows more |

## Entry codes

The anonymiser removed them before the export arrived: **1,261 of 1,323** access
facts hold `[code]`, and both the raw and scrubbed note text show the same
placeholder. There is no copy to reveal.

The design still assumes real ones. Codes are redacted **before insert**, never
on render — redacting at render time means the secret is in the database, in
logs, and one missed template away from a screen. The Locations screen shows a
real value to the person at the desk where the export kept one, and the agent
never sees any of it.

## Redaction is label-anchored

We never hunt for digit patterns. A four-digit number could be a house number, a
job reference or a year. The scrubber looks for the **label** — "door code",
"gate code", "lockbox" — and takes what follows. Hunting digits would have
redacted half the addresses in the book.

## What the numbers are worth

The screens report what a query returns, not a stored figure that can drift. The
Calls list counts changes from the change table rather than a counter column,
because the counter and the table disagreed: the counter rose on every write
*tool*, the table only held real writes, and a screen that says "2 changes" over
a trace holding one is a screen nobody trusts twice.
