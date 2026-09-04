# Front Desk — Voice Agent and Operating Platform

## Problem

Gulf Breeze Air is a 14-tech HVAC company in Miami whose phone is answered by a booking bot that takes a name and a time slot and nothing else. It cannot tell a caller when the company was last at their address, whether their equipment is under warranty, or move an appointment — and it leaves no record of what it promised. The bot's own jobs cancel at **77.5%** against an 11.3% baseline, so it is not merely unhelpful: it is actively destroying booked work.

The deeper cause is that everything this business knows is written in prose. Door codes, warranty determinations, part arrival dates, standing customer rules — none of it has a field to live in, so no software they own can answer with it. Leaving this unsolved means the office manager remains the single point of failure for every question, and work that isn't urgent keeps falling out of memory: **$157,462** of completed jobs were never invoiced and **$66,787** of invoices were never sent in a six-month window.

## Evidence

Drawn from a scripted analysis of the company's own six-month export — 1,992 jobs, 6,954 notes, 1,700 invoices, 732 customers, 1,390 addresses. Behavioral evidence, not recalled opinion.

- **The incumbent is measurably harmful.** 40 jobs booked under its identifier; 31 canceled (77.5%) vs. 11.3% for all other jobs.
- **It leaves no trail.** All 89 of its call notes terminate at a literal `Call transcript:` header with nothing after it.
- **History is the modal question.** 63.9% of jobs occur at an address the company has already visited; median gap between visits is 16 days; 19.4% of jobs contain language referring back to a prior visit.
- **The knowledge is trapped in prose.** 1,159 notes carry entry instructions; 46.4% of jobs require a door or gate code that exists in no field. 65.9% of noted jobs name a specific floor or unit.
- **Warranty is unanswerable today.** 282 jobs discuss it; every determination was made by a human phoning a distributor; 91% concern equipment with no install record anywhere in the system.
- **Identity is fragile.** Address plus unit identifies a caller 95.3% of the time; a last name 7.9%; a company name 0.0%. One street address holds 18 units under 18 different customers.
- **Owner's words, from the brief:** *"it can't tell a customer when we were last out there, it can't tell them if they're under warranty, it can't move an appointment, I have no idea what it promised anyone, and it's pretty slow."*
- **The office already wants this artifact.** 132 jobs carry a semi-automated post-visit summary marked `REVIEW BEFORE INVOICING`, and 89 hand-written call logs follow a consistent structure including what explicitly did *not* change.
- **Assumption — needs validation via prototype:** that voice is the right channel; that the office will trust agent-originated writes; that callers accept an automated answerer at all. The data proves the problem. It does not prove this solution.

## Users

- **Primary (buyer): the owner and the office manager.** A 14-tech shop with one person who "lives on the phone." They decide whether the system stays. Their trigger is any moment work falls through or a caller asks something only the office manager knows.
- **Primary (user): the caller.** A homeowner whose upstairs is frozen; a property manager with guests checking in at 4pm — property managers are 14.6% of customers but 53.8% of jobs and 66.3% of all after-hours work; a technician asking what was done last time at an address.
- **Not for:** technicians as a primary workflow surface (field app is a separate product), and not for customers of HVAC companies generally — this serves the office, not the homeowner directly.

## Hypothesis

We believe **an agent that answers from the business's own record, takes action inside the platform, and shows its work in real time** will **replace an intake bot that captures nothing, answers nothing, and is trusted by no one** for **the office that runs on it and the callers who reach it**.

We'll know we're right when **a call ends with all three legs present — an answer grounded in a cited record, an action that landed in the platform, and a complete inspectable trail — with zero instances of the agent acting on the wrong customer or property.**

The loop matters more than any single capability. *Know → do → show* is the same shape for the first phone call as it is for the twelfth office workflow, which is why it is the thing worth building around and the thing that scales.

## Success Metrics

Ordered. The first is a gate: nothing else counts until it holds.

| Metric | Target | How measured |
|---|---|---|
| **Wrong-record rate** (gate) | **Zero** | Every call where identity was resolved, audited against the record acted on. Plus an adversarial suite built from known traps: the 18-unit address, 51 near-identical street pairs, invoice numbers where one misheard digit hits a real different invoice 70% of the time. |
| **Closed-loop rate** (primary) | TBD — establish baseline in milestone 3 | Share of calls ending with a grounded answer, a landed action, and a complete trail. Requires a written definition of "grounded" — see Open Questions. |
| **Containment rate** (coverage) | TBD — measure before targeting | Share of calls resolved without a human. Deliberately not a launch target; a bot that refuses to hand off would score well and be worse. |
| Head-to-head capture | Beat the incumbent on all 89 of its calls | Replay the incumbent's own call set; compare fields captured and outcomes booked. Baseline already exists in the data. |
| Handoff rate by reason | No target — shape is the signal | Where the agent repeatedly stops is the roadmap, written by real callers. |
| Correction rate per workflow | Falls before any autonomy increase | How often a human edits an agent draft. This is the promotion signal, not confidence. |

## Scope

**MVP** — A dialable phone number where an agent answers questions from the company's own six months of history, books and reschedules work that appears on the office screen before the caller hangs up, and records every call so it can be watched live and replayed afterward.

Four legs, all required to test the hypothesis:
1. **Answer** — history, access, status, balance, who's coming, grounded in a citable record.
2. **Act** — book and reschedule, with the constraints the business actually has.
3. **Observe** — a live view showing what was said, what the agent concluded, what it asked the system, and what changed in it.
4. **Replay** — any past call re-watchable at real speed, which is also the audit feature the owner asked for.

**Out of scope**

- **Quoting installs, replacements, or new construction** — 41% of revenue sits in items priced fewer than five times; new construction averages $27,316 per job. No defensible quote can be produced, now or later. Hand off, permanently.
- **Yes/no warranty determinations** — no equipment record, install date, or coverage field exists anywhere in the source data. The agent surfaces evidence and captures missing details; it never decides.
- **Routing, ETA, and "who is closest"** — 87.6% of stored coordinates plot in the Atlantic Ocean. Any distance-based feature would return a confident wrong answer with no error.
- **Discounts** — present on 21.4% of invoices, ranging 2% to 100%, negotiated by humans with no derivable rule.
- **Outbound calling** (suppliers, customers, warranty verification) — deferred, not rejected.
- **Spanish-language handling** — deferred. One note in 6,954 is in Spanish, so the historical data gives no signal, but a Miami phone line will receive Spanish calls. Flagged as a known gap, not a solved problem.

**Deliberately not locked out:** two-way sync with the incumbent field-service software. Out of the MVP, but a candidate milestone rather than a permanent exclusion — see Open Questions.

## Delivery Milestones

<!-- Business outcomes, not engineering tasks. /plan turns each into a plan. -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Grounded answers | A caller on a real phone number gets correct answers about their own property's history, access, and status — every answer traceable to a record. | in-progress | `.claude/plans/front-desk.plan.md` |
| 2 | Actions that land | Bookings and reschedules complete during the call and appear on the office screen before the caller hangs up, respecting real crew and skill constraints. | pending | — |
| 3 | Visible trail | Every call is watchable live and replayable afterward, including what the agent promised and what it changed. Baselines for the primary metric are set here. | pending | — |
| 4 | Work stops falling through | The first office queue — completed-but-unbilled and written-but-unsent work — is surfaced with an owner and a deadline. Proves this is a platform, not a phone wrapper. | pending | — |
| 5 | A second company | Another HVAC company is onboarded as an import, with no code changes. Proves this is a product, not a project. | pending | — |
| 6 | Measured autonomy | At least one workflow moves from draft-and-approve to act-with-review, promoted on measured correction rate rather than judgment. | pending | — |

Milestones 1–3 constitute the MVP.

## Open Questions

- [ ] **What exactly counts as "grounded"?** The primary metric is unmeasurable until this is written down. Does a cited note snippet suffice, or must the agent name the date and source? Needs definition before milestone 3.
- [ ] **Who is allowed to hear a door code?** The system will hold entry codes for 869 properties. This is a security boundary with no current policy, and it is unclear whether it can be resolved by caller verification alone.
- [ ] **Will the office trust agent writes?** Unvalidated. They accept AI drafts today behind a review gate (132 jobs), which suggests a starting posture but not an endpoint.
- [ ] **Is the 77.5% cancel rate caused by bad booking or by bot rejection?** The data cannot separate them. If callers are abandoning because it is a bot, a better bot has a lower ceiling than assumed.
- [ ] **Two-way sync with the incumbent software — later milestone or permanent exclusion?** Not in MVP either way. Affects whether the platform is the system of record or a companion to one.
- [ ] **Who is the buyer — this company, or companies like it?** Changes whether milestone 5 is a proof point or the actual product.
- [ ] **What is the acceptable latency floor before a caller prefers voicemail?** No baseline exists. Assumed, not measured.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Agent reads the wrong customer's information aloud | Medium | Severe — unrecoverable trust loss | Never act on a single identifier. Read back a second attribute before acting. Adversarial suite targeting zero, built from the known ambiguities in the data. |
| Corrupted source text produces confident false facts | High | High | 11.1% of notes were damaged by the anonymizer — phone numbers became person names, common words became company names. Known patterns must be scrubbed and every derived fact must retain its source text for verification. |
| Office does not trust agent-originated writes and turns it off | Medium | High | Begin at draft-and-approve. Increase autonomy only where the correction rate has fallen and held. |
| Latency makes the agent feel worse than the incumbent | Medium | High | The complaint list already ends with "it's pretty slow." Any capability that cannot answer inside a conversational turn must be moved off the critical path or handed off. |
| Warranty questions dominate calls and cannot be answered | High | Medium | Reframe the deliverable as evidence plus capture. Measure how often the agent successfully captures brand, model and serial — currently present on 2.1% of jobs. |
| Evaluators judge the phone call and undervalue the platform | Medium | Medium | Lead with work landing on the screen during the call, and with the queue that recovers $224,249 of found money. |
| Scope drifts toward the twelve office workflows before the loop is proven on one | Medium | Medium | Milestones 1–3 are the gate. Milestone 4 is deliberately a single queue. |
| Property managers behave differently enough to break assumptions built on homeowners | Medium | Medium | They are 53.8% of jobs, 66.3% of after-hours work, and often are not the person on site. Test cases must be drawn from their calls specifically, not the average call. |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
