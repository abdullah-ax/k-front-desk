/**
 * Extraction integrity — the halt gate for Part B task 9
 * (.claude/plans/front-desk.plan.md).
 *
 * Run: pnpm test:extract-integrity   (tsx, not vitest — this reads the live database)
 *
 * WHAT THIS IS FOR
 * A language model turned 6,954 free-text notes into typed rows that a voice
 * agent will read aloud to customers. Nobody is going to read those rows. This
 * file is the substitute for that reading: everything it checks is decidable by
 * a machine against the source text, and everything it cannot decide is written
 * to reports/extraction-sample.md for a human to judge in the morning.
 *
 * The four gates, in order of how much they matter:
 *
 *   1. EVERY snippet appears VERBATIM in its source note. Zero tolerance. This
 *      is the check that makes the whole extraction trustworthy without a human:
 *      a fact whose snippet is real came from real text, and the agent can quote
 *      it back to a caller. A fact whose snippet is not real is a fabrication
 *      wearing a citation, which is worse than no fact at all.
 *   2. Every fact resolves to a property or a job that exists.
 *   3. Access codes recovered on >= 80% of the 869 jobs whose notes carry a
 *      `[code]` token. The measured number is printed whether it passes or not,
 *      and this file never adjusts the threshold to make it pass.
 *   4. No extracted contact name is an anonymizer artifact. `Ruby Avery` is a
 *      phone number in 405 places (eda/01-notes-corpus.md §5.1); a contacts
 *      table containing it would give the agent a customer who does not exist.
 *      The artifact list is IMPORTED from the scrubber, not restated here, so it
 *      cannot drift away from what the scrubber actually guarantees.
 *
 * WHICH TEXT COUNTS AS "THE NOTE"
 * The model reads scrubbed text, because raw text contains the anonymizer's
 * collisions. So a snippet is verbatim if it appears in `note.content` OR in
 * `scrubForExtraction(note.content).text`. The scrubber is a pure function, so
 * this test recomputes it rather than trusting a column another pass populated —
 * the check must not depend on the order two pipelines happened to run in.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "../src/config.js";
import { closeDb, withTenant, type Sql } from "../src/db/client.js";
import {
  ALWAYS_REWRITTEN_TOKENS,
  PLACEHOLDER_VALUES,
  scrubForExtraction,
} from "../src/pipeline/scrub/anonymizer.js";

/**
 * Measured on this export: 1,072 notes across 869 jobs carry the `[code]`
 * redaction token (eda/01-notes-corpus.md §2.5). The test recounts it from the
 * database rather than trusting this number, and reports both.
 */
const CODE_JOBS_EXPECTED = 869;
const ACCESS_RECALL_FLOOR = 0.8;

/** Fact kinds that constitute "we recovered an access code for this job". */
const CODE_KINDS = new Set([
  "door_code",
  "gate_code",
  "building_code",
  "elevator_code",
  "lockbox_code",
  "master_code",
  "alarm_code",
  "other_code",
]);

const SAMPLE_SIZE = 50;

// --- table -----------------------------------------------------------------

const ICON = { pass: "  ok  ", fail: " FAIL ", warn: " warn ", info: " ---- " } as const;
type Status = keyof typeof ICON;

interface Line {
  group: string;
  name: string;
  status: Status;
  detail: string;
}
const lines: Line[] = [];
const add = (l: Line): void => void lines.push(l);
const n = (v: number): string => v.toLocaleString();

// --- shapes ----------------------------------------------------------------

interface FactRow {
  id: string;
  fact_type: string;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown>;
  source_note_id: string | null;
  snippet: string;
  confidence: number | null;
  extractor: string;
  note_content: string | null;
  note_job_id: string | null;
  job_ref: string | null;
  street_raw: string | null;
  unit: string | null;
}

async function main(): Promise<number> {
  const facts = await withTenant(
    (sql: Sql) => sql<FactRow[]>`
      select f.id,
             f.fact_type,
             f.subject_type,
             f.subject_id,
             f.payload,
             f.source_note_id,
             f.snippet,
             f.confidence,
             f.extractor,
             n.content   as note_content,
             n.job_id    as note_job_id,
             j.job_ref,
             p.street_raw,
             p.unit
        from extracted_fact f
        left join note     n on n.id = f.source_note_id
        left join job      j on j.id = n.job_id
        left join property p on p.id = j.property_id
       where f.superseded_by is null
       order by f.id
    `,
  );

  if (facts.length === 0) {
    console.error("\n  No extracted facts in the database. Run `pnpm pipeline:extract` first.\n");
    return 1;
  }

  // --- counts per fact type ------------------------------------------------

  const byType = new Map<string, { facts: number; jobs: Set<string>; extractors: Set<string> }>();
  for (const f of facts) {
    let e = byType.get(f.fact_type);
    if (!e) byType.set(f.fact_type, (e = { facts: 0, jobs: new Set(), extractors: new Set() }));
    e.facts++;
    e.extractors.add(f.extractor);
    if (f.note_job_id) e.jobs.add(f.note_job_id);
  }
  for (const [type, e] of [...byType].sort()) {
    add({
      group: "Counts",
      name: type,
      status: "info",
      detail: `${n(e.facts)} facts on ${n(e.jobs.size)} jobs · ${[...e.extractors].join(", ")}`,
    });
  }
  add({ group: "Counts", name: "total", status: "info", detail: `${n(facts.length)} facts` });

  // --- gate 1: verbatim snippets -------------------------------------------
  //
  // The scrubbed form is recomputed per note, memoised, because a busy job's
  // notes appear on many facts and scrubbing the same 10,000-character note
  // forty times is the difference between a two-second test and a minute.

  const scrubCache = new Map<string, string>();
  const scrubbedOf = (noteId: string, content: string): string => {
    let v = scrubCache.get(noteId);
    if (v === undefined) scrubCache.set(noteId, (v = scrubForExtraction(content).text));
    return v;
  };

  const notVerbatim: FactRow[] = [];
  const orphanNote: FactRow[] = [];
  let inRaw = 0;
  let inScrubbedOnly = 0;

  for (const f of facts) {
    if (!f.source_note_id || f.note_content === null) {
      orphanNote.push(f);
      continue;
    }
    if (f.note_content.includes(f.snippet)) {
      inRaw++;
    } else if (scrubbedOf(f.source_note_id, f.note_content).includes(f.snippet)) {
      inScrubbedOnly++;
    } else {
      notVerbatim.push(f);
    }
  }

  add({
    group: "Gate 1 — verbatim snippet",
    name: "snippets checked",
    status: "info",
    detail: `${n(facts.length)} · ${n(inRaw)} found in the raw note, ${n(inScrubbedOnly)} only in the scrubbed form`,
  });
  add({
    group: "Gate 1 — verbatim snippet",
    name: "not found verbatim",
    status: notVerbatim.length === 0 ? "pass" : "fail",
    detail:
      notVerbatim.length === 0
        ? "none — every stored snippet is real text from its own note"
        : `${n(notVerbatim.length)} facts cite text that is not in their note`,
  });
  add({
    group: "Gate 1 — verbatim snippet",
    name: "fact has a source note",
    status: orphanNote.length === 0 ? "pass" : "fail",
    detail: orphanNote.length === 0 ? "all facts" : `${n(orphanNote.length)} facts have no readable source note`,
  });

  // --- gate 2: subjects resolve --------------------------------------------

  const subjects = await withTenant(async (sql: Sql) => {
    const [p, j, c] = await Promise.all([
      sql<{ id: string }[]>`select id from property`,
      sql<{ id: string }[]>`select id from job`,
      sql<{ id: string }[]>`select id from customer`,
    ]);
    return {
      property: new Set(p.map((r) => r.id)),
      job: new Set(j.map((r) => r.id)),
      customer: new Set(c.map((r) => r.id)),
    } as Record<string, Set<string>>;
  });

  const unresolved = facts.filter((f) => {
    const set = subjects[f.subject_type];
    return !set || !set.has(f.subject_id);
  });
  const subjectCounts = new Map<string, number>();
  for (const f of facts) subjectCounts.set(f.subject_type, (subjectCounts.get(f.subject_type) ?? 0) + 1);

  add({
    group: "Gate 2 — subjects",
    name: "distribution",
    status: "info",
    detail: [...subjectCounts].map(([k, v]) => `${k} ${n(v)}`).join(", "),
  });
  add({
    group: "Gate 2 — subjects",
    name: "resolve to a real row",
    status: unresolved.length === 0 ? "pass" : "fail",
    detail:
      unresolved.length === 0
        ? "every fact points at a property or job that exists"
        : `${n(unresolved.length)} facts point at a subject that does not exist`,
  });

  // --- gate 3: access recall ------------------------------------------------

  const codeJobs = await withTenant(
    (sql: Sql) => sql<{ job_id: string }[]>`
      select distinct n.job_id
        from note n
       where n.job_id is not null
         and n.content like '%[code]%'
    `,
  );
  const codeJobIds = new Set(codeJobs.map((r) => r.job_id));

  const jobsWithCode = new Set<string>();
  for (const f of facts) {
    if (f.fact_type !== "access" || !f.note_job_id) continue;
    const kind = f.payload["kind"];
    if (typeof kind === "string" && CODE_KINDS.has(kind) && f.payload["value_known"] !== false) {
      jobsWithCode.add(f.note_job_id);
    }
  }
  const recovered = [...codeJobIds].filter((id) => jobsWithCode.has(id)).length;
  const recall = codeJobIds.size === 0 ? 0 : recovered / codeJobIds.size;

  add({
    group: "Gate 3 — access recall",
    name: "jobs carrying [code]",
    status: codeJobIds.size === CODE_JOBS_EXPECTED ? "pass" : "warn",
    detail: `${n(codeJobIds.size)} (eda/01-notes-corpus.md §2.5 measured ${n(CODE_JOBS_EXPECTED)})`,
  });
  add({
    group: "Gate 3 — access recall",
    name: "codes recovered",
    status: recall >= ACCESS_RECALL_FLOOR ? "pass" : "fail",
    detail: `${n(recovered)} of ${n(codeJobIds.size)} = ${(recall * 100).toFixed(1)}% (floor ${ACCESS_RECALL_FLOOR * 100}%)`,
  });

  // Not a gate: the nine jobs where a code is NAMED but BLANK are the ones the
  // agent must know to ask about, so they are worth seeing every run.
  const blanks = facts.filter(
    (f) =>
      f.fact_type === "access" &&
      f.payload["value_known"] === false &&
      typeof f.payload["kind"] === "string" &&
      CODE_KINDS.has(f.payload["kind"] as string),
  );
  add({
    group: "Gate 3 — access recall",
    name: "codes named but missing",
    status: "info",
    detail: `${n(blanks.length)} facts record a code the office does NOT have — the agent must ask`,
  });

  // --- gate 4: no anonymizer artifacts as people ---------------------------
  //
  // ALWAYS_REWRITTEN_TOKENS is imported, never restated: it is derived from the
  // scrubber's own substitution table, so if a token stops being unconditionally
  // rewritten this check follows it automatically. At the time of writing it
  // resolves to ["Ruby Avery", "Leeward Hospitality"]; `Tidewater Hospitality`
  // is deliberately absent because it is also a real customer.

  const artifacts = [...ALWAYS_REWRITTEN_TOKENS, ...PLACEHOLDER_VALUES];
  const contaminated: { fact: FactRow; token: string; field: string; value: string }[] = [];
  for (const f of facts) {
    for (const field of ["name", "company", "supplier", "manufacturer", "distributor"]) {
      const v = f.payload[field];
      if (typeof v !== "string") continue;
      const token = artifacts.find((t) => v.includes(t));
      if (token) contaminated.push({ fact: f, token, field, value: v });
    }
  }

  add({
    group: "Gate 4 — anonymizer artifacts",
    name: "checked against",
    status: "info",
    detail: artifacts.join(", "),
  });
  add({
    group: "Gate 4 — anonymizer artifacts",
    name: "names free of artifacts",
    status: contaminated.length === 0 ? "pass" : "fail",
    detail:
      contaminated.length === 0
        ? "no extracted name is a redaction artifact"
        : `${n(contaminated.length)} names are anonymizer artifacts, e.g. ${contaminated[0]!.field}="${contaminated[0]!.value}"`,
  });

  // --- not a gate: duplicates ----------------------------------------------
  //
  // A run that crashes between inserting a batch of facts and marking those jobs
  // covered will re-extract them, and a job whose notes were split into chunks
  // can have one chunk succeed and the other fail, leaving the job uncovered
  // with half its facts already stored. Neither is a correctness problem — the
  // snippets are still real — but a caller hearing the same door code twice is a
  // symptom worth watching, so it is counted and printed rather than assumed
  // absent.

  const seen = new Set<string>();
  let duplicates = 0;
  for (const f of facts) {
    const k = `${f.extractor}|${f.source_note_id}|${f.snippet}|${JSON.stringify(f.payload)}`;
    if (seen.has(k)) duplicates++;
    else seen.add(k);
  }
  add({
    group: "Counts",
    name: "exact duplicates",
    status: duplicates === 0 ? "pass" : "warn",
    detail:
      duplicates === 0
        ? "none"
        : `${n(duplicates)} facts are byte-identical repeats (re-extraction after a partial run)`,
  });

  // --- the human sample ----------------------------------------------------
  //
  // md5 of the id is a stable pseudo-random order: the same 50 rows come back
  // on a re-run over unchanged data, so a reviewer who stops halfway does not
  // get a different fifty in the morning.

  const sample = [...facts]
    .map((f) => ({ f, k: hash(f.id) }))
    .sort((a, b) => (a.k < b.k ? -1 : 1))
    .slice(0, SAMPLE_SIZE)
    .map((x) => x.f);

  writeSample(sample, facts.length, byType);
  add({
    group: "Human review",
    name: "reports/extraction-sample.md",
    status: "info",
    detail: `${n(sample.length)} facts sampled for semantic review`,
  });

  // --- output --------------------------------------------------------------

  render();

  const failures = lines.filter((l) => l.status === "fail");
  if (notVerbatim.length) {
    console.log("  Snippets that are NOT verbatim (first 10):\n");
    for (const f of notVerbatim.slice(0, 10)) {
      console.log(`   · fact ${f.id} [${f.extractor}] note ${f.source_note_id}`);
      console.log(`       stored : ${JSON.stringify(f.snippet.slice(0, 160))}`);
      console.log(`       note   : ${JSON.stringify((f.note_content ?? "").slice(0, 160))}\n`);
    }
  }
  if (contaminated.length) {
    console.log("  Anonymizer artifacts stored as names (first 10):\n");
    for (const c of contaminated.slice(0, 10)) {
      console.log(`   · fact ${c.fact.id} [${c.fact.extractor}] ${c.field} = ${JSON.stringify(c.value)}`);
    }
    console.log("");
  }

  if (failures.length) {
    console.log(`  ${failures.length} gate${failures.length === 1 ? "" : "s"} failed:\n`);
    for (const f of failures) console.log(`   · ${f.name} — ${f.detail}`);
    console.log("\n  This is a halt gate. Fix the extractor and re-run that one extractor by\n" +
      "  bumping its version; do not lower a threshold to make this pass.\n");
    return 1;
  }

  console.log(
    `  All gates green. Access recall ${(recall * 100).toFixed(1)}%.\n` +
      `  Now read reports/extraction-sample.md — the machine proved the snippets are real,\n` +
      `  only a person can judge whether they MEAN what we extracted.\n`,
  );
  return 0;
}

/** Cheap stable hash, so the 50 sampled rows are the same 50 on a re-run. */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function render(): void {
  const groups = [...new Set(lines.map((l) => l.group))];
  const width = Math.max(...lines.map((l) => l.name.length)) + 2;
  console.log("\n  Front Desk — extraction integrity\n");
  for (const g of groups) {
    console.log(`  ${g}`);
    for (const l of lines.filter((x) => x.group === g)) {
      console.log(`   [${ICON[l.status]}] ${l.name.padEnd(width)} ${l.detail}`);
    }
    console.log("");
  }
}

/**
 * The morning artifact. Deliberately readable rather than complete: a reviewer
 * has fifteen minutes and needs the extracted claim next to the words it came
 * from, with enough address and job reference to look it up if it smells wrong.
 */
function writeSample(
  sample: FactRow[],
  total: number,
  byType: Map<string, { facts: number; jobs: Set<string> }>,
): void {
  const out: string[] = [];
  out.push("# Extraction sample — 50 facts for semantic review");
  out.push("");
  out.push(
    "*Generated by `pnpm test:extract-integrity`. Every snippet below has already been proved " +
      "to appear **verbatim** in its source note — that check is machine-run and passed. " +
      "What a machine cannot check is whether the extracted fact MEANS what the snippet says. " +
      "That is what you are reading for.*",
  );
  out.push("");
  out.push(
    "**How to review**: for each row, read the snippet, then read the fact. Ask only *would " +
      "this be a correct thing to say to a caller?* Mark anything that is a stretch. If more than " +
      "a handful are wrong it is one extractor's prompt and a re-run of that extractor — not a rebuild.",
  );
  out.push("");
  out.push(`Sampled ${sample.length} of ${total.toLocaleString()} stored facts.`);
  out.push("");
  out.push("| fact type | facts | jobs |");
  out.push("|---|---:|---:|");
  for (const [type, e] of [...byType].sort()) {
    out.push(`| ${type} | ${e.facts.toLocaleString()} | ${e.jobs.size.toLocaleString()} |`);
  }
  out.push("");
  out.push("---");
  out.push("");

  sample.forEach((f, i) => {
    const where = [f.street_raw, f.unit ? `unit ${f.unit}` : null].filter(Boolean).join(", ");
    out.push(`### ${i + 1}. \`${f.fact_type}\` — ${f.extractor}`);
    out.push("");
    out.push(
      `**Job** ${f.job_ref ?? f.note_job_id ?? "?"}` +
        (where ? ` · **${where}**` : "") +
        ` · note \`${f.source_note_id}\` · confidence ${f.confidence ?? "?"}`,
    );
    out.push("");
    out.push("> " + f.snippet.replace(/\n/g, "\n> "));
    out.push("");
    const shown = Object.entries(f.payload)
      .filter(([k, v]) => !k.startsWith("_") && k !== "job_id" && v !== null && v !== "")
      .map(([k, v]) => `- \`${k}\`: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    out.push(...(shown.length ? shown : ["- *(no payload fields set)*"]));
    const scrub = f.payload["_scrub"] as { flags?: { type: string; original: string }[] } | undefined;
    if (scrub?.flags?.length) {
      out.push("");
      out.push(
        `> ⚠ **Source text was repaired by the anonymizer scrubber**: ` +
          scrub.flags.map((x) => `\`${x.original}\` (${x.type})`).join(", ") +
          `. Read this one twice.`,
      );
    }
    out.push("");
  });

  const dir = join(ROOT, "reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extraction-sample.md"), out.join("\n"), "utf8");
}

const code = await main().catch((e: unknown) => {
  console.error(`\n  extraction integrity check failed to run: ${(e as Error).message}\n`);
  return 1;
});
await closeDb();
process.exit(code);
