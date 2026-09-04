# Seeing the agent think

*Milestone 2a of the Gulf Breeze Air front desk. It sits in front of the platform PRD's Milestone 3 ("The call is visible") and raises the bar it has to clear.*

## Problem

The agent is answering live calls from the company's own records and its reasoning is scattered across three surfaces that are not joined to each other. The words live in the voice provider's dashboard. The tool traffic lives in serverless function logs. The model's deliberation and the SQL it caused live nowhere at all. Nothing is queryable by phone number, address or job number, so the office cannot answer "why did it say that" and the owner cannot tell a correct answer from a lucky one.

The cost is not abstract. An agent nobody can inspect is an agent nobody extends. Every capability after this one, and every hour already spent on grounding, is gated on somebody being able to look inside a call and see the whole chain: what was said, what was thought, what was asked of the database, what came back, and which verbatim sentence in which note the answer rests on.

## Evidence

- **An audit of the current build, layer by layer.** Caller and agent words: captured. Tool name and arguments: captured, because every invocation crosses our own webhook. Tool return value: produced but not durably written down. Which property was resolved and on what evidence: partly, and only inside a payload rather than a call-scoped record. Model reasoning: not captured. SQL executed: not captured.
- **There is no call record at all.** The database has raw, work, billing, parties, facts and ops layers. Ops holds pipeline runs and migrations, not call telemetry. The database connection is opened per call and released at end of call, so the *lifecycle* is already call-scoped, but the *record* is not.
- **Invisibility has already cost time on this build.** A reasoning model returned an empty string because its token budget was spent on thinking tokens before a visible character was emitted. That was invisible in every log surface and only found by reproducing it by hand. The same class of failure on a customer call would be silent.
- **The incumbent bot failed in exactly this shape.** All 89 of its call notes stop at the words "Call transcript:" with nothing after them. Of the 40 jobs it booked, 31 were canceled, 77.5% against 11.3% for every other job. An agent nobody can audit produces bookings nobody trusts.
- **Owner, verbatim:** "I have no idea what it promised anyone."
- **The counter-pressure is real and it is a safety constraint, not a nicety.** The redaction that keeps entry codes out of the agent's context does not currently cover a log. Entry codes exist for 869 properties. A tool-result log would be a new surface holding all of them, so it has to be redacted before it is stored or observability becomes the leak.

## Users

- **Primary, the office manager.** Trigger: a customer says "your robot told me Tuesday", or an answer sounded wrong. Needs to open the call and see the chain in about ten seconds, without knowing what a tool call is.
- **Primary, the owner.** Trigger: deciding whether the agent can be trusted with more. Needs to see where it keeps failing and on what evidence it resolved a caller to a property, because giving one customer's information to another is the failure that ends the pilot.
- **Secondary, whoever is extending the agent.** Trigger: a wrong answer, a slow turn, an empty reply. Needs the reasoning, the queries, their timings and their row counts in one place, because the three failures already hit on this build were each invisible in the surface that should have shown them.
- **Not for:** end customers, technicians in the field, or anyone outside the office. The record contains balances, contact facts and the presence of entry codes.

## Hypothesis

We believe **one durable record per call that holds every turn, every decision, every query and every fact check, rendered live while the call is happening and openable forever after** will **turn the agent from something the office has to take on faith into something it can inspect** for **the office manager and the owner**.

We'll know we're right when **a person who was not on the call can open it and correctly explain, in under a minute and without reading code, why the agent said what it said, and what it looked at to decide.**

## Success Metrics

| Metric | Target | How measured |
|---|---|---|
| Turn visible while the call is still connected | Under 1s from spoken to on screen | Timestamp on the stored turn against the render, across the rehearsal calls |
| Tool calls carrying arguments, redacted result, duration and row count | 100% | Counted directly against the call record. A tool call missing any of the four is a failed gate |
| Stated facts linked to a verbatim source | 100% of claims drawn from notes | Every fact rendered on screen resolves to a snippet that appears verbatim in its note, which is already an enforced property of the fact store |
| Secrets in the stored record | 0 | The existing secret gates re-run against the log surface, not just the agent's context. This gates the build |
| A call found by phone number, address or job number | Under 10s, one search | Timed on the rehearsal set |
| Explainability, unassisted | A person not on the call explains the agent's decision correctly | Read-aloud test on 5 recorded calls with someone who has not seen the code |
| Added latency on a voice turn | Under 50ms | Turn timing with and without the record being written |

## Scope

**MVP** to make one call completely legible, live and afterwards:

- **One record per call**, holding the caller, how they were identified, when it started and ended, how it ended, and every event in order.
- **Every turn**, caller and agent, in the order spoken, with timings.
- **Every decision**, meaning the model's reasoning where the provider returns it, and where it does not, the decision trace stated as a decision trace and labelled as such rather than dressed up as reasoning.
- **Every tool call**, with its arguments, how long it took, a redacted summary of what it returned, and how many rows that was.
- **Every query**, meaning the statements a tool actually ran, their duration and their row counts, so the path is visible below the tool boundary and not only above it.
- **Every fact check**, meaning each claim the agent stated linked to the verbatim sentence and the note it came from, so a listener can confirm the answer came from the record rather than the model.
- **Refusals and handoffs as first-class events**, with the reason, including when the deterministic safety backstop fires rather than the model choosing.
- **Redaction before storage**, applied to the log surface itself and proved by a gate, so the observability record can never hold an entry code.
- **One screen for live and for done**, streaming a call in progress and opening any past call, searchable by phone number, address or job number.

**Out of scope**

- **Token-level probabilities, logits, or model internals.** Not available through the provider, and not what "why did it say that" means to an office manager.
- **Storing call audio ourselves.** The voice provider already keeps the recording. Duplicating it buys nothing and doubles the surface holding customer voices.
- **A third-party tracing or APM vendor.** The record has to be queryable next to the jobs it changed. A separate observability product puts it back in a second place, which is the problem being solved.
- **Cost and token accounting per call.** Useful, not load-bearing for the trust decision, and cheap to add later once events exist.
- **Retention and deletion policy.** Named as an open question below rather than decided here.
- **Alerting on patterns across calls.** Handoffs grouped by reason is enough for now; anomaly detection needs a baseline nobody has yet.

## Delivery Milestones

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | One record per call | Every call leaves a durable, ordered record of turns, tool calls, results and timings, written on the connection the call already holds. The three scattered log surfaces become one. | complete | migration 0003, `src/calls/record.ts` |
| 2 | Observability cannot leak | The stored record is redacted before it is written, and a gate proves no entry code, no code-shaped value and no internal audit metadata reaches it. Nothing else ships until this holds. | complete | `src/security/redact.ts`, `pnpm test:redaction` |
| 3 | The query path is visible | Each tool call carries the statements it ran, their duration and their row counts, so a slow or empty answer can be traced below the tool boundary. | complete | `src/calls/trace.ts` |
| 4 | Why, not just what | Model reasoning is captured where the provider returns it. Where it does not, the decision trace is shown and labelled as a decision trace, never presented as thinking the model did not report. | complete | measured: the provider does return it |
| 5 | The fact check is on screen | Every claim the agent made links to the verbatim sentence and the note behind it, so an answer can be confirmed without trusting the model. | complete | `findProofs` in `src/calls/session.ts` |
| 6 | Live and done in one place | A call in progress streams onto the screen as it happens, any past call opens in the same view, and both are searchable by phone number, address or job number. | complete | Calls screen, `src/read/calls.ts` |

## Open Questions

- [x] **Does the provider actually return reasoning for the chosen model through the interface we use?** ANSWERED, and the answer is yes. Measured on a live turn: the model returned "The property resolved to 8504 E Old Mangrove Rd, Palmetto Bay, with property_id=7844. The caller is Starfish Hospitality - that's a management company..." Reasoning is stored as `reasoning`; the reconstructed fallback is stored as `decision` and carries `reconstructed: true`, and the screen labels the two differently. Neither is ever shown as the other.
- [ ] **What does "fact check" mean for a claim not drawn from a single sentence?** A date computed from job history has no snippet. TBD, needs a rule that distinguishes a quoted fact from a derived one, and a way to show the derivation.
- [x] **How much query text is safe to store?** DECIDED: the statement is stored with its `$1, $2` placeholders intact and the parameter values are dropped. The shape is what explains a slow or empty answer; the values are already one layer up in the tool arguments, where they have been redacted. A gate asserts every stored statement still contains a placeholder and no address.
- [ ] **How long is a call record kept, and who can delete one?** STILL OPEN. "Kept forever, searchable" is the user story. Florida is an all-party consent state and the recording announcement is already made, but retention and deletion are unresolved. TBD, needs a decision before this is shown to a real customer's data.
- [x] **Does a live call need a push channel, or is a short poll enough for one screen?** DECIDED: a 2.5 second poll. One office, one screen, a handful of concurrent calls; a socket is more machinery for the same number, and it fails in more ways during a demo. Revisit if concurrent calls ever reach double figures.
- [x] **What happens to the record when a call ends badly?** ANSWERED by design: events are written as they happen rather than assembled at the end, so a dropped call leaves a partial record with `status = 'live'` rather than no record. A call that never receives an end-of-call report stays marked live, which is visible rather than silent.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The log becomes a fourth surface holding 869 entry codes | High if unaddressed | Severe. Observability becomes the breach | Redaction runs before storage, not on render, and a gate proves it. This is Milestone 2 and it blocks everything after it |
| Writing the record adds latency to a voice turn that has about two seconds in total | Medium | High. A slow agent is the owner's existing complaint | Under-50ms budget is a measured metric, not an aspiration. The record is written on the connection the call already holds rather than opening another |
| Reasoning tokens are large, and storing them per turn grows fast | Medium | Medium. Storage cost and slow reads on the Calls screen | Measure the real size on live calls before deciding whether to store in full, summarise, or store the first N |
| Capturing queries catches every query in the process, including bulk pipeline work | Medium | Medium. Noise buries the six queries that matter | Capture is scoped to the call, not global. A pipeline backfill must never appear in a call record |
| Reasoning is not actually returned, and the screen ends up showing a decision trace labelled as thinking | Medium | High. Overclaiming what the agent shows is worse than showing less | Open question above. The label on screen states which of the two it is, on every turn |
| A record that only completes on a clean hangup | Medium | Medium. The interesting calls are the ones that ended badly | Events are written as they happen rather than assembled at the end, so a dropped call leaves a partial record instead of none |
| The screen shows everything and therefore explains nothing | Medium | High. Six layers of trace can be less legible than a transcript | The explainability metric is a person who has not seen the code, not a checklist of captured fields. If they cannot explain the call, the screen has failed regardless of what it captured |

---
*Status: DRAFT, requirements only. Implementation planning pending via /plan.*
