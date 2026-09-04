/**
 * Property resolver — turns what a caller says out loud into ranked candidate
 * properties. Serves task 7 of `.claude/plans/front-desk.plan.md`.
 *
 * This is the most safety-critical module in the build. The worst thing this
 * system can do is confidently read the wrong customer's history, balance or
 * door code aloud, and every decision below is shaped by that:
 *
 *   1. The return type is ALWAYS a list plus a confidence. There is no shape in
 *      which this module can hand back "the property" — a caller of
 *      `resolveProperty` is forced to handle ambiguity.
 *   2. `decision: "resolved"` requires exactly one candidate to survive a
 *      structural gate. Two close candidates is `needs_unit` or `needs_more`,
 *      never a coin flip.
 *   3. **The house number is a hard equality gate, not a similarity input.**
 *      This is the single most important rule here. Measured in this corpus,
 *      the genuinely-different addresses that sound alike over a phone sit at
 *      trigram similarity 0.75–0.80:
 *
 *          similarity('112 marlin hollow dr', '122 marlin hollow dr') = 0.75
 *          similarity('103 grouper landing rd', '11 grouper landing rd') = 0.80
 *
 *      while a caller legitimately dropping the suffix and the directional
 *      bottoms out at 0.53 (measured over all 1,326 non-blank properties, p01 =
 *      0.58). The two populations OVERLAP: there is no trigram threshold that
 *      admits real callers and excludes `122` when they said `112`. Similarity
 *      therefore ranks and recalls; it never decides. The house number decides.
 *   4. City and ZIP are accepted on the input and then deliberately IGNORED.
 *      The export contradicts itself — ZIP 33162 spans 6 cities, and
 *      `213 Skimmer Cove Ln` is filed under both 33155 and 33162 — so a ZIP
 *      mismatch is not disproof and a ZIP match is not confirmation. The
 *      disambiguator this module offers instead is the UNIT and the LAST
 *      SERVICE DATE, both of which the data does support.
 *   5. A bare last name or a bare company name never reaches the database.
 *      Last name alone resolves to one customer 7.9% of the time; a brand name
 *      0.0% of the time (12 brands over 84 customer IDs). There is no query
 *      that makes those numbers safe, so there is no query.
 *
 * Normalization is NOT reimplemented here — every spelling rule lives in
 * `./address.ts`, which is what built `property.canonical_key` and
 * `property.street_norm` in the first place. This module imports it so the
 * resolver and the loader can never drift apart.
 *
 * Verified properties of the loaded table that this module relies on
 * (1,327 rows, tenant `gulf-breeze-air`):
 *   - `split_part(canonical_key,'|',1) = street_norm` on every row.
 *   - `(street_norm, unit)` is UNIQUE — 0 duplicate pairs. An exact street plus
 *     an exact unit therefore identifies at most one property, by construction.
 *   - 1 row is entirely blank (`street_raw = ''`); it is excluded from every
 *     query and can never be a candidate.
 *   - 16 rows carry no house number; they are reachable only through the exact
 *     canonical-key path, which is why that path is exempt from rule 3.
 */
import { TZ } from "../config.js";
import { withTenant, type Sql } from "../db/client.js";
import {
  DIRECTIONALS,
  STREET_SUFFIXES,
  canonicalKey,
  extractUnit,
  normalizeStreet,
  normalizeUnit,
} from "./address.js";

// --- thresholds ------------------------------------------------------------
//
// Hoisted so a change is a one-line table edit and shows up in a diff, per the
// EDA convention (eda/scripts/dq_common.py:6-8). Every number below is measured
// against the loaded corpus, not guessed. Never loosen one to make a test pass.

/** pg_trgm cutoff for pulling a row into the candidate set at all. Recall only. */
export const CANDIDATE_MIN_SIMILARITY = 0.3;

/**
 * Floor a candidate's street similarity must clear to be eligible to resolve.
 * Measured: dropping both the suffix and the directional from a real street
 * bottoms out at 0.53 (min over 1,326 properties), p01 = 0.58. 0.5 keeps those
 * callers; anything below it is a caller saying a street we do not have.
 */
export const RESOLVE_MIN_SIMILARITY = 0.5;

/** Composite confidence a single surviving candidate must clear to resolve. */
export const RESOLVE_MIN_CONFIDENCE = 0.75;

/** Confidence bases by how the street itself matched. */
const BASE_CANONICAL_KEY = 1.0;
const BASE_STREET_EXACT = 0.96;
const BASE_STREET_TOKENS = 0.9;

/** Multipliers by how the unit lined up. */
const UNIT_EXACT = 1.0;
const UNIT_BOTH_ABSENT = 1.0;
/** Caller named no unit and the one property here has one — identity still unique. */
const UNIT_UNKNOWN = 0.9;
/** Caller named a unit and the one property here has none on file. */
const UNIT_NOT_ON_FILE = 0.85;

/** Rows pulled from the database before ranking. The whole table is 1,327. */
const FETCH_LIMIT = 400;

/** Candidates returned to the caller. 18 units live at one address, so this is generous. */
const DEFAULT_LIMIT = 60;

/** Canonical suffix and directional tokens, i.e. the *values* address.ts folds onto. */
const MODIFIER_TOKENS: ReadonlySet<string> = new Set([
  ...Object.values(STREET_SUFFIXES),
  ...Object.values(DIRECTIONALS),
]);

// --- types -----------------------------------------------------------------

/** What a caller managed to say. Every field is optional; most callers give two. */
export interface PropertyQuery {
  streetNumber?: string | number | null;
  streetName?: string | null;
  /** The whole spoken street in one string, e.g. "550 Cormorant Reef". */
  rawStreet?: string | null;
  unit?: string | null;
  /** Accepted and ignored — see rule 4 in the module docstring. */
  city?: string | null;
  /** Accepted and ignored — see rule 4 in the module docstring. */
  zip?: string | null;
  lastName?: string | null;
  company?: string | null;
}

export type ResolutionDecision = "resolved" | "needs_unit" | "needs_more" | "not_found";

/** What the agent should ask for next. Never "city" and never "zip". */
export type AskFor = "unit" | "street_number" | "street_name" | "last_service_date";

export type UnitMatch = "exact" | "none_given" | "not_on_file" | "mismatch";

export type MatchSignal =
  | "canonical_key"
  | "street_exact"
  | "street_tokens"
  | "house_number"
  | "trigram"
  | "unit_exact";

/**
 * One possible property, carrying the evidence that put it here so the agent can
 * read a disambiguator back to the caller instead of guessing.
 */
export interface PropertyCandidate {
  readonly id: string;
  readonly canonicalKey: string;
  readonly streetRaw: string;
  readonly streetNorm: string;
  readonly unit: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
  readonly lastVisitAt: Date | null;
  readonly nextVisitAt: Date | null;
  readonly visitCount: number;
  /** pg_trgm similarity between the spoken street and this property's street. */
  readonly similarity: number;
  /** Confidence this candidate is the property meant, were it chosen. 0–1. */
  readonly confidence: number;
  /** False when this row failed the structural gate. Never resolvable. */
  readonly eligible: boolean;
  readonly matchedOn: readonly MatchSignal[];
  readonly houseNumberMatch: boolean;
  readonly unitMatch: UnitMatch;
  /** Unit plus last service date — the only two disambiguators this data supports. */
  readonly disambiguator: string;
}

/** The normalized reading of the utterance, echoed back for logging and tests. */
export interface NormalizedQuery {
  /** Street as matched, unit stripped, suffixes and directionals folded. */
  readonly street: string;
  readonly houseNumber: string | null;
  /** Street-name tokens excluding the house number, suffixes and directionals. */
  readonly coreTokens: readonly string[];
  readonly modifierTokens: readonly string[];
  readonly unit: string | null;
  /** True when number words ("five fifty") were expanded to digits. */
  readonly spokenNumbersExpanded: boolean;
  readonly canonicalKey: string | null;
}

/**
 * Always a list. There is deliberately no field holding a single property:
 * every consumer has to look at `decision` before it looks at a candidate.
 */
export interface ResolutionResult {
  readonly candidates: readonly PropertyCandidate[];
  /** Confidence that `candidates[0]` is the property the caller means. 0–1. */
  readonly confidence: number;
  readonly decision: ResolutionDecision;
  readonly askFor?: AskFor;
  /** Eligible candidates found, before `limit` truncated the list. */
  readonly totalCandidates: number;
  readonly query: NormalizedQuery;
  /** Plain-language reason, for logs and for the agent's own explanation. */
  readonly reason: string;
}

export interface ResolveOptions {
  /** Maximum candidates returned. Default 60. */
  readonly limit?: number;
  readonly tenantId?: string;
  /**
   * An already-scoped connection to run on, such as the one a call holds.
   *
   * Without it this opens its own transaction, which is four round trips before
   * a row is read and measured 1.9 seconds on the live agent path. It is also
   * what puts the lookup into the call trace, since a query on a connection
   * nobody is watching is a query nobody can see.
   */
  readonly sql?: Sql;
}

// --- spoken numbers --------------------------------------------------------

const NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
});
const TENS: ReadonlySet<string> = new Set([
  "twenty", "thirty", "forty", "fourty", "fifty", "sixty", "seventy", "eighty", "ninety",
]);

/**
 * Turn a spoken house number into digits: "five fifty" -> "550",
 * "one three six three" -> "1363", "eleven sixty three" -> "1163",
 * "five hundred fifty" -> "550", "twelve twenty two" -> "1222".
 *
 * Chunks are CONCATENATED, not summed, because that is how house numbers are
 * said. Safe to run over any street in this corpus: zero street names contain a
 * number word (checked against all 1,326 non-blank `street_norm` values), so a
 * conversion can never eat part of a street name. A wrong conversion fails
 * closed — it produces a house number that matches nothing, which is
 * `not_found`, never a wrong property.
 */
export function expandSpokenNumbers(text: string): { text: string; expanded: boolean } {
  const tokens = text.trim().split(/\s+/).filter((t) => t !== "");
  if (tokens.length === 0) return { text, expanded: false };

  const isWord = (t: string): boolean =>
    Object.prototype.hasOwnProperty.call(NUMBER_WORDS, t.toLowerCase().replace(/[^a-z]/g, "")) ||
    t.toLowerCase().replace(/[^a-z]/g, "") === "hundred" ||
    t.toLowerCase().replace(/[^a-z]/g, "") === "thousand";

  // Leading run of number words, or — when nothing leads with a digit — a
  // trailing one ("Cormorant Reef, five fifty").
  let lead = 0;
  while (lead < tokens.length && isWord(tokens[lead]!)) lead += 1;
  if (lead > 0 && lead < tokens.length) {
    const digits = chunksToDigits(tokens.slice(0, lead));
    if (digits === null) return { text, expanded: false };
    return { text: [digits, ...tokens.slice(lead)].join(" "), expanded: true };
  }

  if (/^\d/.test(tokens[0]!)) return { text, expanded: false };
  let tail = tokens.length;
  while (tail > 0 && isWord(tokens[tail - 1]!)) tail -= 1;
  if (tail > 0 && tail < tokens.length) {
    const digits = chunksToDigits(tokens.slice(tail));
    if (digits === null) return { text, expanded: false };
    return { text: [digits, ...tokens.slice(0, tail)].join(" "), expanded: true };
  }
  return { text, expanded: false };
}

/** "five hundred fifty" -> "550"; "one three six three" -> "1363"; null if unparseable. */
function chunksToDigits(tokens: string[]): string | null {
  const words = tokens.map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
  const chunks: number[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    if (w === "hundred" || w === "thousand") {
      const scale = w === "hundred" ? 100 : 1000;
      const prev = chunks.pop();
      if (prev === undefined) return null;
      let value = prev * scale;
      // Absorb what follows additively: "five hundred fifty" = 550.
      const next = words[i + 1];
      if (next !== undefined && next !== "hundred" && next !== "thousand") {
        const nv = NUMBER_WORDS[next];
        if (nv !== undefined) {
          let add = nv;
          const after = words[i + 2];
          if (TENS.has(next) && after !== undefined && NUMBER_WORDS[after] !== undefined &&
              NUMBER_WORDS[after]! < 10) {
            add += NUMBER_WORDS[after]!;
            i += 1;
          }
          value += add;
          i += 1;
        }
      }
      chunks.push(value);
      continue;
    }
    const v = NUMBER_WORDS[w];
    if (v === undefined) return null;
    // "twenty two" is one chunk worth 22, not two chunks worth "202".
    const next = words[i + 1];
    if (TENS.has(w) && next !== undefined && NUMBER_WORDS[next] !== undefined &&
        NUMBER_WORDS[next]! < 10 && next !== "oh" && next !== "o" && next !== "zero") {
      chunks.push(v + NUMBER_WORDS[next]!);
      i += 1;
      continue;
    }
    chunks.push(v);
  }
  if (chunks.length === 0) return null;
  return chunks.map(String).join("");
}

// --- utterance -> normalized query -----------------------------------------

const HOUSE_NUMBER = /^\d+[a-z]?$/;

/**
 * The same street with the spaces taken out.
 *
 * A caller rang the live number and asked about "200 Gulf Stream Glenway". The
 * book holds "200 Gulfstream Glen Way" — one property, spelled with the spaces
 * in different places — and the agent told them it had no such address. The
 * house number matched and the trigram score was fine; the gate failed on
 * `containsCore`, because the query's tokens were gulf / stream / glenway and
 * the row's were gulfstream / glen, which share nothing.
 *
 * Comparing the whole street with every space removed settles it: both sides
 * read gulfstreamglenway. This is stricter than the trigram, not looser — it is
 * whole-string equality — so it cannot pull in a street that is merely similar,
 * only one that is the same street typed differently. Two genuinely different
 * streets that differ only in spacing would be ambiguous to a human too.
 */
function deSpaced(tokens: readonly string[]): string {
  return tokens.join("");
}

function splitStreet(norm: string): { houseNumber: string | null; tokens: string[] } {
  const tokens = norm === "" ? [] : norm.split(" ");
  const first = tokens[0];
  if (first !== undefined && HOUSE_NUMBER.test(first)) {
    return { houseNumber: first, tokens: tokens.slice(1) };
  }
  return { houseNumber: null, tokens };
}

/** Street-name tokens with suffixes and directionals removed. */
function coreOf(tokens: readonly string[]): string[] {
  return tokens.filter((t) => !MODIFIER_TOKENS.has(t));
}

function modifiersOf(tokens: readonly string[]): string[] {
  return tokens.filter((t) => MODIFIER_TOKENS.has(t));
}

/**
 * Read an utterance into the same coordinate system the property table was
 * built in. `rawStreet` wins where both it and `streetNumber`/`streetName` are
 * given, except that a `streetNumber` is prepended when `rawStreet` has none —
 * a caller who says the number separately still gets the gate applied.
 */
export function normalizeQuery(input: PropertyQuery): NormalizedQuery {
  const rawStreet = typeof input.rawStreet === "string" ? input.rawStreet.trim() : "";
  const number =
    input.streetNumber === null || input.streetNumber === undefined
      ? ""
      : String(input.streetNumber).trim();
  const name = typeof input.streetName === "string" ? input.streetName.trim() : "";

  let base = rawStreet !== "" ? rawStreet : [number, name].filter((s) => s !== "").join(" ");
  const spoken = expandSpokenNumbers(base);
  base = spoken.text;
  if (rawStreet !== "" && number !== "" && !/^\s*\d/.test(base)) base = `${number} ${base}`;

  const parts = extractUnit(base, input.unit ?? null);
  const street = normalizeStreet(parts.street);
  const unit = parts.unit ?? normalizeUnit(input.unit ?? null);
  const { houseNumber, tokens } = splitStreet(street);

  return {
    street,
    houseNumber,
    coreTokens: coreOf(tokens),
    modifierTokens: modifiersOf(tokens),
    unit,
    spokenNumbersExpanded: spoken.expanded,
    canonicalKey:
      street === "" || unit === null ? null : canonicalKey({ street, unit, zip: null }),
  };
}

// --- database --------------------------------------------------------------

interface Row {
  id: string;
  canonical_key: string;
  street_raw: string;
  street_norm: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  last_visit_at: Date | null;
  next_visit_at: Date | null;
  visit_count: number;
  sim: number;
}

const RETRIES = 5;

const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EMAXCONNSESSION",
  // Local ephemeral-port exhaustion. Every resolve opens its own short
  // transaction, so a sweep over the 18 units behind one street address burns
  // ~72 outbound sockets in a few seconds and the OS runs out. Observed as a
  // hard failure 102 seconds into an otherwise-passing suite — a machine
  // condition, not an answer, and exactly what a retry is for.
  "EADDRNOTAVAIL",
  "EADDRINUSE",
  "EPIPE",
  "53300", // too_many_connections
  "57P01", // admin_shutdown
]);

/**
 * The pooler is free tier, shared, and capped at 15 session-mode clients. A
 * timeout or an exhausted pool is a transient condition, not an answer — and
 * an answer is exactly what a resolver must never invent. Retry, then fail
 * loudly; never degrade into "no candidates", which reads as `not_found` and
 * would tell a caller their own address does not exist.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const code = String((err as { code?: unknown } | null)?.code ?? "");
      const message = String((err as { message?: unknown } | null)?.message ?? "");
      const transient =
        TRANSIENT_CODES.has(code) ||
        /max clients reached|too many connections|EMAXCONN/i.test(message);
      if (!transient || attempt === RETRIES - 1) throw err;
      // Backoff with jitter, so parallel callers do not retry in lockstep.
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt + Math.random() * 200));
    }
  }
  throw last;
}

/**
 * One round trip, three recall paths in one predicate, in the order task 7 asks
 * for: exact canonical key, then trigram on the street, then house number +
 * street tokens. Every path is index-backed (`property_tenant_canonical_key`,
 * `property_street_norm_trgm`).
 *
 * Every query goes through `withTenant` — the connecting `postgres` role holds
 * BYPASSRLS, so anything outside it silently ignores row-level security.
 */
async function fetchRows(
  q: NormalizedQuery,
  tenantId: string | undefined,
  provided?: Sql,
): Promise<Row[]> {
  const prefix = q.houseNumber === null ? null : `${q.houseNumber} %`;

  const run = async (sql: Sql, local: boolean): Promise<Row[]> => {
    // Transaction-local when we own the transaction, session-level when we were
    // handed a call connection: `set local` outside a transaction silently does
    // nothing, and a similarity threshold that silently does nothing changes
    // which properties are candidates.
    await sql`select set_config('pg_trgm.similarity_threshold', ${String(
      CANDIDATE_MIN_SIMILARITY,
    )}, ${local})`;
    const rows = await sql<Row[]>`
        select id::text as id,
               canonical_key,
               street_raw,
               street_norm,
               unit, city, state, zip,
               last_visit_at, next_visit_at, visit_count,
               coalesce(similarity(street_norm, ${q.street}), 0)::float8 as sim
          from property
         where street_norm is not null
           and street_norm <> ''
           and ( street_norm = ${q.street}
              or street_norm % ${q.street}
              or (${q.canonicalKey}::text is not null and canonical_key = ${q.canonicalKey}::text)
              or (${prefix}::text is not null and street_norm like ${prefix}::text) )
         order by sim desc, last_visit_at desc nulls last, visit_count desc
         limit ${FETCH_LIMIT}`;
    return rows;
  };

  // A caller who already holds a scoped connection gets to use it. `withTenant`
  // is BEGIN, setup, query, COMMIT: four round trips at ~140ms each before a
  // row is read, which measured 1.9 seconds on the live agent path for a single
  // address lookup. The same query on the call's own connection is one trip,
  // and it is also the only way the query shows up in the call trace at all.
  if (provided) return withRetry(() => run(provided, false));
  return withRetry(() =>
    withTenant((sql) => run(sql as unknown as Sql, true), tenantId),
  );
}

// --- scoring ---------------------------------------------------------------

interface Scored {
  row: Row;
  houseNumberMatch: boolean;
  streetExact: boolean;
  canonicalExact: boolean;
  containsCore: boolean;
  modifiersAgree: boolean;
  eligible: boolean;
  unitMatch: UnitMatch;
  confidence: number;
  matchedOn: MatchSignal[];
}

function score(q: NormalizedQuery, row: Row): Scored {
  const split = splitStreet(row.street_norm);
  const core = coreOf(split.tokens);
  const coreSet = new Set(core);
  const tokenSet = new Set(split.tokens);

  const canonicalExact = q.canonicalKey !== null && row.canonical_key === q.canonicalKey;
  const streetExact = row.street_norm === q.street;
  const houseNumberMatch =
    q.houseNumber !== null && split.houseNumber !== null && split.houseNumber === q.houseNumber;
  // Spacing is not spelling. See deSpaced above: "gulf stream glenway" and
  // "gulfstream glen way" are one street, and a caller says whichever they see.
  const qSplit = splitStreet(q.street);
  const sameLettersNoSpaces =
    split.tokens.length > 0 &&
    qSplit.tokens.length > 0 &&
    deSpaced(split.tokens) === deSpaced(qSplit.tokens);
  const containsCore =
    sameLettersNoSpaces ||
    (q.coreTokens.length > 0 && q.coreTokens.every((t) => coreSet.has(t)));
  const modifiersAgree = q.modifierTokens.every((t) => tokenSet.has(t));

  // --- the gate. The house number must be equal, full stop: at trigram 0.75
  // '122 Marlin Hollow Dr' would otherwise pass for '112'. The single exemption
  // is an exact canonical-key hit, which is street AND unit equality and is the
  // only way the 16 house-number-less properties are reachable.
  const eligible =
    canonicalExact ||
    (houseNumberMatch && containsCore && row.sim >= RESOLVE_MIN_SIMILARITY);

  const base = canonicalExact
    ? BASE_CANONICAL_KEY
    : streetExact
      ? BASE_STREET_EXACT
      : BASE_STREET_TOKENS;

  const unitMatch: UnitMatch =
    q.unit === null
      ? "none_given"
      : row.unit === null
        ? "not_on_file"
        : row.unit.toUpperCase() === q.unit.toUpperCase()
          ? "exact"
          : "mismatch";

  const factor =
    unitMatch === "exact"
      ? UNIT_EXACT
      : unitMatch === "not_on_file"
        ? UNIT_NOT_ON_FILE
        : q.unit === null && row.unit === null
          ? UNIT_BOTH_ABSENT
          : q.unit === null
            ? UNIT_UNKNOWN
            : 0; // mismatch: this row is not what the caller asked for

  const matchedOn: MatchSignal[] = [];
  if (canonicalExact) matchedOn.push("canonical_key");
  if (streetExact) matchedOn.push("street_exact");
  if (houseNumberMatch) matchedOn.push("house_number");
  if (containsCore) matchedOn.push("street_tokens");
  if (row.sim >= CANDIDATE_MIN_SIMILARITY) matchedOn.push("trigram");
  if (unitMatch === "exact") matchedOn.push("unit_exact");

  return {
    row,
    houseNumberMatch,
    streetExact,
    canonicalExact,
    containsCore,
    modifiersAgree,
    eligible,
    unitMatch,
    confidence: round(base * factor),
    matchedOn,
  };
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "long",
  day: "numeric",
});

/**
 * The phrase the agent may read back. Unit and last service date only — city
 * and ZIP are excluded on purpose, because the export disagrees with itself
 * about both and a caller confirming a wrong city sounds like agreement.
 */
function disambiguatorFor(row: Row): string {
  const unit = row.unit === null ? "no unit on file" : `unit ${row.unit}`;
  const visit =
    row.last_visit_at === null
      ? "no completed visit on file"
      : `last serviced ${DATE_FMT.format(new Date(row.last_visit_at))}`;
  return `${unit}, ${visit}`;
}

function toCandidate(s: Scored, confidence: number): PropertyCandidate {
  return {
    id: s.row.id,
    canonicalKey: s.row.canonical_key,
    streetRaw: s.row.street_raw,
    streetNorm: s.row.street_norm,
    unit: s.row.unit,
    city: s.row.city,
    state: s.row.state,
    zip: s.row.zip,
    lastVisitAt: s.row.last_visit_at === null ? null : new Date(s.row.last_visit_at),
    nextVisitAt: s.row.next_visit_at === null ? null : new Date(s.row.next_visit_at),
    visitCount: Number(s.row.visit_count),
    similarity: round(Number(s.row.sim)),
    confidence: round(confidence),
    eligible: s.eligible,
    matchedOn: s.matchedOn,
    houseNumberMatch: s.houseNumberMatch,
    unitMatch: s.unitMatch,
    disambiguator: disambiguatorFor(s.row),
  };
}

/** Similarity first, then recency of the last completed visit, then volume. */
function rank(a: Scored, b: Scored): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.row.sim !== b.row.sim) return b.row.sim - a.row.sim;
  const at = a.row.last_visit_at === null ? 0 : new Date(a.row.last_visit_at).getTime();
  const bt = b.row.last_visit_at === null ? 0 : new Date(b.row.last_visit_at).getTime();
  if (at !== bt) return bt - at;
  if (a.row.visit_count !== b.row.visit_count) return b.row.visit_count - a.row.visit_count;
  return a.row.id.localeCompare(b.row.id);
}

// --- resolve ---------------------------------------------------------------

function result(
  decision: ResolutionDecision,
  candidates: PropertyCandidate[],
  confidence: number,
  query: NormalizedQuery,
  reason: string,
  askFor?: AskFor,
  limit = DEFAULT_LIMIT,
): ResolutionResult {
  return {
    candidates: candidates.slice(0, limit),
    confidence: round(confidence),
    decision,
    ...(askFor === undefined ? {} : { askFor }),
    totalCandidates: candidates.length,
    query,
    reason,
  };
}

/**
 * Resolve an utterance to ranked candidate properties.
 *
 * Returns a list every time. `decision` says what the agent is allowed to do
 * with it, and only `"resolved"` — exactly one candidate through the gate —
 * permits reading anything about that property back to the caller.
 */
export async function resolveProperty(
  input: PropertyQuery,
  opts: ResolveOptions = {},
): Promise<ResolutionResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const q = normalizeQuery(input);

  // --- no address at all. A last name resolves to one customer 7.9% of the
  // time and a brand name 0.0% of the time, so neither is looked up: the agent
  // is sent back for the address instead of being handed a set to guess from.
  if (q.street === "" || q.coreTokens.length === 0) {
    const named =
      (typeof input.lastName === "string" && input.lastName.trim() !== "") ||
      (typeof input.company === "string" && input.company.trim() !== "");
    const hasNumberOnly = q.houseNumber !== null && q.coreTokens.length === 0;
    return result(
      "needs_more",
      [],
      0,
      q,
      hasNumberOnly
        ? "A house number with no street name. 259 house numbers are reused across 955 addresses here, so the number alone identifies nothing."
        : named
          ? "A name with no address. A last name alone resolves to one customer 7.9% of the time and a company name 0.0%, so no lookup was attempted."
          : "No street was given.",
      hasNumberOnly ? "street_name" : "street_number",
      limit,
    );
  }

  const rows = await fetchRows(q, opts.tenantId, opts.sql);
  const scored = rows.map((r) => score(q, r)).sort(rank);
  const eligible = scored.filter((s) => s.eligible);

  // --- a street with no number. 'street name only' resolves to one address
  // 33.9% of the time and the fifteen busiest streets host 8-86 addresses each
  // (Old Mangrove 86, Bayfront 48), so the number is asked for rather than
  // guessed at. The list is still returned, because its LENGTH is the useful
  // thing to say out loud ("I have 86 addresses on Old Mangrove").
  if (q.houseNumber === null && eligible.length === 0) {
    const byName = scored.filter((s) => s.containsCore);
    if (byName.length > 0) {
      return result(
        "needs_more",
        byName.map((s) => toCandidate(s, s.confidence)),
        byName[0]!.confidence / byName.length,
        q,
        `${byName.length} propert${byName.length === 1 ? "y is" : "ies are"} on that street and no house number was given.`,
        "street_number",
        limit,
      );
    }
  }

  if (eligible.length === 0) {
    // Deliberately no candidates: the near misses that a trigram pulled in
    // differ by house number, and handing them back invites the agent to read
    // one aloud. A nonexistent address is not a low-confidence guess.
    return result(
      "not_found",
      [],
      0,
      q,
      q.houseNumber === null
        ? "No property matches that street."
        : `No property at house number ${q.houseNumber} on that street. ${
            scored.length
          } similar-sounding address(es) were seen and discarded on the house number.`,
      q.houseNumber === null ? "street_number" : undefined,
      limit,
    );
  }

  // --- pick the street. Distinct street_norm values are distinct places:
  // address.ts already folded the 51 suffix/direction spelling pairs together
  // before these rows were written, so two survivors here mean two real streets.
  let pool = eligible;
  const exact = pool.filter((s) => s.streetExact || s.canonicalExact);
  if (exact.length > 0) {
    pool = exact;
  } else if (q.modifierTokens.length > 0) {
    // The caller said "Drive" or "West"; prefer streets that agree with them.
    const agreeing = pool.filter((s) => s.modifiersAgree);
    if (agreeing.length > 0) pool = agreeing;
  }

  const streets = new Set(pool.map((s) => s.row.street_norm));
  if (streets.size > 1) {
    const cands = pool.map((s) => toCandidate(s, s.confidence));
    return result(
      "needs_more",
      cands,
      pool[0]!.confidence / pool.length,
      q,
      `${streets.size} different streets match what was said (${[...streets].join(
        "; ",
      )}). Confirm with the date of the last service visit, never with the city or ZIP.`,
      "last_service_date",
      limit,
    );
  }

  const group = pool.filter((s) => s.row.street_norm === pool[0]!.row.street_norm);

  // --- unit.
  if (q.unit !== null) {
    const hit = group.filter((s) => s.unitMatch === "exact");
    if (hit.length === 1) {
      const only = hit[0]!;
      return only.confidence >= RESOLVE_MIN_CONFIDENCE
        ? result("resolved", [toCandidate(only, only.confidence)], only.confidence, q,
            "Street and unit both matched exactly.", undefined, limit)
        : result("needs_unit", group.map((s) => toCandidate(s, s.confidence)),
            only.confidence, q,
            "The street match is too weak to act on even with a unit.", "unit", limit);
    }
    if (hit.length === 0 && group.length === 1) {
      const only = group[0]!;
      if (only.unitMatch === "not_on_file" && only.confidence >= RESOLVE_MIN_CONFIDENCE) {
        return result("resolved", [toCandidate(only, only.confidence)], only.confidence, q,
          `One property at that address and no unit on file for it; the spoken unit ${q.unit} could not be confirmed.`,
          undefined, limit);
      }
      return result("needs_unit", [toCandidate(only, only.confidence)], 0, q,
        `The one property at that address is ${only.row.unit ?? "unnumbered"}, not ${q.unit}.`,
        "unit", limit);
    }
    // Several properties here and none carries the unit that was said.
    const cands = group.map((s) => toCandidate(s, s.confidence));
    return result("needs_unit", cands, 0, q,
      `${group.length} properties share that street address and none is unit ${q.unit}.`,
      "unit", limit);
  }

  // --- no unit given.
  if (group.length === 1) {
    const only = group[0]!;
    if (only.confidence >= RESOLVE_MIN_CONFIDENCE) {
      return result("resolved", [toCandidate(only, only.confidence)], only.confidence, q,
        only.row.unit === null
          ? "Exactly one property at that address and it has no unit."
          : `Exactly one property at that address (unit ${only.row.unit}).`,
        undefined, limit);
    }
    return result("needs_more", [toCandidate(only, only.confidence)], only.confidence, q,
      "One candidate, but the street match is too weak to act on.", "last_service_date", limit);
  }

  // The condo case. 18 units sit behind '1363 W Old Mangrove Rd', under 18
  // different customers. Nothing may be read back before the unit is known.
  const cands = group.map((s) => toCandidate(s, s.confidence));
  return result("needs_unit", cands, pool[0]!.confidence / group.length, q,
    `${group.length} properties share that street address. Ask for the unit; if the caller does not know it, the last service date separates them.`,
    "unit", limit);
}
