/**
 * Replay — did it decide what the office decided
 * (.claude/plans/front-desk.plan.md, task 14).
 *
 * The unusual asset in this dataset: 1,878 jobs carry notes, and a note is a
 * decision with a known outcome. The office heard the same words, and then it
 * booked a service code, gave the job a date, and either recovered an entry
 * code or did not. That is ground truth nobody had to label.
 *
 * COST DISCIPLINE IS THE DESIGN CONSTRAINT HERE. Putting 1,878 jobs through
 * MODEL_JUDGE would eat the remaining budget in one run, so the suite is split:
 *
 *   Phase A — DETERMINISTIC, full set, zero model calls, zero dollars.
 *     Everything whose ground truth is mechanical is scored mechanically, over
 *     every job. The resolver is run directly; the extracted facts are read
 *     from the table. No judgement is involved and the numbers are exact.
 *
 *   Phase B — JUDGED, a stratified sample of at most 150.
 *     Only the dimensions that genuinely need reading comprehension — did the
 *     agent land on the same kind of work, the same urgency, did it act on the
 *     access instruction, did it invent anything. Sampled deterministically by
 *     md5(id) and stratified by service code, so two runs are comparable and a
 *     rare bucket is not sampled out of existence.
 *
 * The gate is Phase A's wrong-property count. Phase B is a measurement: it is
 * printed with its sample size and never silently rounded up.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateObject, type CoreMessage } from "ai";
import { z } from "zod";
import { ROOT, TZ, EXPORT_ANCHOR } from "../../src/config.js";
import { openCallConnection, closeDb, type Sql } from "../../src/db/client.js";
import { judgeModel, assertBudget, readBudget, slugFor } from "../../src/models/index.js";
import { runTurn } from "../../src/agent/loop.js";
import { FIRST_MESSAGE } from "../../src/agent/prompt.js";
import { loadTools } from "../../src/tools/_registry.js";
import { resolveProperty } from "../../src/domain/resolve-property.js";
import { getPropertyDossier, renderDossier } from "../../src/read/property-dossier.js";

// --- knobs -----------------------------------------------------------------

/** The Supabase pooler caps at ~15 session clients. Three is polite. */
const CONCURRENCY = 3;

/** Judged sample. The plan sets a hard ceiling of 150; this is under it. */
const SAMPLE_SIZE = Math.min(150, Number(process.env["REPLAY_SAMPLE"] ?? 100));

/** Set to 0 to skip phase B entirely and run the free half. */
const RUN_JUDGE = SAMPLE_SIZE > 0 && process.env["REPLAY_NO_JUDGE"] !== "1";

/**
 * The intake note. Notes are 1-indexed in this corpus — index 1 is what the
 * office wrote when it took the call, and 1,878 jobs have one.
 */
const INTAKE_INDEX = 1;

/**
 * Entry-instruction language in an intake note. Deliberately generous on
 * recall: this decides which jobs the access dimension is SCORED on, and a
 * miss here quietly shrinks the denominator, which flatters the number.
 */
const ACCESS_LANGUAGE =
  "(door|gate|lock ?box|building|entry|access|garage|elevator|call ?box|keypad)[^.\\n]{0,20}(code|combo|combination|pad)|code[^.\\n]{0,10}(is|:)|lock ?box";

// --- types -----------------------------------------------------------------

interface JobRow {
  job_id: string;
  property_id: string | null;
  street_raw: string | null;
  unit: string | null;
  service_code: string;
  description: string | null;
  work_status: string | null;
  same_day: boolean | null;
  note: string;
  note_has_access_language: boolean;
  access_facts: number;
}

interface PropertyOutcome {
  propertyId: string;
  street: string;
  unit: string | null;
  decision: string;
  gotId: string | null;
  correct: boolean;
  /** Resolved to a DIFFERENT property. The gate. */
  wrong: boolean;
  reason: string;
}

/** A case whose agent turn or judge call could not be completed. Counted, never hidden. */
interface FailedCase {
  jobId: string;
  error: string;
}

interface JudgedCase {
  jobId: string;
  serviceCode: string;
  sameDay: boolean | null;
  hasAccessLanguage: boolean;
  note: string;
  reply: string;
  toolCalls: string[];
  serviceMatch: boolean;
  urgencyMatch: boolean;
  accessHandled: boolean | null;
  noFabrication: boolean;
  reason: string;
  ms: number;
}

// --- helpers ---------------------------------------------------------------

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const text = `${String((err as { code?: unknown })?.code ?? "")} ${String((err as { message?: unknown })?.message ?? "")}`;
      // Phase A runs for minutes; the pooler quietly retires sockets underneath
      // the pool while it does, so phase B's first use of a stale one surfaces
      // as ETIMEDOUT, EPIPE, or postgres.js reading `write` off a null socket.
      // All of those are transient conditions, not answers.
      if (
        !/CONNECT_TIMEOUT|EMAXCONN|max clients reached|too many connections|ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|reading 'write'|CONNECTION_CLOSED|CONNECTION_ENDED|57P01|429|rate.?limit|overloaded/i.test(
          text,
        )
      ) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 400));
    }
  }
  throw last;
}

const pct = (n: number, d: number): string => (d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(1)}%`);

// --- data ------------------------------------------------------------------

/**
 * Every job with an intake note, plus the ground truth each dimension is
 * scored against. One query — the whole point of the derived columns.
 *
 * `same_day` is the office's urgency decision, read off the record rather than
 * inferred: the job was scheduled for the same calendar day it was created, in
 * America/New_York. Any other timezone shifts 53 jobs across a date boundary.
 */
async function loadJobs(sql: Sql): Promise<JobRow[]> {
  return sql<JobRow[]>`
    select j.id::text                                as job_id,
           j.property_id::text                       as property_id,
           p.street_raw,
           p.unit,
           coalesce(j.service_code, 'unknown')       as service_code,
           j.description,
           j.work_status,
           case when j.scheduled_start is null or j.created_at is null then null
                else (j.scheduled_start at time zone ${TZ})::date
                     = (j.created_at at time zone ${TZ})::date
           end                                       as same_day,
           n.content_scrubbed                        as note,
           (n.content_scrubbed ~* ${ACCESS_LANGUAGE}) as note_has_access_language,
           (select count(*)::int from extracted_fact f
             where f.source_note_id = n.id and f.fact_type = 'access') as access_facts
      from note n
      join job j       on j.id = n.job_id
      left join property p on p.id = j.property_id
     where n.note_index = ${INTAKE_INDEX}
       and n.content_scrubbed is not null
       and btrim(n.content_scrubbed) <> ''
     order by j.id`;
}

// --- phase A: deterministic ------------------------------------------------

/**
 * Did it identify the right property?
 *
 * Each distinct property behind a replayed job is fed its OWN address back —
 * the same thing a caller reading their address off a lease would say. Scored
 * three ways, and only one of them is a failure:
 *
 *   correct  resolved to itself
 *   safe     did not resolve (needs_unit / needs_more / not_found) — the agent
 *            asks another question, which is the designed behaviour at the
 *            eighteen-unit addresses and costs nothing but a turn
 *   WRONG    resolved to a different property. This is the milestone gate.
 */
async function scoreProperties(jobs: JobRow[]): Promise<PropertyOutcome[]> {
  const distinct = new Map<string, { street: string; unit: string | null }>();
  for (const j of jobs) {
    if (j.property_id && j.street_raw && j.street_raw.trim() !== "") {
      distinct.set(j.property_id, { street: j.street_raw, unit: j.unit });
    }
  }
  const entries = [...distinct.entries()];

  return pool(entries, CONCURRENCY, async ([propertyId, p]) => {
    const r = await withRetry(() => resolveProperty({ rawStreet: p.street, unit: p.unit }));
    const gotId = r.decision === "resolved" ? (r.candidates[0]?.id ?? null) : null;
    return {
      propertyId,
      street: p.street,
      unit: p.unit,
      decision: r.decision,
      gotId,
      correct: gotId === propertyId,
      wrong: r.decision === "resolved" && gotId !== propertyId,
      reason: r.reason,
    };
  });
}

// --- phase B: judged sample ------------------------------------------------

/**
 * Stratified by service code, deterministic by md5(job id). Stratifying matters
 * here: `warranty_callback` has 2 jobs in the whole corpus and a flat random
 * sample of 120 would miss it every time, hiding exactly the bucket most likely
 * to be mishandled.
 */
function stratify(jobs: JobRow[], size: number): JobRow[] {
  const buckets = new Map<string, JobRow[]>();
  for (const j of jobs) {
    const list = buckets.get(j.service_code);
    if (list) list.push(j);
    else buckets.set(j.service_code, [j]);
  }
  // md5(id), exactly as the plan specifies, so the sample is reproducible and
  // two runs are comparable — and so it can be reproduced in SQL by anyone
  // checking the result by hand.
  const digest = (id: string): string => createHash("md5").update(id).digest("hex");

  const codes = [...buckets.keys()].sort();
  const out: JobRow[] = [];
  // At least one from every bucket, then proportional on what is left.
  const remaining = Math.max(0, size - codes.length);
  for (const code of codes) {
    const list = buckets.get(code)!.slice().sort((a, b) => digest(a.job_id).localeCompare(digest(b.job_id)));
    const share = 1 + Math.floor((list.length / jobs.length) * remaining);
    out.push(...list.slice(0, Math.min(share, list.length)));
  }
  return out.sort((a, b) => digest(a.job_id).localeCompare(digest(b.job_id))).slice(0, size);
}

const Score = z.object({
  service_match: z.boolean().describe("the work the agent steered toward is the same kind of work the office booked"),
  urgency_match: z.boolean().describe("the agent treated it with the same urgency the office did"),
  access_handled: z.boolean().describe("the agent acknowledged the entry instruction — noted it, asked about it, or explained it cannot read a code out. False ONLY if it ignored the entry instruction entirely. Ignore this field when the note carries no entry instruction"),
  no_fabrication: z.boolean().describe("every fact the agent asserted appears in the intake note or in the record it was given. Reading the record back is NOT fabrication"),
  reason: z.string().describe("one sentence, naming the dimension that failed if any did"),
});

/**
 * The call as it stands the moment the office wrote the intake note: greeting
 * given, property already named and confirmed. Only then does the note land.
 *
 * Without this the measurement collapses into one behaviour. The agent is told
 * to confirm identity before reading anything back, so with a cold history it
 * answers almost every note with "what's the address?" — correct on a live
 * call, and useless for asking whether it steered the call the way the office
 * did. Identification is measured separately and exhaustively in phase A, over
 * every property, with no model and no judgement involved.
 *
 * The note itself is never touched.
 */
function identifyingTurns(j: JobRow): CoreMessage[] {
  const street = (j.street_raw ?? "").trim();
  if (street === "") return [{ role: "assistant", content: FIRST_MESSAGE }];
  const spoken = j.unit ? `${street}, unit ${j.unit}` : street;
  return [
    { role: "assistant", content: FIRST_MESSAGE },
    { role: "user", content: `It's ${spoken}.` },
    { role: "assistant", content: `Got it, ${spoken}. What's going on there?` },
  ];
}

/**
 * One judged case = one call, on its own connection.
 *
 * Not a shared one. Phase A runs for several minutes without touching a
 * reserved connection, and Supabase's pooler drops it out from under you — the
 * first phase-B query then dies inside postgres.js with "Cannot read properties
 * of null (reading 'write')", after the expensive half of the run has already
 * been paid for. Measured. One connection per replayed call also mirrors what
 * `openCallConnection` is actually for.
 */
async function judgeCase(j: JobRow, i: number): Promise<JudgedCase | FailedCase> {
  try {
    const conn = await withRetry(() => openCallConnection());
    try {
      return await runJudgedCase(conn.sql, j, i);
    } finally {
      await conn.release().catch(() => {});
    }
  } catch (err) {
    // One case that will not run is a data point, not a reason to throw away
    // ninety-five completed ones and the dollars they cost. It is counted and
    // printed; the denominators below only ever count cases that finished.
    return { jobId: j.job_id, error: String((err as { message?: unknown })?.message ?? err) };
  }
}

async function runJudgedCase(sql: Sql, j: JobRow, i: number): Promise<JudgedCase> {
  const started = Date.now();
  const dossier = j.property_id
    ? await withRetry(() => getPropertyDossier(Number(j.property_id), sql))
    : null;

  // The caller says what the office wrote down, VERBATIM — the note is not
  // paraphrased into a nicer utterance, because the point is to replay the real
  // input. It is preceded by the agent's own greeting so the note lands where a
  // caller's first sentence lands. Without that, a terse note like "LaGree Old"
  // reads as a document rather than a person talking and the agent answers with
  // a greeting, which measures the framing instead of the agent.
  //
  // The dossier is front-loaded because on a live call the property is already
  // resolved by this point. Scoring the agent on an identification it was never
  // asked to make would measure the wrong thing, and phase A measures
  // identification exactly, over every property, for free.
  const turn = await withRetry(() =>
    runTurn(j.note.trim(), {
      sql,
      callId: `replay-${j.job_id}-${i}`,
      dossier,
      history: identifyingTurns(j),
    }),
  );

  const { object } = await withRetry(() =>
    generateObject({
      model: judgeModel(),
      schema: Score,
      temperature: 0,
      // Explicit, not optional. Some providers reserve the WHOLE remaining
      // context for the completion when this is absent and then reject the
      // request as over-length — a judge slug swap should not take the suite
      // down. Four booleans and a sentence fit in far less than this.
      maxTokens: 400,
      system:
        "You are comparing a telephone agent's handling of an incoming service call against WHAT THE OFFICE ACTUALLY DID with the same call. " +
        "The office's decision is ground truth; you are not judging whether the office was right. " +
        "Be strict on fabrication and lenient on phrasing — the agent speaks in one or two sentences on a phone and is not expected to state a service code out loud. " +
        "Judge the DIRECTION the agent took the call, not its wording. " +
        "CRITICAL: you are shown the exact record the agent had in front of it. Anything it reads back OUT OF THAT RECORD — an address, a past visit date, a note, a balance, a cancellation — is quotation, not fabrication. " +
        "Score no_fabrication false only for a claim that is in NEITHER the intake note NOR the record. " +
      `TODAY IS ${EXPORT_ANCHOR.slice(0, 10)}. This company's service records run from 2026-03-02 to 2026-09-15 and there is nothing before that. ` +
        "A month named without a year — 'August nineteenth', 'back in June' — means 2026. Do not assume a past month means last year.",
      prompt: [
        "THE CALL SO FAR: the caller has already given the property address and the agent has confirmed it back. The note below is what they said next.",
        "",
        "THE RECORD THE AGENT WAS GIVEN (everything below was in its context):",
        dossier ? renderDossier(dossier) : "(no property was identified; the agent had no record at all)",
        "",
        "WHAT THE CALLER SAID (the office's own intake note):",
        j.note.trim(),
        "",
        "WHAT THE OFFICE ACTUALLY DID:",
        `  service booked : ${j.service_code}${j.description ? ` (price-book line: ${j.description})` : ""}`,
        `  urgency        : ${j.same_day === null ? "unknown" : j.same_day ? "same day" : "scheduled for a later day"}`,
        `  entry code in the note: ${j.note_has_access_language ? "yes" : "no"}`,
        "",
        "WHAT THE AGENT SAID:",
        turn.text || "(said nothing)",
        `TOOLS THE AGENT CALLED: ${turn.toolCalls.length ? turn.toolCalls.map((t) => t.name).join(", ") : "(none)"}`,
        "",
        "Score each dimension.",
      ].join("\n"),
    }),
  );

  return {
    jobId: j.job_id,
    serviceCode: j.service_code,
    sameDay: j.same_day,
    hasAccessLanguage: j.note_has_access_language,
    note: j.note.trim(),
    reply: turn.text,
    toolCalls: turn.toolCalls.map((t) => t.name),
    serviceMatch: object.service_match,
    urgencyMatch: object.urgency_match,
    accessHandled: j.note_has_access_language ? object.access_handled : null,
    noFabrication: object.no_fabrication,
    reason: object.reason,
    ms: Date.now() - started,
  };
}

// --- output ----------------------------------------------------------------

const ICON = { pass: "  ok  ", fail: " FAIL ", info: " info " } as const;

async function main(): Promise<number> {
  const started = Date.now();
  console.log("\n  Front Desk — replay against what the office decided (task 14)\n");

  const before = await assertBudget();
  console.log(`  agent  ${slugFor("MODEL_AGENT")}`);
  console.log(`  judge  ${slugFor("MODEL_JUDGE")}`);
  console.log(`  budget $${before.remaining?.toFixed(2) ?? "n/a"} remaining before this run\n`);

  await loadTools();

  let jobs: JobRow[];
  let properties: PropertyOutcome[];
  let judged: JudgedCase[] = [];
  let failures: FailedCase[] = [];
  let sample: JobRow[] = [];

  // Read the ground truth and hand the connection straight back. Phase A runs
  // for minutes on the pool and a connection held across it would be dead by
  // the time phase B wanted it.
  const conn = await openCallConnection();
  try {
    jobs = await loadJobs(conn.sql);
  } finally {
    await conn.release();
  }
  console.log(`  ${jobs.length.toLocaleString()} jobs carry an intake note (note_index ${INTAKE_INDEX}).\n`);

  // --- phase A ---------------------------------------------------------
  console.log("  Phase A — deterministic, full set, no model calls");
  properties = await scoreProperties(jobs);

  const wrongProps = properties.filter((p) => p.wrong);
  const correctProps = properties.filter((p) => p.correct).length;
  const safeProps = properties.filter((p) => !p.correct && !p.wrong).length;

  const accessSet = jobs.filter((j) => j.note_has_access_language);
  const accessRecovered = accessSet.filter((j) => j.access_facts > 0).length;

  const withUrgency = jobs.filter((j) => j.same_day !== null);
  const sameDay = withUrgency.filter((j) => j.same_day === true).length;

  const codes = [...new Set(jobs.map((j) => j.service_code))].sort();

  console.log(`   [${wrongProps.length === 0 ? ICON.pass : ICON.fail}] right property        ${pct(correctProps, properties.length)}  (${correctProps} of ${properties.length} properties resolved to themselves)`);
  console.log(`   [${ICON.info}] safely deferred       ${pct(safeProps, properties.length)}  (${safeProps} asked for a unit or more detail instead of guessing)`);
  console.log(`   [${wrongProps.length === 0 ? ICON.pass : ICON.fail}] WRONG property        ${wrongProps.length}   <- the milestone gate`);
  console.log(`   [${ICON.info}] access recovered      ${pct(accessRecovered, accessSet.length)}  (${accessRecovered} of ${accessSet.length} intake notes carrying entry-code language produced an access fact)`);
  console.log(`   [${ICON.info}] office urgency        ${pct(sameDay, withUrgency.length)} same-day  (${sameDay} of ${withUrgency.length} scored jobs)`);
  console.log(`   [${ICON.info}] service buckets       ${codes.length}: ${codes.join(", ")}`);
  console.log("");

  for (const p of wrongProps.slice(0, 20)) {
    console.log(`   · WRONG: "${p.street}"${p.unit ? ` unit ${p.unit}` : ""} (property ${p.propertyId}) resolved to ${p.gotId}`);
    console.log(`     ${p.reason}`);
  }
  if (wrongProps.length) console.log("");

  // --- phase B ---------------------------------------------------------
  //
  // Drop the pool first. Phase A held it open for minutes and Supabase retires
  // sockets on its side without telling ours; reusing one is a guaranteed
  // ETIMEDOUT on the first query of the expensive half of the run. Reopening
  // costs one handshake and is paid once.
  await closeDb();

  if (RUN_JUDGE) {
    sample = stratify(jobs, SAMPLE_SIZE);
    const dist = [...new Set(sample.map((s) => s.service_code))]
      .sort()
      .map((c) => `${c} ${sample.filter((s) => s.service_code === c).length}`)
      .join(", ");
    console.log(`  Phase B — judged, stratified sample of ${sample.length} of ${jobs.length} (${dist})`);
    const outcomes = await pool(sample, CONCURRENCY, (j, i) => judgeCase(j, i));
    judged = outcomes.filter((o): o is JudgedCase => !("error" in o));
    failures = outcomes.filter((o): o is FailedCase => "error" in o);
    if (failures.length) {
      console.log(
        `   [${ICON.fail}] ${failures.length} of ${sample.length} cases could not be completed and are excluded from every denominator below:`,
      );
      for (const f of failures.slice(0, 5)) console.log(`     job ${f.jobId}: ${f.error}`);
    }
  } else {
    console.log("  Phase B — skipped (REPLAY_NO_JUDGE=1)");
  }

  // OpenRouter's usage figure trails the requests that produced it.
  await new Promise((r) => setTimeout(r, 5000));
  const after = await readBudget();
  const spend = after.usage - before.usage;

  const n = judged.length;
  const accessScored = judged.filter((j) => j.accessHandled !== null);
  const dims = n === 0 ? null : {
    serviceMatch: judged.filter((j) => j.serviceMatch).length,
    urgencyMatch: judged.filter((j) => j.urgencyMatch).length,
    accessHandled: accessScored.filter((j) => j.accessHandled === true).length,
    accessScored: accessScored.length,
    noFabrication: judged.filter((j) => j.noFabrication).length,
  };

  if (dims) {
    console.log("");
    console.log(`  Judged accuracy — sample size ${n}${failures.length ? ` (${failures.length} of ${sample.length} could not be completed)` : ""}`);
    console.log(`   [${ICON.info}] service bucket        ${pct(dims.serviceMatch, n)}  (${dims.serviceMatch} of ${n})`);
    console.log(`   [${ICON.info}] urgency               ${pct(dims.urgencyMatch, n)}  (${dims.urgencyMatch} of ${n})`);
    console.log(`   [${ICON.info}] access acted on       ${pct(dims.accessHandled, dims.accessScored)}  (${dims.accessHandled} of ${dims.accessScored} notes that carried one)`);
    console.log(`   [${ICON.info}] no fabrication        ${pct(dims.noFabrication, n)}  (${dims.noFabrication} of ${n})`);
    console.log("");

    const worst = judged.filter((j) => !j.noFabrication).slice(0, 5);
    if (worst.length) {
      console.log("  Fabrication findings — the agent's actual words:\n");
      for (const w of worst) {
        console.log(`   · job ${w.jobId} (${w.serviceCode})`);
        console.log(`     note   ${w.note.replace(/\n/g, " ").slice(0, 220)}`);
        console.log(`     agent  ${w.reply.replace(/\n/g, " ").slice(0, 300)}`);
        console.log(`     judge  ${w.reason}`);
        console.log("");
      }
    }
  }

  console.log("  Measured");
  console.log(`   [${wrongProps.length === 0 ? ICON.pass : ICON.fail}] wrong properties   ${wrongProps.length}`);
  console.log(`   [${ICON.info}] judged sample      ${n} of ${jobs.length} jobs`);
  // Key-wide delta. If anything else is using the same OpenRouter key while
  // this runs, its spend lands here too — stated rather than quietly implied.
  console.log(`   [${ICON.info}] spend              $${spend.toFixed(4)} key-wide delta  ($${after.remaining?.toFixed(2) ?? "n/a"} left)`);
  console.log(`   [${ICON.info}] elapsed            ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log("");

  const summary = {
    suite: "replay",
    generatedAt: new Date().toISOString(),
    gate: "zero wrong properties in the deterministic phase",
    passed: wrongProps.length === 0,
    models: { agent: slugFor("MODEL_AGENT"), judge: slugFor("MODEL_JUDGE") },
    deterministic: {
      jobsWithIntakeNote: jobs.length,
      distinctProperties: properties.length,
      resolvedToSelf: properties.filter((p) => p.correct).length,
      safelyDeferred: properties.filter((p) => !p.correct && !p.wrong).length,
      wrong: wrongProps.length,
      accessLanguageNotes: accessSet.length,
      accessFactsRecovered: accessSet.filter((j) => j.access_facts > 0).length,
      officeSameDay: withUrgency.filter((j) => j.same_day === true).length,
      officeUrgencyScored: withUrgency.length,
      serviceCodeDistribution: Object.fromEntries(
        [...new Set(jobs.map((j) => j.service_code))].sort().map((c) => [c, jobs.filter((j) => j.service_code === c).length]),
      ),
    },
    judged: dims === null ? null : {
      sampleSize: n,
      sampleAttempted: sample.length,
      incomplete: failures.length,
      sampledFrom: jobs.length,
      serviceMatch: dims.serviceMatch / n,
      urgencyMatch: dims.urgencyMatch / n,
      accessHandled: dims.accessScored === 0 ? null : dims.accessHandled / dims.accessScored,
      accessScored: dims.accessScored,
      noFabrication: dims.noFabrication / n,
      stratification: Object.fromEntries(
        [...new Set(sample.map((s) => s.service_code))].sort().map((c) => [c, sample.filter((s) => s.service_code === c).length]),
      ),
    },
    spendUsd: Number(spend.toFixed(6)),
    remainingUsd: after.remaining,
    wrongProperties: wrongProps,
    incompleteCases: failures,
    cases: judged,
  };

  const path = join(ROOT, "reports", "replay.json");
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`  Wrote ${path}\n`);

  return wrongProps.length === 0 ? 0 : 1;
}

const code = await main().catch((err: unknown) => {
  console.error("\n  replay suite crashed:", err);
  return 1;
});
await closeDb();
process.exit(code);
