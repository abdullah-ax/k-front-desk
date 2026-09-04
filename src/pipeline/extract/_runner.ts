/**
 * pnpm pipeline:extract — 6,954 free-text notes -> typed rows in `extracted_fact`.
 * (.claude/plans/front-desk.plan.md, Part B task 9.)
 *
 * WHY THIS RUNS AT BUILD TIME
 * Everything this company knows operationally — how to get in the door, who is
 * actually on site, when a part lands, what it told a customer about warranty,
 * what it promised never to charge for again — is prose. None of it has a
 * field (eda/01-notes-corpus.md §3, §6). An agent reading only the structured
 * columns can answer almost none of the sixteen questions callers actually ask.
 * Doing this pass live would add 2–4s to every phone answer, so it happens ONCE,
 * here, and the phone path does an indexed lookup.
 *
 * THE CONTRACT WITH EACH EXTRACTOR
 * One file per fact type in this directory. Adding a fact type is exactly one
 * new file — this runner walks the directory, so there is no registry to edit
 * and no list to forget. Each module exports:
 *
 *   factType     stored in extracted_fact.fact_type
 *   version      bumped when the prompt or schema changes; stored as
 *                `<factType>@<version>` in extracted_fact.extractor. Changing it
 *                re-runs THAT extractor and only that one.
 *   subjectType  'property' | 'job' | 'customer' — what the fact is about
 *   schema       zod object describing the payload of ONE fact
 *   prompt       what to look for, in the extractor's own words
 *   gate?        optional cheap keyword pre-filter (see COST below)
 *   validate?    optional precision check the extractor owns, run after the
 *                snippet has been verified; a false return is a counted rejection
 *   copyFields?  payload fields the extractor promises are COPIED from the note
 *                rather than inferred; the runner proves each one (see below)
 *   expectedJobs? measured volume from eda/01-notes-corpus.md, printed as a
 *                sanity target next to what we actually got
 *
 * Extractors must import from this file with `import type` only. The runner
 * imports them dynamically at runtime; a value import back would be a cycle.
 *
 * SCRUBBING COMES FIRST, ALWAYS
 * 11.1% of notes are corrupted by the export's anonymizer: `Ruby Avery` is a
 * phone number, `Tidewater Hospitality` is sometimes the word "work", `Jasmine`
 * is the modal verb "will" (eda/01-notes-corpus.md §5.1). Raw text reaches no
 * model. Every note goes through scrubForExtraction() first, and the flags it
 * raises ride along onto every fact drawn from that note, so a fact taken from
 * damaged text stays traceable to the damage.
 *
 * THE SNIPPET IS THE POINT
 * `snippet` must be a verbatim substring of the source note. It is the one field
 * a machine can check without a human reading anything, and it is what the agent
 * quotes back to a caller. The model is told to copy exactly; this runner then
 * verifies, recovers a near-miss to the real substring where it can locate one
 * unambiguously, and DROPS the fact otherwise, counting it as a rejection.
 * tests/extract-integrity.test.ts re-checks every stored row against the
 * database with zero tolerance.
 *
 * ...AND THE SNIPPET WAS THE ONLY THING PROVED
 * The snippet gate proves ONE field. Every other field on the row was, until
 * now, whatever the model said — and a semantic review of 50 sampled facts found
 * 22 wrong, almost all of them in those unproved fields: suppliers taken from
 * the prompt's own supplier list rather than from the note, a phrase out of
 * `units.ts`'s example block stored 51 times as an identifier, and — the one
 * that can lock a technician out — `value_known: true` with a code on a note
 * that contains no code at all ("Security will let you in the gate").
 *
 * So an extractor now DECLARES which of its fields are copies (`copyFields`),
 * and this runner proves them the same way it proves the snippet: the value has
 * to be findable in the text the model actually read, with the same
 * loose-whitespace tolerance. A field that fails is NULLED, not the fact
 * dropped — a parts row with a real part and an invented supplier is still worth
 * having without the supplier. Two exceptions:
 *   · a field whose truth is asserted by ANOTHER field carries that field down
 *     with it. `access.value_known` becomes false when `value` is fabricated,
 *     because an agent that says "I don't have the code, please ask" is safe and
 *     one that reads back a code that does not exist is not.
 *   · a field the extractor declared NON-nullable cannot be nulled without
 *     violating its own schema, and a fact whose only content is that field is
 *     not a fact. Those rows are dropped, and counted separately.
 * Both are counted per extractor and per field, printed, and written to the
 * pipeline_run ledger.
 *
 * This deliberately does NOT bump any extractor version: it changes what happens
 * to invalid output, not what valid output looks like — the same reasoning
 * warranty.ts used for its enum fix. Use --redo to re-run one at its current
 * version.
 *
 * COST
 * The OpenRouter key has a $10 hard cap shared with every other task, so this
 * pass is built to be cheap rather than exhaustive:
 *   · one request per (job, extractor) — a job's notes are one narrative and
 *     splitting them loses the antecedent of "he", "the unit", "again";
 *   · `gate` skips whole extractors for jobs whose text cannot contain the fact.
 *     Gates are deliberately loose — they cost recall only if a note discusses
 *     warranty without ever using a warranty word;
 *   · assertBudget() runs periodically and the run stops CLEANLY, writing what
 *     it has, rather than draining the account.
 *
 * RESUMABILITY
 * Coverage — every (extractor@version, job) pair that has been *attempted*, not
 * just the ones that produced facts — is written into the pipeline_run row as it
 * goes. A zero-fact job is a finished job; without this it would be retried on
 * every run forever. Re-running skips covered pairs. Bumping one extractor's
 * version changes its key and therefore re-runs only it.
 *
 * FLAGS
 *   --limit=N         process at most N jobs (measure cost before the full pass)
 *   --only=access     one extractor (repeatable: --only=access --only=parts)
 *   --dry-run         plan and price the work; no model calls, no writes
 *   --concurrency=N   in-flight requests, default 8
 *   --jobs=12,34      specific job ids, for chasing one bad extraction
 *   --redo            re-run the SELECTED extractors at their current version:
 *                     deletes their rows and clears their coverage first, for
 *                     the jobs in scope only, so it composes with --limit. This
 *                     is how a runner-side fix (a new gate, a repair) reaches
 *                     rows that are already stored, without a version bump that
 *                     would falsely claim the extractor's output shape changed.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateObject } from "ai";
import { z } from "zod";

import { TENANT_ID } from "../../config.js";
import { closeDb, withTenant, type Sql } from "../../db/client.js";
import { assertBudget, extractModel, readBudget, slugFor } from "../../models/index.js";
import {
  PLACEHOLDER_VALUES,
  scrubForExtraction,
  type ScrubFlag,
} from "../scrub/anonymizer.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// --- tunables --------------------------------------------------------------

/**
 * Characters of scrubbed note text per request. A job over this is split at
 * note boundaries — never mid-note, because a snippet must be findable inside
 * exactly one note. p99 job text is ~2k tokens, so this splits almost nothing.
 */
const CHUNK_CHARS = 12_000;

/** In-flight model requests. The free-tier pooler is the constraint, not OpenRouter. */
const DEFAULT_CONCURRENCY = 8;

/** Attempts per request, then the chunk is recorded as failed and the run continues. */
const MAX_ATTEMPTS = 4;

/** How often to re-read the key's remaining credit. Cheap, but not free. */
const BUDGET_CHECK_EVERY = 30;

/** Longest snippet we will store. Past this it is a paragraph, not a citation. */
const MAX_SNIPPET_CHARS = 400;
const MIN_SNIPPET_CHARS = 3;

// --- the extractor contract ------------------------------------------------

export type SubjectType = "property" | "job" | "customer";

/**
 * One payload field an extractor promises is COPIED out of the note.
 *
 * The snippet gate proves the citation. This proves the fields the citation is
 * supposed to support. A field the extractor's own prompt asks the model to
 * INFER — a role, a status enum, a boolean, a restatement — must never be
 * declared here: it would be nulled for not being a quote, which is exactly what
 * it was asked not to be.
 */
export interface CopyField {
  /** Payload key. Must exist in the extractor's schema. */
  field: string;
  /**
   * Where the value has to be findable. Three scopes, widest to tightest.
   *
   * "job" is every note on the job, raw and scrubbed. It is the right scope for
   * a field that NAMES the thing the job is about, because a job's notes are
   * one narrative about one piece of work: note 1 reads "Mingledorffs: Evap
   * coil and TXV - $2543" and note 2 reads "OTD for both is $706", and the
   * model citing the second while naming the part from the first is grounded,
   * not inventing. `parts.part` is the case that forced it.
   *
   * "note" (the default) is the whole source note, raw or scrubbed. This is the
   * scope for every NUMBER and every NAME OF A COUNTERPARTY — a cost, an ETA, an
   * order date, a supplier — which must come from the same note that carries the
   * claim. Widening these to the job is how a $1,394.67 quote covering a TXV and
   * a defrost board gets stamped onto both rows, so an agent quoting both parts
   * quotes $2,789.
   *
   * "snippet" is the verified citation itself, and is strictly stronger than
   * either. It is for a field whose entire meaning is "this is what THAT span
   * says". A door code is the case that forced it: a note reading "Door code:"
   * with nothing after it, on a job whose OTHER note carries a code, passes a
   * note-scoped check and is still a fabricated answer to "what is the code
   * here".
   *
   * Widen only for a field where being named ANYWHERE in the job is itself the
   * evidence. Every other field belongs at "note" or tighter.
   */
  in?: "job" | "note" | "snippet";
  /** Checked only when this returns true. Default: whenever the value is a non-empty string. */
  when?: (payload: Record<string, unknown>) => boolean;
  /**
   * Other payload keys to force when this field turns out not to be a copy,
   * because they assert something about it that is no longer true.
   * `access.value_known` is the whole reason this exists.
   */
  alsoSet?: Record<string, unknown>;
}

/** What one file in this directory must export. */
export interface Extractor {
  /** Stored in extracted_fact.fact_type. Matches the filename. */
  factType: string;
  /** Bump to invalidate this extractor's rows without touching the others. */
  version: string;
  /** What the fact is about. Decides which id lands in subject_id. */
  subjectType: SubjectType;
  /** Payload of ONE fact. The runner adds note_id / snippet / confidence. */
  schema: z.AnyZodObject;
  /** Extractor-specific instructions, appended to the shared preamble. */
  prompt: string;
  /**
   * Cheap pre-filter over a job's whole scrubbed text. Return false only when
   * the fact type cannot be present. Loose by design: a false negative is lost
   * recall, a false positive is a fraction of a cent.
   */
  gate?: (text: string) => boolean;
  /**
   * Last-line precision check the extractor owns, run after the snippet has been
   * verified. Return false to reject the fact and count it as a rejection.
   *
   * This exists because some fact types can state a machine-checkable condition
   * that a prompt can only ask for politely — `policy` requires that the words
   * making a rule "standing" are themselves quotable from the note. A prompt
   * rule the model ignores costs precision silently; the same rule here costs a
   * rejection that gets counted and printed.
   */
  validate?: (
    payload: Record<string, unknown>,
    ctx: { snippet: string; noteText: string },
  ) => boolean;
  /**
   * Payload fields this extractor promises are COPIED from the note rather than
   * inferred. The runner proves each one against the text the model read and
   * nulls the ones it cannot find (dropping the fact when the field is
   * non-nullable, since a null there would break the extractor's own schema).
   *
   * A bare string is shorthand for `{ field }` with the defaults.
   */
  copyFields?: readonly (string | CopyField)[];
  /** Measured job count from eda/01-notes-corpus.md, printed beside the result. */
  expectedJobs?: number;
}

/**
 * Provenance fields the runner owns and adds to every extractor's schema, so no
 * extractor can forget them and no extractor can name them differently.
 */
const PROVENANCE = {
  note_id: z
    .string()
    .describe("The id attribute of the <note> element this fact came from. Copy it exactly."),
  snippet: z
    .string()
    .describe(
      "EXACT character-for-character substring of that note, copied not retyped. " +
        "The shortest span that carries the fact — usually one line. " +
        "A snippet that is not found verbatim in the note causes the fact to be discarded.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("1.0 stated outright, 0.7 clearly implied, 0.4 a fair reading of ambiguous text."),
};

/**
 * The half of the prompt every extractor shares. It is here, not duplicated in
 * six files, because the verbatim rule is the whole basis of the integrity gate
 * and it must be worded identically for every fact type.
 */
const PREAMBLE = `You are reading the internal job notes of Gulf Breeze Air, an HVAC company in South Florida.
The notes are free text written by office staff and technicians. They are telegraphic, frequently
unpunctuated, and never proofread. 55.8% of them contain no sentence-ending punctuation at all.

This export was pseudonymised, and the damage the pseudonymiser did has already been repaired
before the text reached you. You will see these placeholders. Read them literally:

  [code]                 a door / gate / lockbox code that EXISTS but whose digits were redacted.
                         It means "a code is on file", NOT "the code is unknown".
  [phone]                a phone number that was redacted.
  [email]                an email address that was redacted.
  [redacted-identifier]  a serial, check or account number destroyed by the phone redactor.
  [unclear-term]         a word destroyed by the redactor that could not be recovered.
  [property-contact]     homeowner / owner / property manager — the export conflated all three,
                         so never claim which one it was.

RULES, in order of importance:

1. snippet MUST be an EXACT, CHARACTER-FOR-CHARACTER substring of the note it came from.
   Copy it. Do not retype it, fix spelling, change capitalisation, normalise whitespace, join
   lines, or add or remove punctuation. If you cannot copy a span exactly, emit no fact for it.
   Every fact whose snippet is not found verbatim in its note is thrown away, so an approximate
   snippet is strictly worse than no fact. Keep it short: the shortest span that carries the fact.

2. note_id MUST be the id attribute of the <note> element the snippet came from.

3. Extract only what the text says. Never infer, never calculate, never resolve a date, never
   merge two notes into one fact, never decide which of two contradictory notes is right.
   If two notes disagree, emit both facts and let the reader see the disagreement.

4. Emit nothing rather than something. An empty list is a correct and very common answer.

5. Never emit a placeholder string ([phone], [code], [property-contact], ...) as a person's name
   or a company name.

6. One fact per row. Do not pack two findings into one object.`;

// --- work units ------------------------------------------------------------

interface NoteRow {
  noteId: number;
  jobId: number;
  propertyId: number | null;
  customerId: number | null;
  /** Verbatim source text. Never sent to a model. */
  raw: string;
  /** What the model sees. */
  scrubbed: string;
  flags: ScrubFlag[];
}

interface JobUnit {
  jobId: number;
  propertyId: number | null;
  customerId: number | null;
  notes: NoteRow[];
  /** Concatenated scrubbed text, lowercased, for gates. */
  gateText: string;
}

/** One model request: an extractor against a contiguous run of one job's notes. */
interface Task {
  extractor: Extractor;
  key: string;
  job: JobUnit;
  notes: NoteRow[];
}

interface FactRow {
  factType: string;
  subjectType: SubjectType;
  subjectId: number;
  payload: Record<string, unknown>;
  sourceNoteId: number;
  snippet: string;
  confidence: number;
  extractor: string;
}

// --- discovery -------------------------------------------------------------

/**
 * Walks this directory. Every module that is not `_`-prefixed and not a test is
 * an extractor; anything that fails validation is a hard error, because a
 * silently-skipped extractor is a silently-missing fact type.
 */
async function discoverExtractors(): Promise<Extractor[]> {
  const files = readdirSync(HERE)
    .filter((f) => /\.(ts|js|mts|mjs)$/.test(f))
    .filter((f) => !f.startsWith("_") && !f.endsWith(".d.ts") && !f.includes(".test."))
    .sort();

  const found: Extractor[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(HERE, file)).href)) as Record<string, unknown>;
    const ex = (mod.default ?? mod) as Partial<Extractor>;
    const missing = (["factType", "version", "subjectType", "schema", "prompt"] as const).filter(
      (k) => ex[k] === undefined,
    );
    if (missing.length) {
      throw new Error(`${file} is not a valid extractor — missing: ${missing.join(", ")}`);
    }
    // A copyField naming a key the schema does not have is a typo that would
    // silently prove nothing — the exact failure mode this gate exists to end.
    const keys = Object.keys((ex.schema as z.AnyZodObject).shape);
    const unknown = (ex.copyFields ?? [])
      .map((c) => (typeof c === "string" ? c : c.field))
      .filter((f) => !keys.includes(f));
    if (unknown.length) {
      throw new Error(
        `${file} declares copyFields not present in its schema: ${unknown.join(", ")} ` +
          `(schema has: ${keys.join(", ")})`,
      );
    }
    found.push(ex as Extractor);
  }
  if (found.length === 0) throw new Error(`No extractors found in ${HERE}`);
  return found;
}

const keyOf = (ex: Extractor): string => `${ex.factType}@${ex.version}`;

// --- loading ---------------------------------------------------------------

/**
 * Flattens an SDK error into one readable line.
 *
 * `NoObjectGeneratedError` is the one that matters: its own message says only
 * "response did not match schema", and the actual reason — which field the model
 * omitted, or that the provider returned an error body instead of a completion —
 * lives in `.cause` and `.text`. Without this you get eleven identical useless
 * lines and no way to tell a bad schema from a bad request.
 */
function describe(e: unknown): string {
  const err = e as { message?: string; text?: string; cause?: { message?: string } };
  const parts = [err?.message ?? String(e)];
  if (err?.cause?.message) parts.push(`cause: ${err.cause.message.slice(0, 300)}`);
  if (err?.text) parts.push(`raw: ${String(err.text).slice(0, 200)}`);
  return parts.join(" | ");
}

/**
 * Retries transient failures. Supabase's free-tier pooler drops connections
 * under concurrent load (CONNECT_TIMEOUT) and OpenRouter rate-limits; neither
 * is a reason to lose an hour of work.
 */
async function retry<T>(label: string, fn: () => Promise<T>, attempts = MAX_ATTEMPTS): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = describe(e);
      const fatal = /invalid api key|401|403|insufficient credit/i.test(msg);
      if (fatal || i === attempts - 1) break;
      // 0.8s, 1.6s, 3.2s + jitter.
      await new Promise((r) => setTimeout(r, 800 * 2 ** i + Math.random() * 400));
    }
  }
  throw new Error(`${label}: ${describe(last)}`);
}

/** Every note of every noted job, scrubbed. 6,954 rows; one query. */
async function loadJobs(limit: number | null, jobIds: number[] | null): Promise<JobUnit[]> {
  const rows = await retry("load notes", () =>
    withTenant(async (sql: Sql) => {
      const filter = jobIds && jobIds.length ? sql`and j.id = any(${jobIds})` : sql``;
      return sql<
        {
          job_id: string;
          property_id: string | null;
          customer_id: string | null;
          note_id: string;
          content: string;
        }[]
      >`
        select j.id as job_id,
               j.property_id,
               j.customer_id,
               n.id as note_id,
               n.content
          from job j
          join note n on n.job_id = j.id
         where n.content is not null ${filter}
         order by j.id, n.note_index nulls last, n.id
      `;
    }),
  );

  const byJob = new Map<number, JobUnit>();
  for (const r of rows) {
    const jobId = Number(r.job_id);
    let unit = byJob.get(jobId);
    if (!unit) {
      unit = {
        jobId,
        propertyId: r.property_id === null ? null : Number(r.property_id),
        customerId: r.customer_id === null ? null : Number(r.customer_id),
        notes: [],
        gateText: "",
      };
      byJob.set(jobId, unit);
    }
    // MANDATORY, and first: raw text never reaches a model.
    const { text, flags } = scrubForExtraction(r.content);
    unit.notes.push({
      noteId: Number(r.note_id),
      jobId,
      propertyId: unit.propertyId,
      customerId: unit.customerId,
      raw: r.content,
      scrubbed: text,
      flags,
    });
  }

  const units = [...byJob.values()];
  for (const u of units) u.gateText = u.notes.map((n) => n.scrubbed).join("\n").toLowerCase();
  return limit === null ? units : units.slice(0, limit);
}

/** Splits a job's notes into requests, never splitting a note. */
function chunk(notes: NoteRow[]): NoteRow[][] {
  const out: NoteRow[][] = [];
  let cur: NoteRow[] = [];
  let size = 0;
  for (const n of notes) {
    if (cur.length && size + n.scrubbed.length > CHUNK_CHARS) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(n);
    size += n.scrubbed.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The document the model reads. Ids are attributes so a fact can name its note. */
function renderNotes(notes: NoteRow[]): string {
  return notes.map((n) => `<note id="${n.noteId}">\n${n.scrubbed}\n</note>`).join("\n\n");
}

// --- verbatim recovery -----------------------------------------------------

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Returns the real substring of `haystack` that the model was trying to quote,
 * or null.
 *
 * Exact match first — that is the overwhelming majority. The two fallbacks
 * exist because models normalise whitespace and case even when told not to, and
 * a snippet that is right about WHICH words but wrong about the spacing between
 * them still points at real text. Both fallbacks return the text as it actually
 * stands in the note, never the model's version of it, and both refuse when the
 * span occurs more than once — an ambiguous citation is not a citation.
 */
function locateVerbatim(haystack: string, wanted: string): string | null {
  const s = wanted.trim();
  if (s.length < MIN_SNIPPET_CHARS) return null;
  if (haystack.includes(s)) return s;

  // Same words, any run of whitespace between them.
  const loose = s.split(/\s+/).map(escapeRe).join("\\s+");
  for (const flags of ["", "i"]) {
    const m = haystack.match(new RegExp(loose, flags));
    if (m && m[0]) {
      const all = haystack.match(new RegExp(loose, `g${flags}`));
      if (all && all.length === 1) return m[0];
    }
  }
  return null;
}

/**
 * Is `wanted` present in `haystack` as real text?
 *
 * Deliberately the same tolerance locateVerbatim() allows a snippet — exact
 * first, then the same words with any run of whitespace between them, case
 * insensitively — because a copy-field is held to the same standard as a
 * citation and holding it to a stricter one would null real values over a
 * capital letter.
 *
 * Two differences, both because this answers "is it there?" and not "where?":
 * there is no minimum length (a two-character code is still a code), and a span
 * that occurs more than once is fine. Ambiguity disqualifies a citation; it does
 * not disqualify a value.
 */
function appearsVerbatim(haystack: string, wanted: string): boolean {
  const s = wanted.trim();
  if (!s) return true;
  if (haystack.includes(s)) return true;
  const loose = s.split(/\s+/).map(escapeRe).join("\\s+");
  try {
    return new RegExp(loose, "i").test(haystack);
  } catch {
    return false;
  }
}

/** `copyFields` in its long form, with the defaults filled in. */
function copyFieldsOf(ex: Extractor): CopyField[] {
  return (ex.copyFields ?? []).map((c) => (typeof c === "string" ? { field: c } : c));
}

// --- one request -----------------------------------------------------------

interface TaskResult {
  facts: FactRow[];
  /** Facts dropped because the snippet was not verbatim, or named an unsent note. */
  rejectedSnippet: number;
  /** Facts dropped by the extractor's own `validate` — a precision filter, not an error. */
  rejectedValidate: number;
  /** Declared copy-fields nulled because the value was not in the source text: field -> count. */
  nulledFields: Map<string, number>;
  /** Facts dropped whole because a fabricated copy-field was non-nullable: field -> count. */
  droppedFields: Map<string, number>;
  promptTokens: number;
  completionTokens: number;
}

/**
 * The schema actually sent to the model.
 *
 * A field the extractor declared `.nullable()` is ALSO made optional here.
 * Measured behaviour of the extract model: it reliably fills every field it has
 * something to say about and simply omits the ones it does not, and zod's
 * `nullable` is not `optional`, so a single missing `company` was throwing away
 * an entire job's worth of good facts with "response did not match schema".
 * Treating "absent" and "null" as the same thing costs nothing — both mean the
 * note did not say — and it is normalised back to an explicit null below.
 *
 * Fields the extractor declared REQUIRED stay required. A fact with no `kind`
 * or no `role` is not classified, and retrying is the right response to that.
 *
 * A field wrapped in `.catch(fallback)` is left alone deliberately. `.catch()`
 * accepts null, so the nullability probe would wrongly make it optional — but
 * its whole purpose is the opposite: stay required in the schema the model sees,
 * and absorb an INVALID value rather than fail. The extract model invents enum
 * members it was not offered (`access_code`, `side_code`, `roof_access_code`
 * were all observed), and under zod's default behaviour one invented member
 * threw away every other fact in the same response.
 */
function requestShape(shape: z.ZodRawShape): z.ZodRawShape {
  const out: z.ZodRawShape = {};
  for (const [k, v] of Object.entries(shape)) {
    out[k] = !(v instanceof z.ZodCatch) && v.isNullable() ? v.optional() : v;
  }
  return out;
}

async function runTask(task: Task): Promise<TaskResult> {
  const { extractor: ex, job, notes } = task;
  const factSchema = z.object({ ...requestShape(ex.schema.shape), ...PROVENANCE });
  const schema = z.object({
    facts: z
      .array(factSchema)
      .describe("Every fact found. Empty when the notes contain none of this kind."),
  });

  const result = await retry(`${ex.factType} job ${job.jobId}`, () =>
    generateObject({
      model: extractModel(),
      schema,
      temperature: 0,
      maxRetries: 0, // our own retry owns the backoff, so failures are counted once
      system: `${PREAMBLE}\n\n---\n\n${ex.prompt}`,
      prompt: `Job ${job.jobId} — ${notes.length} note${notes.length === 1 ? "" : "s"}.\n\n${renderNotes(notes)}`,
    }),
  );

  const byNote = new Map(notes.map((n) => [String(n.noteId), n]));
  const subjectId =
    ex.subjectType === "job" ? job.jobId : ex.subjectType === "property" ? job.propertyId : job.customerId;

  const facts: FactRow[] = [];
  let rejectedSnippet = 0;
  let rejectedValidate = 0;
  const nulledFields = new Map<string, number>();
  const droppedFields = new Map<string, number>();
  const copyFields = copyFieldsOf(ex);

  /**
   * Every note on this job, raw and scrubbed, for `in: "job"` copy-fields.
   *
   * `job.notes` and not `notes`: the latter is one CHUNK of a long job, and a
   * field whose contract is "named somewhere on this job" must not silently
   * narrow to "named in whichever chunk we happened to send".
   *
   * Joined on NUL rather than a newline. appearsVerbatim() falls back to
   * matching the same words with any run of whitespace between them, and a
   * newline is whitespace — so a plain join would let a value straddle two
   * unrelated notes and count as found. NUL is not whitespace and appears in no
   * note, so it is a wall.
   *
   * Built once per response and only when something asks for it: most
   * extractors declare no job-scoped field at all.
   */
  let jobTextCache: string | null = null;
  const jobText = (): string =>
    (jobTextCache ??= job.notes.map((n) => `${n.raw}\u0000${n.scrubbed}`).join("\u0000"));

  for (const raw of result.object.facts) {
    const fact = raw as Record<string, unknown> & {
      note_id: string;
      snippet: string;
      confidence: number;
    };
    const note = byNote.get(String(fact.note_id).trim());
    // A fact attributed to a note we did not send is not traceable. Drop it.
    if (!note || subjectId === null) {
      rejectedSnippet++;
      continue;
    }

    // The snippet must be real in the text the model actually read. Where the
    // scrubber changed nothing (≈89% of notes) that is the raw note verbatim.
    const inScrubbed = locateVerbatim(note.scrubbed, fact.snippet);
    const inRaw = locateVerbatim(note.raw, fact.snippet);
    const snippet = inRaw ?? inScrubbed;
    if (!snippet || snippet.length > MAX_SNIPPET_CHARS) {
      rejectedSnippet++;
      continue;
    }

    const { note_id: _n, snippet: _s, confidence, ...rest } = fact;
    // "absent" and "null" mean the same thing — the note did not say. Store one
    // of them, so a reader never has to check for both.
    const payload: Record<string, unknown> = {};
    for (const k of Object.keys(ex.schema.shape)) payload[k] = rest[k] ?? null;

    // A name that is a placeholder is the anonymizer talking, not a person.
    const nameish = [payload.name, payload.company].filter((v): v is string => typeof v === "string");
    if (nameish.some((v) => PLACEHOLDER_VALUES.some((p) => v.includes(p)))) {
      rejectedValidate++;
      continue;
    }

    if (ex.validate && !ex.validate(payload, { snippet, noteText: note.scrubbed })) {
      rejectedValidate++;
      continue;
    }

    // --- the copy-field gate ---------------------------------------------
    //
    // The snippet is proved. Everything the extractor DECLARED to be a copy is
    // proved here, against the same text the model read, with the same
    // tolerance. What cannot be found was not copied — it was completed, most
    // often out of the prompt's own example block — so it does not get to stand.
    let dropped: string | null = null;
    const nulledHere: string[] = [];
    for (const cf of copyFields) {
      const value = payload[cf.field];
      if (typeof value !== "string" || !value.trim()) continue;
      if (cf.when && !cf.when(payload)) continue;

      const found =
        cf.in === "snippet"
          ? appearsVerbatim(snippet, value)
          : cf.in === "job"
            ? appearsVerbatim(jobText(), value)
            : appearsVerbatim(note.raw, value) || appearsVerbatim(note.scrubbed, value);
      if (found) continue;

      // Nulling a field the extractor declared non-nullable would break its own
      // schema, and for a field like units.identifier it is also the whole fact.
      const declared = ex.schema.shape[cf.field];
      if (declared && !declared.isNullable()) {
        dropped = cf.field;
        break;
      }
      payload[cf.field] = null;
      for (const [k, v] of Object.entries(cf.alsoSet ?? {})) payload[k] = v;
      nulledHere.push(cf.field);
    }
    if (dropped !== null) {
      droppedFields.set(dropped, (droppedFields.get(dropped) ?? 0) + 1);
      continue;
    }
    for (const f of nulledHere) nulledFields.set(f, (nulledFields.get(f) ?? 0) + 1);

    facts.push({
      factType: ex.factType,
      subjectType: ex.subjectType,
      subjectId,
      payload: {
        ...payload,
        job_id: job.jobId,
        // Which declared copies could not be found in the note, and were
        // therefore nulled. Present only on the rows it happened to, so a reader
        // can tell "the model made this up" from "the note did not say".
        ...(nulledHere.length ? { _provenance: { unverified_fields: nulledHere } } : {}),
        // Carried so a fact drawn from damaged text stays traceable to the damage.
        _scrub: {
          verbatim_in: inRaw ? "raw" : "scrubbed",
          flags: note.flags.slice(0, 10).map((f) => ({
            type: f.type,
            original: f.original,
            replacement: f.replacement,
            rule: f.rule,
          })),
        },
      },
      sourceNoteId: note.noteId,
      snippet,
      confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
      extractor: keyOf(ex),
    });
  }

  return {
    facts,
    rejectedSnippet,
    rejectedValidate,
    nulledFields,
    droppedFields,
    promptTokens: result.usage?.promptTokens ?? 0,
    completionTokens: result.usage?.completionTokens ?? 0,
  };
}

// --- persistence -----------------------------------------------------------

async function insertFacts(rows: FactRow[]): Promise<void> {
  if (!rows.length) return;
  await retry("insert facts", () =>
    withTenant(async (sql: Sql) => {
      const values = rows.map((r) => ({
        tenant_id: TENANT_ID,
        fact_type: r.factType,
        subject_type: r.subjectType,
        subject_id: r.subjectId,
        payload: sql.json(r.payload as never),
        source_note_id: r.sourceNoteId,
        snippet: r.snippet,
        confidence: r.confidence,
        extractor: r.extractor,
      }));
      await sql`insert into extracted_fact ${sql(
        values,
        "tenant_id",
        "fact_type",
        "subject_type",
        "subject_id",
        "payload",
        "source_note_id",
        "snippet",
        "confidence",
        "extractor",
      )}`;
    }),
  );
}

/**
 * Collapses byte-identical repeats, keeping the earliest row.
 *
 * The pipeline is resumable and a job is marked covered only AFTER its facts are
 * written, so a run killed between the two — or a multi-chunk job where one
 * chunk failed and the other succeeded — re-extracts a job that already has some
 * of its rows. The re-extraction is deterministic (temperature 0), so what comes
 * back is the same fact again. Nothing is wrong with either copy; the agent
 * would simply read the same door code out twice.
 *
 * Not solved with a unique index because the constraint belongs to a migration
 * this pass does not own, and not solved by checking before insert because that
 * is a round trip per batch to prevent something that happens a dozen times in
 * thirteen thousand rows.
 */
async function dedupe(): Promise<number> {
  return retry("dedupe", () =>
    withTenant(async (sql: Sql) => {
      const res = await sql`
        delete from extracted_fact f
         using extracted_fact keep
         where f.tenant_id      = keep.tenant_id
           and f.extractor      = keep.extractor
           and f.source_note_id is not distinct from keep.source_note_id
           and f.snippet        = keep.snippet
           and f.payload        = keep.payload
           and f.id             > keep.id
      `;
      return res.count;
    }),
  );
}

/**
 * Every (extractor@version, job) pair any previous run attempted. Read from the
 * pipeline_run ledger rather than from extracted_fact, because a job that
 * legitimately produced no facts is finished, and re-asking about it every night
 * would cost money forever.
 */
async function loadCoverage(): Promise<Map<string, Set<number>>> {
  const rows = await retry("load coverage", () =>
    withTenant((sql: Sql) =>
      sql<{ detail: { coverage?: Record<string, number[]> } }[]>`
        select detail from pipeline_run
         where task like 'extract%' and status in ('ok', 'running', 'halted')
      `,
    ),
  );
  const out = new Map<string, Set<number>>();
  for (const r of rows) {
    for (const [key, ids] of Object.entries(r.detail?.coverage ?? {})) {
      let set = out.get(key);
      if (!set) out.set(key, (set = new Set()));
      for (const id of ids) set.add(id);
    }
  }
  return out;
}

/**
 * --redo: forget that these extractors ever ran, at their CURRENT version.
 *
 * Deletes their stored rows for the jobs in scope and takes those jobs out of
 * every pipeline_run's coverage map, so the next plan sees them as uncovered.
 * Scoped rather than wholesale so that `--redo --limit=25` is a 25-job probe and
 * not a table wipe followed by a 25-job refill. This exists
 * because a fix to the RUNNER — a new gate, a repair — does not change what
 * valid output looks like and so must not bump an extractor's version, but the
 * rows already in the table were written without it. Version bumps state "the
 * output shape changed"; this states "re-derive with the same contract".
 *
 * A run that halts on budget after this has deleted rows it has not yet
 * rewritten. That is recoverable and does not need --redo again: the jobs it did
 * not reach were left uncovered by the same delete, so a plain re-run picks them
 * up. Re-passing --redo would throw away the work that DID land.
 */
async function redo(live: Extractor[], jobIds: number[]): Promise<{ facts: number; jobs: number }> {
  if (!jobIds.length) return { facts: 0, jobs: 0 };
  const scope = new Set(jobIds);
  return retry("redo", () =>
    withTenant(async (sql: Sql) => {
      let facts = 0;
      let jobs = 0;
      for (const ex of live) {
        const key = keyOf(ex);
        const del = await sql`
          delete from extracted_fact f
           using note n
           where n.id = f.source_note_id
             and f.extractor = ${key}
             and n.job_id = any(${jobIds})
        `;
        facts += del.count;

        const runs = await sql<{ id: string; detail: { coverage?: Record<string, number[]> } }[]>`
          select id, detail from pipeline_run
           where task like 'extract%' and detail -> 'coverage' ? ${key}
        `;
        for (const r of runs) {
          const coverage = r.detail.coverage ?? {};
          const kept = (coverage[key] ?? []).filter((id) => !scope.has(Number(id)));
          jobs += (coverage[key] ?? []).length - kept.length;
          coverage[key] = kept;
          await sql`
            update pipeline_run
               set detail = jsonb_set(detail, '{coverage}', ${sql.json(coverage as never)})
             where id = ${r.id}
          `;
        }
      }
      return { facts, jobs };
    }),
  );
}

/** Rows from a superseded version of an extractor we are about to re-run. */
async function dropStaleVersions(live: Extractor[]): Promise<number> {
  const pairs = live.map((e) => ({ factType: e.factType, key: keyOf(e) }));
  if (!pairs.length) return 0;
  const deleted = await retry("drop stale", () =>
    withTenant(async (sql: Sql) => {
      let n = 0;
      for (const p of pairs) {
        const res = await sql`
          delete from extracted_fact
           where fact_type = ${p.factType} and extractor <> ${p.key}
        `;
        n += res.count;
      }
      return n;
    }),
  );
  return deleted;
}

/**
 * Published per-token price for a model slug, or null.
 *
 * The key's own `usage` figure is authoritative but eventually consistent — a
 * run that finishes seconds after its last request reads back a delta of $0.00,
 * which is a worse number to report than no number. So spend is computed from
 * the tokens we actually counted times the published price, and the key delta is
 * printed beside it as the independent check.
 */
async function priceOf(slug: string): Promise<{ prompt: number; completion: number } | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { id: string; pricing?: { prompt?: string; completion?: string } }[];
    };
    const m = body.data?.find((x) => x.id === slug);
    if (!m?.pricing) return null;
    return { prompt: Number(m.pricing.prompt ?? 0), completion: Number(m.pricing.completion ?? 0) };
  } catch {
    return null;
  }
}

// --- output ----------------------------------------------------------------

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

function render(title: string): void {
  const groups = [...new Set(lines.map((l) => l.group))];
  const width = Math.max(...lines.map((l) => l.name.length)) + 2;
  console.log(`\n  ${title}\n`);
  for (const g of groups) {
    console.log(`  ${g}`);
    for (const l of lines.filter((x) => x.group === g)) {
      console.log(`   [${ICON[l.status]}] ${l.name.padEnd(width)} ${l.detail}`);
    }
    console.log("");
  }
}

const n = (v: number): string => v.toLocaleString();

// --- main ------------------------------------------------------------------

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const only = argv.filter((a) => a.startsWith("--only=")).map((a) => a.slice(7));
  const dryRun = argv.includes("--dry-run");
  const redoSelected = argv.includes("--redo");
  const limit = flag("limit") ? Number(flag("limit")) : null;
  const concurrency = flag("concurrency") ? Number(flag("concurrency")) : DEFAULT_CONCURRENCY;
  const jobIds = flag("jobs")?.split(",").map(Number).filter(Number.isFinite) ?? null;

  const all = await discoverExtractors();
  const selected = only.length ? all.filter((e) => only.includes(e.factType)) : all;
  if (!selected.length) {
    console.error(`No extractor matches --only=${only.join(",")}. Have: ${all.map((e) => e.factType).join(", ")}`);
    return 1;
  }

  const model = slugFor("MODEL_EXTRACT");
  const startedBudget = dryRun ? null : await readBudget();

  add({ group: "Setup", name: "model", status: "info", detail: model });
  add({
    group: "Setup",
    name: "extractors",
    status: "info",
    detail: selected.map(keyOf).join(", "),
  });
  if (startedBudget?.remaining !== null && startedBudget !== null) {
    add({
      group: "Setup",
      name: "credit",
      status: "info",
      detail: `$${startedBudget.remaining?.toFixed(4)} remaining`,
    });
  }

  const jobs = await loadJobs(limit, jobIds);
  const noteCount = jobs.reduce((a, j) => a + j.notes.length, 0);
  add({
    group: "Setup",
    name: "corpus",
    status: "info",
    detail: `${n(jobs.length)} noted jobs, ${n(noteCount)} notes${limit ? ` (--limit=${limit})` : ""}`,
  });

  // Before coverage is read, so the plan below sees the reset. Scoped to the
  // jobs this invocation actually loaded, so --redo composes with --limit and
  // --jobs: a 25-job pricing probe re-does 25 jobs, not the whole table.
  if (redoSelected) {
    const scope = jobs.map((j) => j.jobId);
    const cleared = dryRun ? { facts: 0, jobs: 0 } : await redo(selected, scope);
    add({
      group: "Plan",
      name: "--redo",
      status: dryRun ? "info" : "warn",
      detail: dryRun
        ? `would delete ${selected.map(keyOf).join(", ")} rows for ${n(scope.length)} jobs and clear their coverage`
        : `${n(cleared.facts)} existing rows deleted and ${n(cleared.jobs)} covered jobs cleared for ` +
          `${selected.map(keyOf).join(", ")} across ${n(scope.length)} jobs — they re-run at the same version`,
    });
  }

  const coverage = dryRun ? new Map<string, Set<number>>() : await loadCoverage();

  // Build the work list. A job is skipped when it is already covered at this
  // extractor's version, or when the gate says the fact cannot be there.
  const tasks: Task[] = [];
  const planned = new Map<string, { todo: number; covered: number; gated: number }>();
  for (const ex of selected) {
    const key = keyOf(ex);
    const done = coverage.get(key) ?? new Set<number>();
    const stat = { todo: 0, covered: 0, gated: 0 };
    for (const job of jobs) {
      if (done.has(job.jobId)) {
        stat.covered++;
        continue;
      }
      if (ex.gate && !ex.gate(job.gateText)) {
        stat.gated++;
        continue;
      }
      stat.todo++;
      for (const notes of chunk(job.notes)) tasks.push({ extractor: ex, key, job, notes });
    }
    planned.set(key, stat);
    add({
      group: "Plan",
      name: ex.factType,
      status: "info",
      detail:
        `${n(stat.todo)} jobs to run` +
        (stat.gated ? `, ${n(stat.gated)} gated out` : "") +
        (stat.covered ? `, ${n(stat.covered)} already done` : "") +
        (ex.expectedJobs ? ` — corpus target ~${n(ex.expectedJobs)}` : ""),
    });
  }

  const chars = tasks.reduce((a, t) => a + t.notes.reduce((b, x) => b + x.scrubbed.length, 0), 0);
  add({
    group: "Plan",
    name: "requests",
    status: "info",
    detail: `${n(tasks.length)} model calls, ~${n(Math.round(chars / 4))} tokens of note text`,
  });

  if (dryRun) {
    render("Front Desk — extraction (dry run, nothing written, nothing spent)");
    console.log("  Dry run. Re-run without --dry-run, starting with --limit=25 to price it.\n");
    return 0;
  }

  // A version bump means the old rows are wrong, not historical.
  const stale = await dropStaleVersions(selected);
  if (stale) {
    add({ group: "Plan", name: "stale rows dropped", status: "warn", detail: n(stale) });
  }

  // Open the ledger row first, and keep writing coverage into it, so a crash or
  // a budget halt still leaves a resumable record.
  const task = only.length ? `extract:${only.join("+")}` : "extract";
  const runId = await retry("open pipeline_run", () =>
    withTenant(async (sql: Sql) => {
      const rows = await sql<{ id: string }[]>`
        insert into pipeline_run (tenant_id, task, status, rows_in, detail)
        values (${TENANT_ID}, ${task}, 'running', ${noteCount},
                ${sql.json({ model, extractors: selected.map(keyOf), args: argv } as never)})
        returning id
      `;
      return Number(rows[0]!.id);
    }),
  );

  // --- execute -------------------------------------------------------------

  const newCoverage = new Map<string, Set<number>>(selected.map((e) => [keyOf(e), new Set<number>()]));
  const pending = new Map<string, number>(); // `key:jobId` -> chunks outstanding
  for (const t of tasks) {
    const k = `${t.key}:${t.job.jobId}`;
    pending.set(k, (pending.get(k) ?? 0) + 1);
  }

  /**
   * Facts and finished jobs wait here until a flush.
   *
   * One insert transaction per model call is four round trips per call, and at
   * twelve in flight that exhausted the pooler: `EMAXCONNSESSION — max clients
   * are limited to pool_size: 15`, on a free tier shared with the other
   * pipelines running tonight. Buffering turns ~6,000 transactions into ~60.
   *
   * ORDER MATTERS AND IS NOT NEGOTIABLE: facts are inserted BEFORE their jobs
   * are marked covered. A crash between the two costs a re-extraction of a
   * handful of jobs. The other order would mark a job done whose facts were
   * never written, and nothing would ever go back for them.
   */
  const buffer: FactRow[] = [];
  let coverageQueue: { key: string; jobId: number }[] = [];
  const FLUSH_AT_FACTS = 250;

  const counts = new Map<string, number>(selected.map((e) => [e.factType, 0]));
  const jobsWithFacts = new Map<string, Set<number>>(selected.map((e) => [e.factType, new Set<number>()]));
  const rejSnippet = new Map<string, number>(selected.map((e) => [e.factType, 0]));
  const rejValidate = new Map<string, number>(selected.map((e) => [e.factType, 0]));
  /** factType -> field -> count, for the copy-field gate. */
  const nulled = new Map<string, Map<string, number>>(selected.map((e) => [e.factType, new Map()]));
  const droppedCopy = new Map<string, Map<string, number>>(selected.map((e) => [e.factType, new Map()]));
  const returned = new Map<string, number>(selected.map((e) => [e.factType, 0]));
  let promptTokens = 0;
  let completionTokens = 0;
  let failures = 0;
  let done = 0;
  let halted: string | null = null;

  // Serialises flushes: workers await the same chain rather than racing each
  // other into the pool, which is the problem buffering exists to solve.
  let flushing: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    flushing = flushing.then(async () => {
      const rows = buffer.splice(0, buffer.length);
      const covered = coverageQueue;
      coverageQueue = [];
      if (rows.length) await insertFacts(rows);
      for (const c of covered) newCoverage.get(c.key)?.add(c.jobId);

      const obj: Record<string, number[]> = {};
      for (const [k, set] of newCoverage) obj[k] = [...set];
      await retry("flush coverage", () =>
        withTenant(
          (sql: Sql) => sql`
            update pipeline_run
               set rows_out = ${[...counts.values()].reduce((a, b) => a + b, 0)},
                   detail = detail || ${sql.json({ coverage: obj } as never)}
             where id = ${runId}
          `,
        ),
      );
    });
    return flushing;
  };

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (halted) return;
      const i = cursor++;
      if (i >= tasks.length) return;
      const t = tasks[i]!;

      try {
        const res = await runTask(t);
        promptTokens += res.promptTokens;
        completionTokens += res.completionTokens;
        const ft = t.extractor.factType;
        rejSnippet.set(ft, (rejSnippet.get(ft) ?? 0) + res.rejectedSnippet);
        rejValidate.set(ft, (rejValidate.get(ft) ?? 0) + res.rejectedValidate);
        for (const [f, c] of res.nulledFields) {
          const m = nulled.get(ft)!;
          m.set(f, (m.get(f) ?? 0) + c);
        }
        for (const [f, c] of res.droppedFields) {
          const m = droppedCopy.get(ft)!;
          m.set(f, (m.get(f) ?? 0) + c);
        }
        const copyDropped = [...res.droppedFields.values()].reduce((a, b) => a + b, 0);
        returned.set(
          ft,
          (returned.get(ft) ?? 0) +
            res.facts.length +
            res.rejectedSnippet +
            res.rejectedValidate +
            copyDropped,
        );
        if (res.facts.length) {
          buffer.push(...res.facts);
          counts.set(t.extractor.factType, (counts.get(t.extractor.factType) ?? 0) + res.facts.length);
          jobsWithFacts.get(t.extractor.factType)!.add(t.job.jobId);
        }
      } catch (e) {
        failures++;
        console.error(`   ! ${(e as Error).message}`);
        // A failed chunk leaves the job uncovered, so the next run retries it.
        pending.delete(`${t.key}:${t.job.jobId}`);
      }

      const k = `${t.key}:${t.job.jobId}`;
      const left = pending.get(k);
      if (left !== undefined) {
        if (left <= 1) {
          pending.delete(k);
          coverageQueue.push({ key: t.key, jobId: t.job.jobId });
        } else {
          pending.set(k, left - 1);
        }
      }

      done++;
      if (buffer.length >= FLUSH_AT_FACTS) await flush().catch(() => {});

      if (done % BUDGET_CHECK_EVERY === 0) {
        process.stdout.write(
          `\r   ... ${n(done)}/${n(tasks.length)} calls, ${n([...counts.values()].reduce((a, b) => a + b, 0))} facts   `,
        );
        try {
          await assertBudget();
        } catch (e) {
          halted = (e as Error).message;
        }
      }
    }
  };

  console.log(`\n  Running ${n(tasks.length)} extraction calls at concurrency ${concurrency}...\n`);
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  process.stdout.write("\r".padEnd(60) + "\r");
  await flush();

  const deduped = await dedupe().catch(() => 0);
  if (deduped) {
    add({
      group: "Run",
      name: "duplicates collapsed",
      status: "info",
      detail: `${n(deduped)} byte-identical repeats removed (re-extraction after a partial run)`,
    });
  }

  // --- account for it ------------------------------------------------------

  const endBudget = await readBudget().catch(() => null);
  const keyDelta =
    startedBudget && endBudget ? Math.max(0, endBudget.usage - startedBudget.usage) : null;
  const price = await priceOf(model);
  const priced =
    price === null ? null : promptTokens * price.prompt + completionTokens * price.completion;
  // Prefer the priced figure; fall back to the key delta when the slug is gone
  // from the model list.
  const spend = priced ?? keyDelta;
  const totalFacts = [...counts.values()].reduce((a, b) => a + b, 0);
  const totalSnippetRejects = [...rejSnippet.values()].reduce((a, b) => a + b, 0);
  const totalValidateRejects = [...rejValidate.values()].reduce((a, b) => a + b, 0);
  const totalReturned = [...returned.values()].reduce((a, b) => a + b, 0);
  const jobsRun = new Set(tasks.map((t) => t.job.jobId)).size;
  const sumOf = (m: Map<string, Map<string, number>>, ft: string): number =>
    [...(m.get(ft)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const totalNulled = selected.reduce((a, e) => a + sumOf(nulled, e.factType), 0);
  const totalCopyDropped = selected.reduce((a, e) => a + sumOf(droppedCopy, e.factType), 0);

  for (const ex of selected) {
    const facts = counts.get(ex.factType) ?? 0;
    const withFacts = jobsWithFacts.get(ex.factType)!.size;
    const target = ex.expectedJobs;
    add({
      group: "Extracted",
      name: ex.factType,
      status: target && withFacts < target * 0.5 && !limit ? "warn" : "pass",
      detail:
        `${n(facts)} facts on ${n(withFacts)} jobs` +
        (target ? ` (corpus target ~${n(target)} jobs)` : "") +
        `, ${n(rejSnippet.get(ex.factType) ?? 0)} snippet-rejected` +
        (rejValidate.get(ex.factType) ? `, ${n(rejValidate.get(ex.factType)!)} filtered` : ""),
    });
  }

  // --- the copy-field gate, per extractor and per field --------------------
  //
  // Printed even when it found nothing, for any extractor that declares copy
  // fields: "nothing was fabricated" is a result, and a silent gate is one
  // nobody notices has stopped working.
  for (const ex of selected) {
    const declared = copyFieldsOf(ex);
    if (!declared.length) continue;
    const nulls = nulled.get(ex.factType)!;
    const drops = droppedCopy.get(ex.factType)!;
    const found = [
      ...[...nulls].sort((a, b) => b[1] - a[1]).map(([f, c]) => `${f} ${n(c)} nulled`),
      ...[...drops].sort((a, b) => b[1] - a[1]).map(([f, c]) => `${f} ${n(c)} facts dropped`),
    ];
    add({
      group: "Copy-field provenance",
      name: ex.factType,
      status: found.length ? "warn" : "pass",
      detail:
        `checked ${declared.map((c) => c.field + (c.in && c.in !== "note" ? ` (in ${c.in})` : "")).join(", ")} — ` +
        (found.length ? found.join(", ") : "every declared copy was found in its note"),
    });
  }
  if (totalNulled || totalCopyDropped) {
    add({
      group: "Copy-field provenance",
      name: "total",
      status: "info",
      detail:
        `${n(totalNulled)} field values nulled because they are not in the source note` +
        (totalCopyDropped
          ? `, ${n(totalCopyDropped)} facts dropped whole (the fabricated field is non-nullable)`
          : ""),
    });
  }

  add({
    group: "Run",
    name: "rejection rate",
    status:
      totalReturned === 0 ? "warn" : totalSnippetRejects / totalReturned > 0.1 ? "warn" : "pass",
    detail:
      totalReturned === 0
        ? "no facts returned"
        : `${((totalSnippetRejects / totalReturned) * 100).toFixed(1)}% — ${n(totalSnippetRejects)} of ${n(totalReturned)} returned facts failed the verbatim snippet check`,
  });
  add({
    group: "Run",
    name: "precision filter",
    status: "info",
    detail:
      totalReturned === 0
        ? "n/a"
        : `${n(totalValidateRejects)} further facts dropped by an extractor's own validate() ` +
          `(${((totalValidateRejects / totalReturned) * 100).toFixed(1)}%)`,
  });
  add({
    group: "Run",
    name: "failed calls",
    status: failures === 0 ? "pass" : "warn",
    detail: failures === 0 ? "none" : `${n(failures)} — those jobs stay uncovered and retry next run`,
  });
  add({
    group: "Run",
    name: "tokens",
    status: "info",
    detail: `${n(promptTokens)} in / ${n(completionTokens)} out`,
  });
  if (spend !== null) {
    add({
      group: "Run",
      name: "spend",
      status: "info",
      detail:
        `$${spend.toFixed(4)}` +
        (priced !== null && price
          ? ` (${promptTokens.toLocaleString()} in @ $${(price.prompt * 1e6).toFixed(2)}/M + ` +
            `${completionTokens.toLocaleString()} out @ $${(price.completion * 1e6).toFixed(2)}/M)`
          : "") +
        (keyDelta !== null ? ` · key usage moved $${keyDelta.toFixed(4)}` : ""),
    });
    if (jobsRun > 0) {
      const perJob = spend / jobsRun;
      const remainingJobs = Math.max(0, 1878 - jobsRun);
      add({
        group: "Run",
        name: "projection",
        status: "info",
        detail:
          `$${perJob.toFixed(5)}/job · full corpus of 1,878 noted jobs ≈ $${(perJob * 1878).toFixed(2)}` +
          (remainingJobs ? ` · ${n(remainingJobs)} jobs left ≈ $${(perJob * remainingJobs).toFixed(2)}` : ""),
      });
    }
  }
  if (endBudget?.remaining != null) {
    add({ group: "Run", name: "credit left", status: "info", detail: `$${endBudget.remaining.toFixed(4)}` });
  }
  if (halted) add({ group: "Run", name: "HALTED", status: "fail", detail: halted });

  await retry("close pipeline_run", () =>
    withTenant(
      (sql: Sql) => sql`
        update pipeline_run
           set status = ${halted ? "halted" : "ok"},
               finished_at = now(),
               rows_out = ${totalFacts},
               cost_usd = ${spend},
               error = ${halted},
               detail = detail || ${sql.json({
                 facts_by_type: Object.fromEntries(counts),
                 snippet_rejections_by_type: Object.fromEntries(rejSnippet),
                 validate_rejections_by_type: Object.fromEntries(rejValidate),
                 copy_fields_nulled_by_type: Object.fromEntries(
                   [...nulled].map(([k, v]) => [k, Object.fromEntries(v)]),
                 ),
                 copy_field_facts_dropped_by_type: Object.fromEntries(
                   [...droppedCopy].map(([k, v]) => [k, Object.fromEntries(v)]),
                 ),
                 facts_returned_by_type: Object.fromEntries(returned),
                 jobs_with_facts: Object.fromEntries(
                   [...jobsWithFacts].map(([k, v]) => [k, v.size]),
                 ),
                 failed_calls: failures,
                 prompt_tokens: promptTokens,
                 completion_tokens: completionTokens,
                 spend_usd: spend,
               } as never)}
         where id = ${runId}
      `,
    ),
  );

  render("Front Desk — extraction");
  console.log(
    halted
      ? `  Halted on budget. ${n(totalFacts)} facts written and recorded as covered; re-run to continue.\n`
      : `  ${n(totalFacts)} facts written. Next: pnpm test:extract-integrity\n`,
  );
  return halted ? 1 : 0;
}

const code = await main().catch((e: unknown) => {
  console.error(`\n  extraction failed: ${(e as Error).message}\n`);
  return 1;
});
await closeDb();
process.exit(code);
