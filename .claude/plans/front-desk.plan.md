# Plan: Front Desk — Grounded Answers

**Source PRD**: `.claude/prds/front-desk.prd.md`
**Selected Milestone**: 1 — Grounded answers
**Complexity**: Large
**Revision**: 2 — OpenRouter throughout; split into guided setup / autonomous run / morning review

## Summary

Stand up the data layer and a read-only voice agent on a real phone number, so a caller reaches a line that answers questions about their own property's history, access and status — every answer traceable to a record. Autonomy level L0: the agent reads, a human still does everything else. No write path exists in this milestone.

The work is split into three parts. **Part A** is thirty minutes of setup you do with me, because it needs accounts and keys a machine can't create. **Part B** runs unattended — build, load, extract, test — halting on gates rather than guessing. **Part C** is twenty minutes in the morning: place a real call, review the extraction sample, read the report.

## What changed in revision 2

| Change | Effect |
|---|---|
| **OpenRouter is the default provider for every model call**, including the live call path | One adapter, three role-based env vars. A single variable flips any role to a direct provider later if latency demands it. |
| **Setup extracted into Part A** | Everything needing a human — accounts, keys, spend caps — happens first and ends in one green preflight check. |
| **Part B is designed to run unattended** | Ordered, resumable, gated. Writes a checkpoint file and a morning report. Halts on failure; never proceeds on a guess. |
| **The phone is in scope and must be callable by morning** | Vapi is required in setup, and the agent is deployed to a public URL during the run — not tunnelled from your laptop, which dies when the lid closes. The run configures the assistant and verifies the webhook end to end. |
| **The 50-row extraction hand-check became a two-stage gate** | Machine-verifiable checks (does the snippet appear verbatim in its source note?) run overnight and can halt the run. Semantic review is sampled into a file you read in the morning. |

---

# Part A — Setup (you, ~30 minutes)

Do these in order. Each step ends with something you paste into `.env`. The last step verifies all of it at once.

### A1. Runtime
Node 20 or newer, and pnpm.
```bash
node --version && pnpm --version
```
If pnpm is missing: `npm i -g pnpm`

### A2. OpenRouter account and key
1. Sign up at **openrouter.ai**, add credit (\$10 is plenty for this milestone).
2. **Set a spend limit on the key.** Settings → Keys → create a key with a hard limit. This is the one setting that matters for an unattended run.
3. Copy the key.

```
OPENROUTER_API_KEY=sk-or-...
```

### A3. Pick three models
Model slugs change, so read them rather than trust a list:
```bash
curl -s https://openrouter.ai/api/v1/models \
  | jq -r '.data[] | "\(.id)  in:\(.pricing.prompt)  out:\(.pricing.completion)"' \
  | sort | less
```
Choose by role and paste all three. Criteria, not brands:

| Variable | Role | Pick for |
|---|---|---|
| `MODEL_EXTRACT` | Bulk pass over 6,954 notes | Cheap, reliable structured output. This is ~95% of your token spend. |
| `MODEL_AGENT` | The live conversation | Fast first token, strong tool use. Latency matters more than depth. |
| `MODEL_JUDGE` | Scoring the replay tests | Strongest available. Runs rarely, so cost is irrelevant. |

### A4. Postgres
Supabase, free tier — chosen because milestone 3 needs its realtime feature and switching later is wasted work.
1. Create a project at **supabase.com**.
2. Project Settings → Database → copy the **connection string** (session mode).
3. SQL Editor → run:
```sql
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists fuzzystrmatch;
```

```
DATABASE_URL=postgresql://...
```

### A5. Phone number — required
1. Sign up at **vapi.ai** and add a card.
2. Buy a phone number (Phone Numbers → Buy). A US local number is a couple of dollars a month.
3. Copy your API key (Settings → API Keys) and the phone number's id.
```
VAPI_API_KEY=...
VAPI_PHONE_NUMBER_ID=...
```
4. Optional but useful — a number the overnight run can dial to prove the line works end to end. Use a second phone or a voicemail-safe line, not the one on your nightstand.
```
TEST_PHONE_NUMBER=+1...
```

### A6. Somewhere to deploy the webhook
Vapi calls **our** server for every tool call, so it needs a public URL that outlives your laptop going to sleep. A tunnel from your machine will die at 2am; deploy instead. The tool endpoint is plain request/response, so anything serverless works.

1. `npx vercel login`, then `npx vercel link` in the project root.
2. Copy the project's production URL.
3. Invent a long random string — this authenticates Vapi to us, and without it anyone who finds the URL can query customer records including door codes.

```
PUBLIC_URL=https://your-project.vercel.app
VAPI_WEBHOOK_SECRET=<long random string>
```

### A7. Preflight
```bash
pnpm install && pnpm preflight
```
Prints a pass/fail table for: Node version, database reachable, all three extensions present, OpenRouter key valid, each of the three models resolvable, spend limit detected, source data files present with expected row counts, Vapi key and number valid, deploy target reachable, and webhook secret set.

**Every row must be green before you start Part B.**

---

# Part B — Autonomous run (unattended)

Start it with:
```bash
pnpm run overnight
```

Behaviour: works tasks in order, writes `.claude/plans/front-desk.progress.json` after each, appends to `logs/overnight.log`, and **halts on any gate failure rather than continuing**. Re-running resumes from the last incomplete task. A spend check runs before each model-using task and halts if the remaining budget is under a set floor.

### Task 1 — Project skeleton and schema foundations
- **Action**: TypeScript project, Drizzle, core tables. `tenant_id NOT NULL` and row-level security on every table in the first migration. No table ships without both.
- **Mirror**: `src/config.ts` hoists constants like `eda/scripts/dq_common.py:6-8`.
- **Validate**: `pnpm db:migrate && pnpm db:check-rls` — fails if any table lacks `tenant_id` or has RLS off.
- **Halt if**: migration fails, or the RLS check reports any table.

### Task 2 — Model adapter
- **Action**: One module wrapping OpenRouter through `@openrouter/ai-sdk-provider`, exposing `extractModel()`, `agentModel()`, `judgeModel()` resolved from the three env vars. Attribution headers set. Every model call in the codebase goes through here — no direct SDK use anywhere else.
- **Validate**: `pnpm test:models` — each role returns a completion for a fixed prompt; asserts no file outside this module imports a provider SDK.
- **Halt if**: any role fails to resolve.

### Task 3 — Raw landing
- **Action**: Load all four JSONL files verbatim into `raw_record(file, line_no, payload jsonb)`. No transformation. Parse defensively. Notes and invoice items are arrays embedded inside jobs and invoices, not files of their own — their counts are asserted separately, because a short embedded array is a silent loss no file-level row count would catch.
- **Mirror**: `eda/scripts/sched_load_jobs.py:24-28` defensive nested access.
- **Validate**: `pnpm pipeline:load && pnpm test:counts` — asserts 1,992 jobs, 6,954 notes, 1,700 invoices, 4,390 items, 732 customers, 23 employees.
- **Halt if**: any count differs.

### Task 4 — Assertions before anything trusts the data
- **Action**: EDA findings as SQL returning zero rows: every `invoice.job_id` resolves; `subtotal = Σ items.amount` on all 1,700; `amount = unit_price × qty` on all 4,390; zero orphan employee references; every job timezone is `America/New_York`.
- **Mirror**: numbered independently-runnable files, per `eda/scripts/dq_01_schema.py`.
- **Validate**: `pnpm test:assert`
- **Halt if**: any assertion returns rows. The load is wrong and everything downstream is garbage.

### Task 5 — Core tables with derived columns
- **Action**: Populate typed tables. Compute the derived columns that fix the source's broken fields, and have nothing downstream read the originals: `job_ref`/`invoice_ref` namespaced apart, `derived_kind`, `is_canceled`, `last_visit` from `max(completed_at)`, `next_visit`, `balance_due` excluding voided invoices, `window_end` from `scheduled_start + arrival_window` capped at 4h, `service_code` canonicalised across the `**` duplicates. All timestamps to `America/New_York` at this boundary.
- **Mirror**: explicit field enumeration per `eda/scripts/sched_load_jobs.py:29-45`; `TZ` per line 12.
- **Validate**: `pnpm test:derived` — no `last_visit` in the future, `balance_due` excludes all 68 voided invoices, `job_ref` and `invoice_ref` never compared.

### Task 6 — Address normalizer and property table
- **Action**: Suffix and directional expansion across the 22 pairs, unit extraction from `street`, canonical key `(normalized_street, unit, zip)`. `property` table with a trigram index. **No geography column** — coordinates excluded by design.
- **Validate**: `pnpm test:address` — the 48 addresses spelled two or more ways collapse to one property each; 263 duplicate address records merge; zero coordinate columns exist.

### Task 7 — Property resolver
- **Action**: Resolve utterances to ranked candidates with confidence. Return type is always a list — a single-row return is a type error, not a judgment call. Trigram for streets, double-metaphone for names, exact for unit.
- **Validate**: `pnpm test:resolve` — `1363 W Old Mangrove Rd` returns 18 candidates and demands a unit; `112` and `122 Marlin Hollow` never collapse; a bare last name never returns a confident single match.

### Task 8 — Anonymizer scrubbing
- **Action**: Before any text reaches an extractor, replace known corruption: `phone:<TitleCase Name>` → `[phone]`, and disambiguate the twelve `<X> Hospitality` tokens where they sit in a verb or noun slot rather than a company slot. Strip zero-width and object-replacement characters.
- **Validate**: `pnpm test:scrub` — fixtures from the 775 known-corrupt notes; "Ruby Avery" never survives as a person name; `SERIAL NO. Ruby Avery` is flagged, not read.
- **Halt if**: this fails. Running extraction over unscrubbed text bakes false facts into the record.

### Task 9 — Extraction pass
- **Action**: One extractor per fact type — access, contacts, unit identifiers, warranty assertions, policies, part orders. Each declares schema, prompt and version. Runner batches by job and writes to `extracted_fact` with `source_note_id`, verbatim `snippet`, `confidence`, `extractor` version. Uses `MODEL_EXTRACT`.
- **Validate — machine, runs overnight**: `pnpm test:extract-integrity`
  - every `snippet` appears **verbatim** in its `source_note_id`'s text (hard check, no judgment needed)
  - every fact resolves to a real property or job
  - access codes recovered on **≥80%** of the 869 jobs known to carry one
  - no extracted contact name matches a known anonymizer artifact
- **Validate — human, Part C**: writes `reports/extraction-sample.md` — 50 randomly sampled facts with their source snippets, for semantic review.
- **Halt if**: verbatim-snippet check fails on any row, or access recall is under 80%. Records the measured number either way.

### Task 10 — Property dossier read model
- **Action**: One query returning everything a call needs: history with dates, access facts, contacts and roles, balance, open policies, last visit, next visit. This is the call-open fetch.
- **Validate**: `pnpm test:dossier` — note payload within budget for every property; truncation is stated rather than silent; no anonymizer damage survives into spoken text; a foreign tenant sees nothing.
- **Latency target revised, with the measurement.** The original 50ms p95 is not reachable against a hosted database from a laptop: a bare `select 1` to this Supabase instance costs **~140ms of network**, which is the floor. Measured and fixed along the way:
  - `withTenant` cost 4 round trips (BEGIN, setup, query, COMMIT) ≈ 560ms before reading a row. Collapsing `set role` + `set_config` into one statement removed one.
  - `openCallConnection()` reserves and scopes a connection **once per call**, so each query is a single round trip (~138ms). A rejected shortcut is documented in the code: Supabase's pooler **silently ignores** `role` and `app.tenant_id` passed as connection startup parameters — queries then run unscoped as `postgres` with BYPASSRLS while appearing to work. The helper asserts its own scoping and refuses to return an unverified connection.
  - Dossier: **1001ms → 433ms**, paid once at call open while the greeting plays. Mid-call lookups are single queries at roughly the floor.

### Task 11 — Read tools and the two adapters
- **Action**: One file per tool — `resolve_property`, `get_service_history`, `get_access`, `get_contacts`, `get_job_status`, `get_balance`, `get_warranty_evidence`. Each exports name, description, input schema, handler. Registry auto-imports the directory. Both an MCP adapter and an in-process adapter.
- **Validate**: `pnpm test:tools`

### Task 12 — Agent loop and refusal boundaries
- **Action**: AI SDK multi-step on `MODEL_AGENT`, dossier front-loaded at call open, parallel tool calls enabled, hard 3-step cap plus wall-clock deadline. Refusal boundaries encoded as behaviour: no install quoting, no warranty verdicts, no distance or ETA claims, no door code without verification, handoff after two failed attempts at the same question.
- **Validate**: `pnpm test:boundaries` — the red-team set must fail to elicit any of the five.
- **Halt if**: any boundary is breached.

### Task 13 — Deploy and make the number ring
- **Action**: Deploy the tool webhook and agent server to the `PUBLIC_URL` target. Every request verifies `VAPI_WEBHOOK_SECRET` before touching the database — an unauthenticated endpoint here leaks door codes for 869 properties. Create the Vapi assistant programmatically: system prompt, the seven read tools pointed at our endpoint, first message, and the Florida all-party recording announcement. Attach it to `VAPI_PHONE_NUMBER_ID`.
- **Validate**: `pnpm test:phone`
  - the deployed endpoint rejects a request with no secret and accepts one with it
  - a synthetic Vapi tool-call payload returns a correct, cited answer for a known property
  - the assistant is attached to the number and reports ready
  - if `TEST_PHONE_NUMBER` is set, place one outbound call, then assert the returned transcript contains the known answer
- **Halt if**: the endpoint answers without a valid secret, or the assistant is not attached to the number.

### Task 14 — The test layers
- **Action**: Replay harness over the 1,878 jobs with notes, scoring service type, urgency and access recall against what the office actually did, judged by `MODEL_JUDGE`. Cruel-case suite from the 18-unit address, the 51 near-identical street pairs, the invoice-number collisions. Red-team set targeting the five boundaries, door-code disclosure as headline.
- **Validate**: `pnpm test:replay && pnpm test:cruel && pnpm test:redteam`
- **Halt if**: **wrong-record rate is anything but zero.** This is the milestone gate.

### Task 15 — Morning report
- **Action**: Write `reports/overnight.md` — tasks completed, each validation's measured numbers, spend used, extraction recall achieved, replay scores, anything that halted and why.
- **Validate**: file exists and every completed task has a measured number, not a checkmark.

---

# Part C — Morning (you, ~15 minutes)

1. **Dial the number.** It should already be live. Ask three questions with known answers from the dataset — a repeat address's last visit, an access code, a job's status. Confirm each answer is correct and cited.
2. **Read `reports/overnight.md`.** Measured numbers, not green ticks. Note the latency figures — if the call felt slow, `MODEL_AGENT` is one environment variable away from a direct provider.
3. **Review `reports/extraction-sample.md`.** 50 facts with their source snippets. You're checking meaning; the machine already proved the snippets are real. If more than a handful are wrong, that's an extractor prompt fix and a re-run of that one extractor — not a rebuild.
4. **Try to break it.** Ask it to quote a system replacement, confirm a warranty, and read you a door code. All three should refuse.

---

## Patterns to Mirror

The application is greenfield — **no existing TypeScript, schema, or test suite** to mirror. Stating that rather than inventing conventions. The EDA layer's conventions do apply to ingest, derivation and assertions:

| Category | Source | Pattern |
|---|---|---|
| Module purpose | `eda/scripts/dq_common.py:1` | Docstring names the artifact the module serves. Carry forward: every extractor states which requirement it serves. |
| Shared loaders | `eda/scripts/sched_load_jobs.py:1-12` | One loader per domain, constants at module top (`DATA`, `TZ`). |
| Defensive access | `eda/scripts/sched_load_jobs.py:24-28` | `j.get("schedule") or {}` even where the schema is uniform. |
| Ordered steps | `eda/scripts/01_shape.py` … `10_phonetic.py` | Numbered, independently runnable. |
| Timezone discipline | `eda/scripts/sched_load_jobs.py:12` | `TZ` applied at load, never at read. |
| Explicit field mapping | `eda/scripts/sched_load_jobs.py:29-45` | Enumerate every field so a source change fails loudly. |

## Files to Change

| File | Action | Why |
|---|---|---|
| `package.json`, `tsconfig.json`, `.env.example` | CREATE | Root; scripts referenced above |
| `scripts/preflight.ts` | CREATE | Part A verification table |
| `scripts/overnight.ts` | CREATE | Sequencer, checkpointing, spend guard, halt logic |
| `src/config.ts` | CREATE | Hoisted constants — data paths, `TZ`, tenant id, model roles |
| `src/models/index.ts` | CREATE | The only module that touches a provider SDK |
| `src/db/schema/*.ts`, `src/db/migrations/` | CREATE | One file per table; `tenant_id` + RLS throughout |
| `src/pipeline/load/jsonl.ts` | CREATE | JSONL → `raw_record` |
| `src/pipeline/derive/01_property.sql` … | CREATE | Numbered derivations |
| `src/pipeline/assert/*.sql` | CREATE | EDA findings as zero-row queries |
| `src/pipeline/scrub/anonymizer.ts` | CREATE | Runs before any extractor |
| `src/pipeline/extract/_runner.ts` + one file per fact type | CREATE | Schema, prompt, version, provenance |
| `src/domain/address.ts`, `src/domain/resolve-property.ts` | CREATE | Normalizer and ranked resolver |
| `src/read/property-dossier.ts` | CREATE | The call-open fetch |
| `src/tools/*.ts`, `src/adapters/{mcp,agent}.ts` | CREATE | One tool per file; two surfaces |
| `src/agent/loop.ts`, `src/agent/prompt.ts` | CREATE | Multi-step, 3-step cap, boundaries |
| `src/server/vapi.ts` | CREATE | Tool webhook; secret verified before any DB access |
| `scripts/provision-vapi.ts` | CREATE | Creates the assistant, attaches it to the number |
| `vercel.json` | CREATE | Deploy config for the public webhook |
| `tests/{replay,cruel,redteam}/` | CREATE | Layers 1, 3, 5 |

## Validation

Introduced by this plan; none exist yet.

```bash
pnpm preflight                          # Part A gate
pnpm run overnight                      # Part B, resumable
# individually:
pnpm db:migrate && pnpm db:check-rls    # Task 1
pnpm test:models                        # Task 2
pnpm pipeline:load && pnpm test:counts  # Task 3
pnpm test:assert                        # Task 4
pnpm test:derived                       # Task 5
pnpm test:address && pnpm test:resolve  # Tasks 6–7
pnpm test:scrub                         # Task 8
pnpm pipeline:extract && pnpm test:extract-integrity  # Task 9
pnpm test:dossier && pnpm test:tools    # Tasks 10–11
pnpm test:boundaries                    # Task 12
pnpm deploy && pnpm test:phone          # Task 13
pnpm test:replay && pnpm test:cruel && pnpm test:redteam  # Task 14
```

**Milestone gate**: `pnpm test:cruel` reports zero wrong-record incidents, and a real call answers three known questions correctly with citations.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Unattended run burns budget on a loop | Medium | Hard spend limit set on the OpenRouter key in A2, plus a pre-task budget check that halts under a floor. Belt and braces, because this is the one failure that costs real money while you sleep. |
| A gate fails at task 4 and eight hours are wasted | Medium | Halts immediately rather than continuing. The checkpoint file means a morning fix resumes rather than restarts. Assertions run early precisely so failures are cheap. |
| Extraction is semantically wrong but passes machine checks | Medium | The verbatim-snippet check proves a fact came from real text, not that it means what we think. That's why 50 rows are sampled for you and why every fact keeps its snippet — a wrong answer stays traceable. |
| Corrupted notes feed false facts into extraction | High | Task 8 halts the run if scrubbing fails, and it runs before task 9 by design. |
| OpenRouter adds latency the live call can't afford | Medium | Accepted deliberately. `MODEL_AGENT` is one env var — if the call feels slow, point that role at a direct provider without touching code. Measure it in Part C before deciding. |
| Model slugs drift and a role stops resolving | Medium | Preflight resolves all three before the run starts, so this fails at 30 minutes rather than at 3am. |
| Resolver over-confidently returns one candidate | Medium | The return type is a list plus confidence. Task 13 targets exactly this. |
| Scope drifts into booking because read-only feels incomplete | Medium | No write path exists in this milestone. Booking in a diff belongs to milestone 2. |
| **The webhook is left unauthenticated and leaks customer data** | Medium | The endpoint holds door codes for 869 properties behind a URL Vapi must reach. Secret verification is the first line of the handler and task 13 halts if an unauthenticated request is ever answered. This is the single worst thing that can go wrong overnight. |
| The number rings but the webhook is unreachable, so it answers with nothing | Medium | Deployed to a public host rather than tunnelled from a sleeping laptop. Task 13 verifies with a synthetic tool-call payload and, if a test number is given, a real outbound call. |
| Vapi tool-call payload shape differs from what we built against | Medium | Task 13 tests against a synthetic payload before any real call, so this surfaces in the run rather than on the demo. |
| The 80% access-recall floor is unreachable | Low | It's a target from the data, not a measurement. If the first pass misses, the run halts with the measured number recorded — it never silently passes. |

## Acceptance

- [ ] Part A preflight all green
- [ ] Tasks 1–15 complete, or halted with a recorded reason
- [ ] **Wrong-record rate is zero** on the cruel-case suite
- [ ] **The number is live and answers when dialled** — three known questions, correct and cited
- [ ] The tool webhook rejects any request without a valid secret
- [ ] Extraction sample reviewed; access recall ≥80% and the measured figure recorded
- [ ] No write path exists — nothing in this milestone modifies the business record
- [ ] `tenant_id` and RLS on every table
- [ ] No geography column and no distance or ETA capability anywhere
- [ ] Every model call routes through `src/models/index.ts`
- [ ] Patterns mirrored from `eda/scripts/`, not reinvented

---
*Status: AWAITING CONFIRMATION — no code written.*
