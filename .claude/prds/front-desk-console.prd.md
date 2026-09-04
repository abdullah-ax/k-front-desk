# The console the office actually runs on

*Milestone 3 of the Gulf Breeze Air front desk. Milestones 1 (grounded answers) and 2 (write path, call record, screens) are shipped and gated.*

## Problem

The agent works and nobody would want to use it. A turn that needs no tools at all takes **8.1 seconds**, which on a phone is a caller saying "hello?" into silence. And the screens that supervise it read as a set of separate web pages rather than one application: a centred document column, card panels with rounded corners and drop shadows, thirteen rows visible where twenty-three would fit, and no way to find a record without knowing which tab it lives behind.

Both halves fail the same person. The office manager cannot let a slow agent take calls, and cannot supervise it from a screen that makes them hunt. Until a caller stops noticing the pause and a dispatcher stops hunting, none of the work underneath gets used.

## Evidence

**The agent is slow, and it is the model.** Measured against the live system, not estimated:

| | measured |
|---|---|
| Model, time to first token | **6,569 ms** |
| Tool webhook round trip | 470 ms (140 ms of it the database) |
| Property dossier at call open | 1,729 ms (hidden under the greeting) |
| A turn needing no tools at all | **8,118 ms** for a 53-character reply |

The model is 94% of the pause. Everything else is rounding error beside it. The cause is a choice made for the wrong reason: `deepseek-v4-flash` was picked for extraction quality and cost, then reused for live conversation. It is a reasoning model, so it spends seconds on thinking tokens before emitting a visible character. The ledger already recorded this shape once, when an 8-token cap starved it into returning an empty string.

**A 16× improvement is available and cost is not the trade.** Fourteen tool-capable models benchmarked on the real system prompt with a real dossier loaded, measuring time to first token because the voice provider speaks as tokens arrive:

| model | ttft | total | tools | $/call | $/month at 9 calls/day |
|---|---|---|---|---|---|
| `ministral-8b-2512` | **397 ms** | 1,603 ms | 4/4 | $0.0097 | $2.62 |
| `claude-haiku-4.5` | 911 ms | 2,760 ms | 4/4 | $0.0804 | $21.70 |
| `gpt-4.1-mini` | 1,145 ms | 2,464 ms | 4/4 | $0.0243 | $6.56 |
| `gpt-5.4-nano` | 1,472 ms | 3,879 ms | 4/4 | $0.0171 | $4.62 |
| `gemini-2.5-flash-lite` | 436 ms | 579 ms | **2/4** | $0.0050 | $1.35 |
| `deepseek-v4-flash` (now) | 6,569 ms | 11,383 ms | 3/4 | $0.0056 | $1.51 |

The whole spread is $2.62 to $21.70 a month. Speed and cost are not in tension at this volume; the cheapest qualifying model is also the fastest. What speed **is** in tension with is tool reliability: Gemini is the fastest thing measured and consistently fails to call `handoff` when refusing a price, which is a gated boundary. Fast and quietly non-compliant is worse than slow.

**The whole voice stack is swappable, and the extra hop is removable.** Probed against the live account: Vapi accepts Deepgram `nova-3`, keyterm boosting, the `numerals` flag, AssemblyAI, Speechmatics, Gladia, Soniox, Cartesia, ElevenLabs Flash, Rime, `startSpeakingPlan`/`stopSpeakingPlan` endpointing tuning, smart endpointing, and OpenAI Realtime. It talks to OpenAI, Google and Anthropic **natively**, so OpenRouter can leave the call path entirely — one less hop per turn. The benchmark above ran through OpenRouter, so those numbers are an upper bound.

**The screens read as web pages, and the cause is structural.** From a review of the current markup: a centred `max-width` column rather than a filled viewport; every region wrapped in a card with a 14px radius, a 1px border **and** a 30px-blur shadow; pill-shaped navigation, buttons and tags; twelve font sizes including five below the 12px floor every published design system sets; a decorative status dot animating whether or not anything is live; centred empty states. At the current row height the queue shows **13 rows where 23 would fit**. Left nav is what every serious operational console uses — Linear, Grafana, Datadog, Retool, Stripe, Sentry, and Vercel, which migrated *to* one in 2026. None uses a top nav for primary navigation.

**The job is lookup, and no product in the category has a keyboard.** A dispatcher does an estimated **50 to 100 lookups a day** — who is this caller, what is the address, is there history here, what is the gate code, who is nearest. It is the atomic unit of the work and it appears in no vendor's feature list. Against that: searched across all six products, **the only keyboard shortcut documented anywhere is ServiceTitan's `/`, and it navigates between screens rather than records.** No command palette exists in the category. Housecall Pro's search help tells the user to *"check spelling"* when a search fails, which is a search product asking the human to do its work.

**A dispatcher does not build a route in the morning; they hold a queue and release one job at a time.** From practitioners: *"One at a time... Never know what calls will come in and where they are located and also when a tech will hit a snag."* The board is a decision surface, not a plan. And at 15 technicians this company sits exactly at the ratio where one person can dispatch — *"1 dispatcher could handle 15 to 20 techs, but you got to have someone else adding the schedule stuff."* **The software absorbing data entry is what decides whether one person is enough.**

**Structured handoff is measured, and the measurement is unusually clean.** I-PASS, a five-slot structured clinical handoff, across 9 hospitals and 10,740 admissions: **23% relative reduction in medical errors** and **30% reduction in preventable adverse events**, with **no added time** (2.4 to 2.5 minutes per patient, p=0.55). Structure, not length, produced the gain. Its fifth slot, **synthesis by the receiver** — a mandatory read-back — has no analogue in any software product surveyed.

**The interruption budget is small and known.** Resumption lag after an interruption is roughly **4 seconds**; cues presented during the interruption only help if the warning arrives **6 to 8 seconds** ahead; full recovery takes about **15 seconds**. And **76% of situation-awareness failures are perception failures** — the fact was not on screen — rather than misinterpretation. That argues for rendering the case file *before* the human accepts, which exactly one product in the study does.

**Both field-service voice agents do cold transfers with no case file at all.** ServiceTitan forwards to a configured number; Housecall Pro *"send[s] the call to a number of your choice."* The receiving human gets a ringing phone. Their supervision surface is a review queue *after* the fact. Meanwhile 96% of customer-experience leaders believe their handoff preserves context and **83% of consumers say they repeat themselves after exactly that transfer**.

**One pattern to avoid, on vendor evidence: the docked AI panel.** Zendesk built a dedicated Intelligence panel and then **deleted it**, redistributing every capability to where agents already look. Embed at the point of use; do not build a corner for the machine.

**Dispatchers complain about three things, in every product, for twenty years.** From vendor help centres, community forums and review sites across Housecall Pro, ServiceTitan, Jobber, Workiz, Service Fusion and FieldEdge: **staleness, drag imprecision, and click count.** Housecall Pro's own docs concede its mobile schedule "auto-refreshes only once a minute" and "users must manually reload the screen to see newly created jobs." ServiceTitan ships a manual Refresh button and tells dispatchers to click it in each window. Jobber's own community thread is titled "Found the alpha schedule supremely laggy." A Workiz App Store review: *"If I need to reschedule a job to another day, it often takes several, sometimes 10 or more attempts before the new date is saved."*

**Four patterns from the category solve problems this build already has**, and they are worth naming because each is cheap and each maps onto something currently unsolved here:

- **Provenance that the machine respects.** ServiceTitan marks any appointment its scheduler placed with a lightning bolt, and a **lock** appears the moment a human edits it, after which the machine stops moving it. This build shows `byAgent` and `agentLive` on a block and has no equivalent of the lock. It also shows honest staleness rather than a stale number: after a manual move, the drive-time estimate reads *"N/A until it's recalculated"* instead of lying quietly.
- **A block that encodes the promise and the work separately.** Service Fusion renders the **white portion as the arrival window and the shaded portion as the estimated duration**, in one bar. Half of this company's arrivals land 44 minutes late; a block that draws the promise next to the work makes overrun visible without computing anything. The schema already carries `arrival_window_min` and does not use it.
- **A third work state we do not have.** Jobber distinguishes **scheduled** (date and time), **anytime** (date, no time) and **unscheduled** (neither). Housecall Pro users complain specifically that "anytime" is missing. Sixty percent of this company's work is same-day, which is exactly the population that wants a date without a promised hour.
- **A queue defined by missing fields rather than workflow status.** Service Fusion's tabs are structural: no date, no technician. Their docs are explicit that a job can be "dispatched" and still sit in Unscheduled. Nothing can hide behind a status that way. Our Catch up queues are already derived this way and should stay that way.

**And nobody solves the thing this company actually needs.** No product in the category predicts cascade delay — none warns, at the moment of a drop, that this move makes a later job unreachable. Half of this company's arrivals already run 44 minutes late. ServiceTitan gets closest with named **Late** and **Running Over** alerts, and even those are reactive.

**The published evidence cannot settle the speech stack, and that is the finding.** Independent research across the 2026 STT field returned contradictions rather than a winner:

- Two reputable benchmarks rank the same engines in **opposite order**. Deepgram `nova-3` is 1.62% on one and 6.59% on another; ElevenLabs Scribe v2 Realtime is 3.12% and 3.59%. Neither is wrong; they measure different metrics on different audio.
- **Identical Whisper Large v3 weights score 10.06% on one host and 4.07% on another.** A 2.5x spread from deployment alone dwarfs every model difference anyone is arguing about.
- **No independent 8 kHz telephony benchmark exists in 2026.** Both major benchmarks are hard-coded to 16 kHz. The model this build runs, `nova-2`, has never had a published word error rate of any kind.
- Vendor telephony numbers, where they exist, are brutal and inconsistent: one vendor measures 19.0% on phone calls against 1.5-6.5% on clean audio; a telephony corpus puts every engine between 33.9% and 55.2%.
- The most useful telephony finding is a failure mode rather than a mean: on short backchannel turns, engines do not degrade gradually, they **hallucinate entirely** — several score 100% error on a single short utterance. For a phone agent, that matters more than any average.

Deepgram's real case is latency, not accuracy: 64 ms to first partial against 134-168 ms for the more accurate engines, at a tenth of the price. That is a defensible trade, but it is a different trade from the one we thought we had made.

**Endpointing is the best-evidenced win available, and it is not a trade at all.** Two independent conversational corpora agree that the median **pause within one speaker's turn (0.51 s) is LONGER than the median gap between speakers (0.38 s)**. No fixed silence threshold can separate those two distributions, which is why silence-based detection needs roughly 1,600 ms to stop cutting people off. A learned turn detector, measured on 39 live users, cut median response from **2.7 s to 1.5 s while simultaneously cutting interruptions from 16.6% to 6.9%** — both directions at once, which almost nothing in this system does. A field deployment replicated it: 2.14 s to 1.15 s.

**Our exact failure is the median case, not an edge case.** A caller saying "twenty-four... eleven... Sigma Drive" is an intra-turn pause, the distribution above. Benchmarked on an explicit "incomplete utterance" state, one turn-detection model scores **62%** and another **97.67%** — a 35-point spread precisely where this company's callers live, since addresses and job numbers are most of what they say. A targeted search found **no published work at all** on number and address dictation with endpointing. Nobody has studied our problem.

**Keyterm boosting cannot simply be pointed at our 1,327 addresses.** Vendors document the ceiling and the reason: one states plainly that a large phrase list *"degrades non-adaptation terms"*, and the measured curve shows boosted-word error rising from 5.7% to 7.3% as the list grows from 100 to 2,000 entries. Every vendor's cap lands in the same band with the same warning; the guidance is "the most important 20-50 terms." One engine offers a free-text context field instead, reporting **-21% word error and -49% name-entity error across 20,000 real voice-agent calls** — where you can write the instruction directly, in words.

**Handoff today is a line of text in a queue.** The operator gets no screen-pop, no case file, and nothing that lets them take a live call without asking the caller to repeat themselves. That is the one moment where the agent hands a human a problem, and it is the least designed moment in the product.

**Every board in the category is a technician axis crossed with a time axis, and the only open question is which one is vertical.** ServiceTitan, Service Fusion and Workiz put technicians on rows and hours on a horizontal axis. Housecall Pro and Jobber's day view put technicians in columns and hours running down. The choice is not taste, it is arithmetic, and at fifteen technicians it is already decided. In this console the main column at a 1440px viewport is 892px wide after the 196px sidebar and the 352px right column; a 148px name gutter leaves a 744px lane. Fifteen technician **columns** in 744px is 49.6px each — narrower than the 13px rendering of "Felix Fitzgerald" (106px), so the column layout cannot label its own axis, and every technician added past fifteen has to arrive by horizontal scroll, which is the sticky-header failure class every one of these products ships with. Fifteen technician **rows** cost 34px each out of a 763px vertical budget at a 900px viewport. Twenty-two lanes fit. Rows are the answer here for the same reason the queue is a list: the crew grows and the day does not.

**A one-hour job at this width holds seven characters, and one of the things that does not fit is the time.** The lane divided by a fixed 8:00a–8:00p axis, at 13px system text averaging 6.6px per character with 12px of horizontal padding:

| viewport | lane | px/hour | 60-min block | characters it holds | 45-min block |
|---|---|---|---|---|---|
| 1280 | 584 | 48.7 | 48.7px | 5 | 36.5px — **below the 40px text floor** |
| 1366 | 670 | 55.8 | 55.8px | 6 | 41.9px |
| **1440** | **744** | **62.0** | **62.0px** | **7** | 46.5px |
| 1600 | 904 | 75.3 | 75.3px | 9 | 56.5px |
| 1728 | 1032 | 86.0 | 86.0px | 11 | 64.5px |

"9:00a" is five of the seven characters a one-hour block holds at 1440. The axis already says the time; spending 71% of the label on it leaves nothing to identify the job. This is also what kills the current "30 days" range button on a board: thirty days is 360 hours in 744px, or 2.07px per hour, so a one-hour job is two pixels. The ten-day book belongs in the table, which is what the table is good at.

**The width of a block is the one number this data cannot supply.** The prototype's fifteen job types carry no recorded duration anywhere in the schema, and milestone-scope already quotes ServiceTitan's warning that a job type with blank duration will "massively overbook." Inventing fifteen durations to draw the right edge, then disclosing the invention in a tooltip, is the stale-number failure milestone 6 exists to prevent — with the added problem that the cascade warning, the row-packing algorithm and any density figure would all be computed from it. `arrival_window_min` is real, it is in the schema, and it is unused. The left edge of a block is a booked fact; the right edge should be the promise or a measured elapsed time, and nothing else.

**Naming a job by its customer does not work in a book that is 66% property managers.** Nineteen of the 29 jobs belong to Starfish, Whitecap, Osprey, Tidewater or Lighthouse Hospitality, so taking the last word of the customer name — the ordinary surname rule — prints "Hospitality" on 19 of 29 blocks and distinguishes none of them. The database-wide figure behind this is already recorded: 54% of jobs come from property managers. The token that discriminates at 7 characters is the first word of the account or the street number, not the last word and not an invented type code.

**Fifteen lanes are mostly blank on nine days out of ten.** Seven technicians appear anywhere in this book. Sixteen rows at 34px is 544px of board; on day 0, eight rows carry work and eight are empty, and on day 7 one row carries work and fifteen do not — 94% of the board is nothing. Against that, "who has a hole at 5:00p" is one question asked a few times a day, and the p95 day is 21 jobs against the 11 this board is being verified on. A layout tuned on the easy day and padded with lanes that never fill is measuring the wrong thing in both directions.

**The rationing rule fails first on the board, and it fails by accumulation.** A first full specification of this board — one hue per meaning, four coloured objects claimed — resolved on audit to roughly eleven: a rust now-line, a rust rail on the unassigned lane, a rust count in the pressing rail, the rust live dot, an amber overrun hatch, an amber overrun figure, amber cascade notches, an amber clock, an amber staleness word, and blue provenance caps, with a solid rust P1 chip forty pixels below a board that had rationed rust to one hairline. No single decision was wrong; each condition asked for one mark and got it. The count has to be taken on the rendered screen, per day, not in the specification.

**The full-redraw architecture that makes this console cheap is the same architecture that produces the drag complaints already quoted.** Sixteen rows and 29 blocks is roughly 45 nodes; rebuilding them on a pointer-move event destroys the node under the cursor, so the replacement never receives the `mouseenter` its predecessor was holding and the hover state strands. The same mechanism has a visible cost today: removing an element from the document **cancels its CSS animation**, and the live-call dot is rebuilt on every redraw — at five keystrokes a second in the filter field, a 1.3s blink never completes a cycle and reads as solid on. That is the one visual constraint the console has, defeated by its own render loop. Full redraw is correct for state transitions and wrong for anything at pointer or timer rate, and the split has to be structural: `draw()` for state, held node references for gestures, and one element that is built once and never removed.

**A minute is not a refresh rate.** Housecall Pro's own docs conceding a once-a-minute schedule refresh is already in evidence above; a 60-second redraw tick on this board reproduces it exactly, against a stated staleness target of 2.5 seconds, on a surface where the voice agent files tickets while the manager is mid-call. The now line moves 1.1px per minute at 1440 — it does not need a clock, it needs to move when anything else does.

**The common open-source layout algorithms split a lane for jobs that do not actually overlap.** React-big-calendar treats two events beginning within a configurable minimum start difference as concurrent and halves their width; the same class of rule is why back-to-back stops render as a double-booking in several of these products. On this data a strict integer test — the next job starts at or after the previous one's scheduled end — packs every technician on every day into a single lane, and the row rhythm stays at 34px for the whole book. The exception is worth protecting: if a lane ever doubles, that doubling should mean a genuine double-booking and nothing else.

**Four full-screen layouts were built and measured rather than argued about.** The milestone above says "regions rather than cards, 23 rows where 13 fit today" and did not say which arrangement gets there. Four were built with identical content — a 25-job day, the recorded maximum rather than the 11-job day the board was verified on — and the geometry measured off the rendered DOM at 1440x900:

| | lane | px/hour | characters in a 1-hour block | rows that fit (16 needed) |
|---|---|---|---|---|
| Today's app | 744px | 62 | 7 | 13 |
| A · icon rail + board + 340px dock | **900px** | 75 | 9 | **23** |
| B · labelled rail + pressing strip, agent behind a tab | 1084px | 90 | 11 | 18 |
| C · three panes, nothing behind a tab | 680px | 57 | **6** | 23 |
| D · icon rail + full-width board + 224px bottom deck | **1240px** | 103 | 13 | 17 |

Two things the table settles. **C is narrower than what exists today** — six characters against seven — so "show everything at once" costs the board more than it gives back, and only turns positive at 1728px (10 characters), which is a dispatch monitor rather than the laptop this is checked from. And **B and D buy their width out of the vertical axis**, which is the axis the crew grows on: at 768px tall B drops to 14 rows and D to 13, so lanes scroll on a 15-technician company that already has 16 rows to draw. A is the only one that beats today on both axes at once, and it does it by spending less on chrome than the current app does — a 52px icon rail against a 196px sidebar, and a 340px dock against the 352px column already there.

**The current app reads as cards for five specific reasons, all of them measurable rather than aesthetic.** `main` is a centred column at `max-width:1600px` with 18-20px padding; every region is a `.panel` carrying a 14px radius, a 1px border *and* a 30px-blur shadow; the desk grid uses an 18px `gap`; body text is 15px; and the active navigation item is painted `--agent-wash`. That last one is not a layout problem but a rule leak — it spends the agent's reserved hue on "which screen am I on", and once blue means navigation it stops meaning the agent on a job block. Fixed ahead of the layout work, along with a second instance on selected rows.


## Users

- **Primary, the office manager.** On the phone most of the day, one hand occupied. Triggers: a call arrives, the agent escalates, a technician runs late, a customer asks a question about a property. Needs to find any record in seconds, see what the agent is doing without reading a trace, and take over a live call cold.
- **Primary, the caller.** Does not know or care that there is an agent. Triggers: something is broken and they want a person or an answer. Needs the pause after they stop speaking to be short enough that they do not check whether the line is dead.
- **Secondary, the owner.** Checks in from a phone. Needs to know whether today is going badly and whether the agent has earned more autonomy.
- **Secondary, whoever tunes the agent.** Needs to compare one voice stack against another on real calls with real numbers, rather than by ear.
- **Not for:** technicians in the field as a primary surface, bookkeepers, or end customers.

## Hypothesis

We believe **a voice stack chosen on measured latency and swappable under measurement, behind a console built as one dense keyboard-driven application with a real handoff case file**, will **make the agent something the office leaves switched on and works alongside, rather than something it supervises suspiciously** for **the office manager and the caller**.

We'll know we're right when **the caller's perceived pause is under 1.5 seconds at p95, a dispatcher can reach any record in under three seconds without a mouse, and a human can take a handed-off call and speak competently within five seconds of the screen-pop.**

## Success Metrics

| Metric | Target | How measured |
|---|---|---|
| Perceived pause, caller stops speaking to agent starts speaking | **p50 under 900 ms, p95 under 1,500 ms** | Recorded per turn on real calls, from the endpointing timestamp to first audio byte |
| Model time to first token | p95 under 700 ms | Per turn, stored on the call record |
| Caller cut off mid-utterance | Under 7% of turns | Counted from recordings: agent speech starting while the caller was mid-sentence |
| House number heard correctly | 95% exact match | 30 of our own recordings replayed through the shipped engine, scored against what was actually said |
| Turns with a spoken filler covering a tool call | 100% of turns where a tool exceeds 500 ms | Counted; silence over 800 ms with no audio is a defect |
| Tool-call reliability of the shipped stack | 19/19 red team, 0 mechanical breaches over 24 boundary runs | The existing gates, re-run per stack |
| Stack comparison | Any two stacks comparable on the same seven numbers from real calls | Per-call metrics stored: endpoint lag, STT final, TTFT, TTFB, tool time, total turn, cost |
| Time to find any record | **Under 3 seconds, keyboard only** | Timed on a fixed list of twelve lookups a dispatcher does daily |
| Rows visible without scrolling, 900px viewport | **23 or more** | Counted on the queue and call list |
| Handoff to competent human speech | **Under 5 seconds** from screen-pop | Timed: read-aloud test, someone who was not listening takes the call |
| Time to context, on a transferred call | Measured at all | A one-click read-back on the case file timestamps whether the human consumed it before speaking. No vendor or academic study measures this today, so the instrument has to be built to have the number |
| Escalation reason present and specific | 100%, from a closed list | Counted. A free-text reason, or a reason cleared when the state changes, both count as absent |
| Board staleness | Under 2.5 s, and never stale without saying so | Timestamp comparison; a degraded connection must show itself |
| Drag accuracy | A drop lands where released, 20/20 | Manual, because every competitor fails this and their users say so |
| AI-slop checklist | Zero of 22 named tells present | Mechanical review against the checklist |

## Scope

**MVP**

- **A voice stack chosen on measurement**, not on what was convenient: model, STT, TTS and endpointing each selected against numbers, with the provider reached natively rather than through an extra hop.
- **Switchable stacks.** A named stack is a set of choices across STT, LLM, TTS and turn-taking. Any stack can be made live, and every call records which stack answered it and what each layer cost in milliseconds, so two stacks can be compared on real calls rather than by ear.
- **Latency work that is not the model, done first.** Turn detection tuned rather than defaulted, in a stated order: reduce the fixed wait, add rules for the utterances that actually get cut off, then move off silence-based detection entirely. A spoken filler whenever a tool call runs long. The dossier fetched off the critical path, and the trace written without blocking the reply.
- **An STT decision made on our own audio.** Thirty recorded calls from this number, replayed through three engines and scored on exact-match house numbers, unit numbers and job references. This is the decision mechanism, not a supplement to one: the published evidence contradicts itself, no telephony benchmark exists, and the current engine has never had a published number.
- **One application, not a set of pages.** A filled viewport with persistent left navigation, regions rather than cards, a density that shows 23 rows, six type sizes rather than twelve, and none of the 22 named visual tells.
- **A dispatcher can work.** Global search and a command palette reaching every record and every action; keyboard navigation through lists and the board; a drop that lands where released; state that survives the back button.
- **The handoff arrives as a case file.** A screen-pop that does not steal focus or destroy what the operator was doing, carrying who is calling, which property, what has been said, what the agent already promised, what it refused and why, and the two or three facts needed to continue the sentence.
- **The test line is the demo.** The real stack in a browser, professional enough to hand to someone else.

**Out of scope**

- **Speech-to-speech as the shipped path.** Under evaluation, not committed. The agent must produce a full auditable text trace and enforce refusals that are currently gated; until that is proven under a realtime model, cascaded stays.
- **Predictive cascade-delay warnings.** The clearest gap in the whole category and genuinely wanted, but it needs a duration model this data cannot yet support. Named as a later milestone rather than smuggled into this one.
- **Route optimisation and anything map-based.** 87.6% of stored coordinates plot in the Atlantic Ocean. Unchanged from milestone 1 and unchanged by any amount of UI work.
- **Multi-user accounts and permissions.** Still one shared link behind one passphrase. Still a stated trade.
- **A technician mobile app.**
- **Invoicing, payments, price-book editing.** Housecall Pro keeps these.
- **AI auto-dispatch.** ServiceTitan re-optimises every ten minutes, simulates hundreds of scenarios, and still needs the dispatcher for every state transition; their own guidance is to pull back to assist mode when override rates rise. At 9 to 25 jobs a day the human is faster. Build the board that makes them fast.
- **Numeric confidence scores on the handoff card.** Only one vendor surfaces confidence at all, and only as high/medium/low. Their better idea is to **fail closed**: when confidence is low, show nothing rather than a number nobody can calibrate.
- **A dedicated AI panel or drawer**, on the evidence above.
- **A second calendar product beside the board.** ServiceTitan ships both, they behave differently, and users complain that one drags and the other does not.
- **Capacity planning, shifts, time-off as scheduling objects.** ServiceTitan's own documentation warns that a technician without an active shift "does not exist to the dispatch algorithm" and that a job type with blank duration will "massively overbook." That is a system worth building carefully later, not quickly now.

## Delivery Milestones

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | The agent stops interrupting and stops stalling | Turn detection is tuned before anything else is touched, because it is the only change measured to cut response time and interruptions at once. A caller pausing mid-address is no longer cut off. | in-progress | - |
| 1b | The pause goes away | A caller stops speaking and the agent begins within 1.5 s at p95. The model is chosen on measured time to first token, reached natively, and every gate is re-run against whatever is chosen. | in-progress | - |
| 1c | The address is heard correctly | "Twenty-four eleven" resolves to 2411. Decided by replaying our own recordings through candidate engines and scoring exact-match house numbers, not by vendor benchmarks. | in-progress | - |
| 2 | Any stack, measured on real calls | A stack is a named, switchable set of choices across STT, LLM, TTS and turn-taking. Every call records which stack answered and what each layer cost, so two stacks are comparable on evidence rather than impression. | pending | - |
| 3 | It looks and behaves like one application | A filled viewport with persistent navigation, regions rather than cards, 23 rows where 13 fit today, and none of the 22 named visual tells. State survives navigation. | complete | - |
| 4 | A dispatcher can work without a mouse | Any record reachable in under three seconds by keyboard. A command palette that holds every action. Drags that land where released. Lists that do not move under the cursor. | pending | - |
| 4b | The jobs area is a board, not a table | The whole crew and the whole day are on one screen at 900px with no scrollbar in either direction: technician lanes against a fixed hour axis, one block per job, 34px rows. A block's left edge is a booked fact and its width is the promised arrival window, never an invented duration. An empty lane draws nothing and is the answer to who takes the next call. The table survives as the one view that spans the ten-day book, and clicking a row in it lands on that day's board with the job already selected. | complete | - |
| 5 | The handoff is a case file, not a queue row | An escalation renders five fixed slots in a persistent header before the human accepts: who and where with access facts inline, why it escalated as a value from a closed list, what the agent already did and ruled out, what is unresolved, and one recommended action. A person who was not listening can take the call within five seconds, and acknowledges that they read it. | pending | - |
| 6 | The agent's work is legible on the board | What the agent did, is doing, and cannot do is visible where the work is, with provenance separated from urgency so a late agent-booked job reads as both. A human edit marks the job as the human's and the agent stops moving it. Where a number is stale, the board says so rather than showing it. | pending | - |

## Open Questions

- [x] **Is nine jobs a day company-wide or per technician?** Company-wide, confirmed against the database: 188 scheduled days, median 9, mean 10.1, p95 21, maximum 25. The research flagged this as an assumption that would invert several of its rankings if wrong. It is not wrong, which means the volume genuinely does not justify routing or auto-dispatch.
- [ ] **Which model actually ships.** The benchmark ranks candidates on speed and a four-sample tool screen; it does not judge refusals. The shortlist must face 19 red-team cases and 24 boundary runs before anything answers a call, and the ranking may not survive that. TBD, needs the gates run per candidate.
- [ ] **Is the fastest stack the best stack?** `gemini-2.5-flash-lite` completes an entire turn in 579 ms and fails a gated boundary. TBD, needs a decision rule for how much latency a boundary is worth, stated before the numbers are in rather than after.
- [x] **Does endpointing matter more than the model?** ANSWERED, and it does. It is the only measured change that cuts response time and interruptions simultaneously (2.7 s to 1.5 s, 16.6% to 6.9%). It moves ahead of the model swap in the milestone order.
- [ ] **Which STT engine, and is it decided on our audio or theirs?** DECIDED on ours. What is still open is which engines make the shortlist and what the pass mark is. Note the constraint: recordings are enabled but this number has taken very few real calls, so the thirty recordings mostly have to be **made** before they can be replayed. TBD, needs a scripted recording session before the comparison can run.
- [ ] **Does the fix for "twenty-four eleven" live in the engine or downstream?** Three candidate mechanisms exist: an entity formatter that renders spoken cardinals as digits, a free-text context instruction, and resolver-side handling of digit-group ambiguity. TBD, and the answer may be all three, since nobody has published on this failure mode at all.
- [ ] **Which 20 to 50 terms get boosted.** Boosting all 1,327 addresses is measurably worse than boosting none. The budget is roughly 50 terms, so the question is which: street-name stems, HVAC vocabulary, technician names, or the terms of the caller's own account injected per call. TBD, needs the recordings to say what is actually misheard.
- [ ] **What goes in each of the five slots.** The structure is settled by the evidence; the contents are not. Slot two in particular needs a closed list of escalation reasons for this business, and it should separate caller-initiated from policy-initiated from **agent-failure**, which is the distinction one vendor makes and everyone else omits. TBD, needs a read-aloud test with someone who was not on the call.
- [ ] **Does the property record need a unit entity?** No product in the category has one; the best of them tells you to name locations "Building - Apartment A". 54% of jobs here come from property managers and 1,259 notes name a specific floor or unit. A four-level model (account, property, unit, equipment) fits the data better than the two-level one every vendor ships. TBD, and it is a schema change rather than a screen change.
- [ ] **Does the board draw the promise separately from the work?** `arrival_window_min` exists in the schema and is unused. Drawing the arrival window and the estimated duration as one two-tone block would make overrun visible at a glance on a book where half of arrivals run 44 minutes late. TBD, and it interacts with whether we ever promise a window out loud on a call.
- [ ] **Is "anytime" a state worth adding?** A date without a promised hour fits 60% same-day work and is the single most-requested missing state in the incumbent product. It also complicates every board layout that positions by time. TBD.
- [ ] **How much of the console gets rebuilt versus restyled.** The diagnosis is structural — a centred column and card panels — which argues for rebuilding the shell. The screens inside it may survive. TBD, and the answer changes the size of milestone 3 considerably.
- [ ] **Whether speech-to-speech is ready.** OpenAI Realtime is accepted by the account today. Whether it can enforce the refusals and produce the trace this build gates on is unknown. TBD, needs a spike, and it stays out of scope until that spike answers.

- [ ] **What is the width of a block when nobody recorded a duration?** Three candidate rules: the arrival window from `arrival_window_min`, a fixed nominal width per block regardless of type, or measured elapsed time for anything in progress and the window for everything else. TBD, and the method is to render all three against the same eleven-job day and count how many blocks change width by more than fifteen minutes between them. If the answer is "most of them," the board is drawing a number it does not have.
- [ ] **Does the hour axis end at the last shift or at the last job?** A fixed 8:00a–8:00p axis is stable between days, which is the property that makes two days comparable, but it spends 17% of the lane on the 6:00p–8:00p band that holds 2 of the 29 jobs — and it draws fifteen lanes of apparent availability at 6:30pm for a crew whose shifts this system does not model. Capacity and shifts are explicitly out of scope, so the board must not assert them. TBD, needs a decision on whether after-hours is drawn as ordinary lane space, as a marked region, or not at all.
- [ ] **How many technicians does the board draw, and is an empty lane information?** Seven technicians appear in the book; the company has fifteen. Fifteen open lanes is 94% blank on the quietest day. The alternative is one collapsed row — `no jobs today · Boothe, Salas, Okonjo, +5` — that expands on click and costs 34px instead of 272px. TBD, and the method is the 5:00p release task timed both ways: fifteen open lanes against seven plus a collapsed row.
- [ ] **Where does an unassigned same-day job sit before it has a time?** Sixty percent of this work is same-day, and a call that lands at 11:40 has neither a technician nor an hour. A board that positions everything by scheduled hour cannot draw the majority of what arrives during the day. Docking unscheduled work at the left edge of row zero is the same shape as the "anytime" question already open above and probably has the same answer. TBD, and it needs the database queried for how many jobs got their time at booking versus later.
- [ ] **Does the status filter remove blocks from the board or dim them?** Filtering to Scheduled hides the completed and in-progress work and leaves holes that are not holes, on the one surface whose purpose is finding real gaps. Removing is dangerous rather than merely useless. TBD, and the test is the gap-finding task run against a filtered board with a planted trap.
- [ ] **One placement path or two?** The success metric above says *a drop lands where released, 20/20*, which is a drag test. A click-to-place path is keyboard-reachable and cannot fail that metric because nothing is released — which is not passing the test, it is changing it. If placement ships as click-to-place, the metric is rewritten before the build, not after. TBD.
- [ ] **Does row order ever change?** Sorting lanes by first job of the day puts Felix second today and first on day 9, and freezes a morning artefact by 3pm. Alphabetical never moves and never encodes anything. TBD, and the method is time-to-find-a-named-technician measured across two consecutive days under both orders.

- [ ] **Which of the four layouts ships?** A is recommended on the measurement — the only one that beats today's board on both width and rows at 1440x900 — but the choice is the owner's and the artifact exists to make it with the numbers visible rather than from a description. The follow-on question is whether A's dock collapses to a tab when nothing is pressing, which would let it borrow B's width on a quiet day without giving up the glanceability that makes A worth picking.
- [ ] **Does the 25-job day change the row budget conclusion?** The layouts were measured against the recorded maximum rather than a median day, which is the right stress case, but the 34px row and 16-row floor assume the crew stays at 15. The floor moves the day a sixteenth technician is hired, and A has 7 rows of headroom at 900px tall against D's 1.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The fast model fails the boundaries and the safe model is slow | Medium | High. It is the central trade of milestone 1 | Gates run per candidate before anything ships; the decision rule is written before the numbers arrive |
| Switching the model quietly changes behaviour with no error | **High. It has already happened twice** | High | Parity is already gated by `pnpm test:phone`; a stack switch must re-run the gates, and a stack that has not passed cannot be made live |
| Latency work moves the pause somewhere unmeasured | Medium | Medium. Endpointing and TTS start are both invisible today | Per-call timing on every layer is milestone 2, and it lands before the tuning it justifies |
| An STT engine is chosen on a vendor benchmark and is worse on our audio | **High if we skip the replay** | High. Wrong house number is the wrong-record failure this build exists to prevent | The replay on our own recordings is the decision mechanism, not a check afterwards. No engine ships on a published number |
| Keyterm boosting is pointed at the whole address book and makes accuracy worse | Medium | Medium, and it would look like an improvement while being a regression | The budget is capped at the vendor-documented band and validated against the same replay set, in both directions |
| A console rebuild breaks screens that currently work | Medium | High | The read models and the API are unchanged; the rebuild is the shell and the presentation, and the demo suite runs against the API rather than the UI |
| Density becomes illegibility | Medium | Medium | 13px body and 32px rows are taken from published productive-scale specs, not invented; 11px is the floor and nothing goes below it |
| The screen-pop becomes the thing that ruins the demo | Medium | High. An operator mid-drag with a phone to their ear cannot have focus stolen | It is a strip, never a modal; it never takes focus; exactly two interruption tiers exist and a third means demoting something |
| Keyboard navigation ships half-built and nobody uses it | Medium | Medium | A fixed list of twelve daily lookups is the acceptance test, timed, rather than a feature checklist |
| Cost runs away while nobody is watching | Low | High | Unchanged: a hard cap on the key, budget asserted before any unattended model work, and per-call cost now recorded per stack |
| Research is treated as permission to build all of it | Medium | Medium | Three quarters of what the research found is explicitly out of scope above. The category's own documentation is a list of things that took ten years and still frustrate their users |
| The board draws a duration nobody recorded, and the invented number then feeds the row packing, the overrun mark and any density figure | **High if durations are invented at all** | High. It is the stale-number failure milestone 6 exists to prevent, with the fabrication one layer deeper than the surface that discloses it | The block's right edge comes from `arrival_window_min` or from measured elapsed time. No derived duration table ships, and nothing on the board is computed from one |
| The full-redraw loop fights every pointer-rate and timer-rate interaction, reproducing the drag and staleness complaints already quoted from the category | **High. The live dot's blink is already defeated by it today** | High. Drag accuracy and board staleness are both stated metrics | `draw()` handles state transitions only; hover, selection and drag mutate held node references; the blinking dot is built once at startup and never removed; the board redraws on data change rather than on a 60-second tick |
| Colour accumulates one honest mark at a time until the rationing rule is dead | **High. The first full board specification reached eleven coloured objects against a budget of four** | Medium, and it degrades the one channel that carries urgency | The count is taken on the rendered screen, per day, as part of the 22-tell review, and a new coloured object requires deleting one |
| The board is verified on the easy day | Medium | High. Today is 11 jobs against a recorded p95 of 21 and a maximum of 25, and same-day work lands in the unassigned lane during the day | The vertical budget and the row packing are re-run against a synthetic 25-job day with a full unassigned lane before the layout is accepted |
| A second board view becomes a second calendar product | Medium | Medium. The PRD already rules out a second calendar beside the board, on the evidence that ServiceTitan's two behave differently and users complain | Two views only, Board and List. List is the table already built. A week grid at this volume is 24 of 112 cells carrying a number, which is a worse table than the table |
| Fifteen anonymous lanes answer "who takes this one" confidently and wrongly | Medium | Medium. The prototype's own ticket dispatches on `skills` returning `{HVAC, plumbing}`, and compressor, duct replacement and faucet rebuild are not interchangeable | The gutter carries one discriminating token beside the name, chosen by measurement rather than by what fits; if nothing can be shown honestly, the board does not imply availability it cannot verify |

---
*Status: DRAFT, requirements only. Implementation planning pending via /plan.*