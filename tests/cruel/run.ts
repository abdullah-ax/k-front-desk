/**
 * Cruel cases — the milestone gate (.claude/plans/front-desk.plan.md, task 14).
 *
 * This suite exercises `resolveProperty` DIRECTLY: no model, no network beyond
 * Postgres, no judgement. That is deliberate. The one thing this system must
 * never do is read a stranger's history, balance or door code to a caller, and
 * a gate that depends on a language model is a gate that can be talked out of
 * its verdict. Every case below has a known-correct answer written in the
 * property table itself, so the result is a number rather than an opinion.
 *
 * WRONG-RECORD RATE — the definition this file gates on:
 *
 *     A case is WRONG when `decision === "resolved"` and `candidates[0].id`
 *     is not the id of the property the input was generated from.
 *
 *     wrong_record_rate = wrong_cases / total_cases
 *
 * Note what is NOT wrong: refusing to resolve. `needs_unit`, `needs_more` and
 * `not_found` are all safe outcomes — the agent asks another question. Recall
 * is reported alongside so a future change that buys a zero rate by refusing
 * everything is visible immediately, but only the wrong-record rate is a gate.
 *
 * The four phases come from the ambiguities measured in this corpus:
 *
 *   1. 1363 W Old Mangrove Rd — 18 units, 18 different customers behind one
 *      street string. Without a unit it must never resolve; with each real
 *      unit it must resolve to exactly that one.
 *   2. Seven near-identical house-number pairs, tested in BOTH directions.
 *      These sit at trigram similarity 0.75-0.80 — inside the range a real
 *      caller dropping a suffix also occupies — which is precisely why the
 *      resolver gates on the house number rather than on similarity.
 *   3. Spoken degradation of real addresses: suffix dropped, direction
 *      dropped, number words, mixed case, stray whitespace. A phone line does
 *      all five.
 *   4. A sweep over real properties, each fed its own address back.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../src/config.js";
import { openCallConnection, closeDb } from "../../src/db/client.js";
import { resolveProperty, type ResolutionResult } from "../../src/domain/resolve-property.js";

// --- knobs -----------------------------------------------------------------
//
// Hoisted per the EDA convention (eda/scripts/dq_common.py:6-8).

/** The Supabase pooler caps at ~15 session clients. Three is polite and fast enough. */
const CONCURRENCY = 3;

/** Properties fed their own address back. The plan asks for at least 200. */
const SWEEP_SIZE = Number(process.env["CRUEL_SWEEP"] ?? 250);

/** Properties put through the five spoken-degradation variants. */
const DEGRADE_SIZE = Number(process.env["CRUEL_DEGRADE"] ?? 40);

/** The 18-unit address. Every phase-1 case is generated from this street. */
const MULTI_UNIT_STREET = "1363 w old mangrove rd";

/**
 * Near-identical pairs that must never cross-resolve, as (a, b) house numbers
 * on a shared street pattern. Both directions are tested for every property on
 * both sides, so `112 -> 122` and `122 -> 112` are separate cases.
 */
const NEAR_PAIRS: { a: string; b: string; street: string; label: string }[] = [
  { a: "112", b: "122", street: "marlin hollow", label: "112/122 Marlin Hollow Dr" },
  { a: "103", b: "11", street: "grouper landing", label: "103/11 Grouper Landing Rd" },
  { a: "1030", b: "130", street: "cowrie hollow", label: "1030/130 Cowrie Hollow Drive" },
  { a: "107", b: "157", street: "seagrape glen run", label: "107/157 Seagrape Glen Run E" },
  { a: "114", b: "145", street: "s leeward glen", label: "114/145 S Leeward Glen St" },
  { a: "10254", b: "2542", street: "e old mangrove", label: "10254/2542 E Old Mangrove Rd" },
  { a: "11", b: "19", street: "amberjack landing", label: "11/19 Amberjack Landing Rd" },
];

// --- types -----------------------------------------------------------------

interface PropertyRow {
  id: string;
  street_raw: string;
  street_norm: string;
  unit: string | null;
}

/** One resolution attempt with a known-correct answer. */
interface Case {
  phase: string;
  label: string;
  /** What the caller said. */
  utterance: string;
  unit: string | null;
  /** The property the utterance was generated from. */
  expectedId: string;
  /**
   * Ids this case must never resolve to. Empty means "anything but
   * `expectedId` is wrong", which is the default and the stricter reading.
   */
  forbiddenIds?: string[];
  /** True when a correct resolver is expected to refuse rather than resolve. */
  mustNotResolve?: boolean;
}

interface Outcome extends Case {
  decision: ResolutionResult["decision"];
  gotId: string | null;
  confidence: number;
  totalCandidates: number;
  reason: string;
  /** decision === "resolved" and the id is not `expectedId`. */
  wrong: boolean;
  /** Resolved when the case said it must not. A safety failure, not a wrong record. */
  overconfident: boolean;
  /**
   * Resolved onto the OTHER side of a near-identical pair. A strict subset of
   * `wrong`, tracked separately because it is the specific failure the house
   * number gate exists to prevent, and a regression there should be named.
   */
  crossResolved: boolean;
  /** Resolved to the right property. Reported, never gated on. */
  correct: boolean;
}

// --- helpers ---------------------------------------------------------------

/** Bounded parallelism. The pooler is shared and free tier; do not flood it. */
async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * `resolveProperty` already retries transient pooler errors, but this suite
 * runs hundreds of resolutions against a free-tier pooler and a second layer
 * costs nothing. Never swallow — a swallowed error would read as `not_found`,
 * which is exactly the lie this suite exists to prevent.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const text = `${String((err as { code?: unknown })?.code ?? "")} ${String((err as { message?: unknown })?.message ?? "")}`;
      if (!/CONNECT_TIMEOUT|EMAXCONN|max clients reached|too many connections|ECONNRESET|57P01/i.test(text)) throw err;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 300));
    }
  }
  throw last;
}

// --- utterance degradation -------------------------------------------------

const SUFFIXES = /\b(rd|road|dr|drive|st|street|ave|avenue|blvd|boulevard|ln|lane|ct|court|pkwy|parkway|ter|terrace|way|run|cove|trail|trl|cir|circle|pl|place)\b\.?/gi;
const DIRECTIONS = /\b(n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)\b\.?/gi;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TENS: Record<string, string> = {
  "2": "twenty", "3": "thirty", "4": "forty", "5": "fifty",
  "6": "sixty", "7": "seventy", "8": "eighty", "9": "ninety",
};

/**
 * Say a house number the way a person does. "550" -> "five fifty",
 * "1363" -> "thirteen sixty three", "11" -> "eleven". Falls back to
 * digit-by-digit, which is also how people read long numbers aloud.
 */
function spokenNumber(n: string): string | null {
  if (!/^\d+$/.test(n)) return null;
  const pair = (two: string): string | null => {
    const v = Number(two);
    if (v < 10) return ONES[v] ?? null;
    if (v < 20) {
      return ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
        "sixteen", "seventeen", "eighteen", "nineteen"][v - 10] ?? null;
    }
    const tens = TENS[two[0]!];
    if (!tens) return null;
    return two[1] === "0" ? tens : `${tens} ${ONES[Number(two[1])]}`;
  };
  if (n.length === 2) return pair(n);
  if (n.length === 3) return `${ONES[Number(n[0])]} ${pair(n.slice(1))}`;
  if (n.length === 4) {
    const a = pair(n.slice(0, 2));
    const b = pair(n.slice(2));
    return a && b ? `${a} ${b}` : null;
  }
  return n.split("").map((d) => ONES[Number(d)]).join(" ");
}

/** The five ways a phone line degrades a real address. */
function degradations(raw: string): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];

  const noSuffix = raw.replace(SUFFIXES, "").replace(/\s+/g, " ").trim();
  if (noSuffix !== raw && noSuffix !== "") out.push({ label: "suffix dropped", text: noSuffix });

  const noDir = raw.replace(DIRECTIONS, "").replace(/\s+/g, " ").trim();
  if (noDir !== raw && noDir !== "") out.push({ label: "direction dropped", text: noDir });

  const num = raw.trim().match(/^(\d+)\s+(.*)$/);
  if (num) {
    const words = spokenNumber(num[1]!);
    if (words) out.push({ label: "number words", text: `${words} ${num[2]}` });
  }

  out.push({ label: "mixed case", text: raw.toUpperCase() });
  out.push({ label: "stray whitespace", text: `  ${raw.replace(/ /g, "   ")}  ` });

  return out;
}

// --- case construction -----------------------------------------------------

async function buildCases(): Promise<{ cases: Case[]; corpus: number }> {
  const conn = await openCallConnection();
  try {
    const all = await conn.sql<PropertyRow[]>`
      select id::text as id, street_raw, street_norm, unit
        from property
       where street_norm is not null and street_norm <> '' and street_raw <> ''
       order by id`;

    const cases: Case[] = [];

    // --- phase 1: the 18-unit address ------------------------------------
    const multi = all.filter((p) => p.street_norm === MULTI_UNIT_STREET);
    if (multi.length < 2) {
      throw new Error(`Expected many units at "${MULTI_UNIT_STREET}", found ${multi.length}. The corpus is not the one this suite was measured against.`);
    }
    const multiIds = multi.map((p) => p.id);

    // No unit given. Eighteen customers sit behind this string; resolving to
    // any of them is reading a stranger's record aloud.
    cases.push({
      phase: "1 multi-unit",
      label: `${multi[0]!.street_raw} — no unit given (${multi.length} units)`,
      utterance: multi[0]!.street_raw,
      unit: null,
      expectedId: multi[0]!.id,
      mustNotResolve: true,
    });

    for (const p of multi) {
      cases.push({
        phase: "1 multi-unit",
        label: `${p.street_raw} unit ${p.unit}`,
        utterance: p.street_raw,
        unit: p.unit,
        expectedId: p.id,
        forbiddenIds: multiIds.filter((id) => id !== p.id),
      });
    }

    // --- phase 2: near-identical pairs, both directions -------------------
    for (const pair of NEAR_PAIRS) {
      const side = (num: string): PropertyRow[] =>
        all.filter((p) => p.street_norm.includes(pair.street) && p.street_norm.split(" ")[0] === num);
      const A = side(pair.a);
      const B = side(pair.b);
      if (A.length === 0 || B.length === 0) {
        throw new Error(`Near-pair ${pair.label}: found ${A.length} on ${pair.a} and ${B.length} on ${pair.b}. Both sides must exist for this case to mean anything.`);
      }
      for (const [from, to] of [[A, B], [B, A]] as const) {
        const forbidden = to.map((p) => p.id);
        for (const p of from) {
          cases.push({
            phase: "2 near pairs",
            label: `${pair.label}: "${p.street_raw}"${p.unit ? ` unit ${p.unit}` : ""} must not reach ${to[0]!.street_norm}`,
            utterance: p.street_raw,
            unit: p.unit,
            expectedId: p.id,
            forbiddenIds: forbidden,
          });
        }
      }
    }

    // --- phase 3: spoken degradation --------------------------------------
    // Deterministic sample so two runs are comparable.
    const degradeSet = await conn.sql<PropertyRow[]>`
      select id::text as id, street_raw, street_norm, unit
        from property
       where street_norm is not null and street_norm <> '' and street_raw <> ''
         and street_norm ~ '^[0-9]'
       order by md5(id::text)
       limit ${DEGRADE_SIZE}`;

    for (const p of degradeSet) {
      for (const d of degradations(p.street_raw)) {
        cases.push({
          phase: "3 spoken degradation",
          label: `${d.label}: "${d.text.trim()}"${p.unit ? ` unit ${p.unit}` : ""}`,
          utterance: d.text,
          unit: p.unit,
          expectedId: p.id,
        });
      }
    }

    // --- phase 4: corpus sweep --------------------------------------------
    const sweep = await conn.sql<PropertyRow[]>`
      select id::text as id, street_raw, street_norm, unit
        from property
       where street_norm is not null and street_norm <> '' and street_raw <> ''
       order by md5(id::text)
       limit ${SWEEP_SIZE}`;

    for (const p of sweep) {
      cases.push({
        phase: "4 corpus sweep",
        label: `${p.street_raw}${p.unit ? ` unit ${p.unit}` : ""}`,
        utterance: p.street_raw,
        unit: p.unit,
        expectedId: p.id,
      });
    }

    return { cases, corpus: all.length };
  } finally {
    await conn.release();
  }
}

// --- run -------------------------------------------------------------------

async function runCase(c: Case): Promise<Outcome> {
  const r = await withRetry(() =>
    resolveProperty({ rawStreet: c.utterance, unit: c.unit }),
  );
  const gotId = r.decision === "resolved" ? (r.candidates[0]?.id ?? null) : null;
  const wrong = r.decision === "resolved" && gotId !== c.expectedId;
  return {
    ...c,
    decision: r.decision,
    gotId,
    confidence: r.confidence,
    totalCandidates: r.totalCandidates,
    reason: r.reason,
    wrong,
    overconfident: c.mustNotResolve === true && r.decision === "resolved",
    crossResolved: gotId !== null && (c.forbiddenIds ?? []).includes(gotId),
    correct: r.decision === "resolved" && gotId === c.expectedId,
  };
}

// --- output ----------------------------------------------------------------

const ICON = { pass: "  ok  ", fail: " FAIL " } as const;

function main(): Promise<number> {
  return (async () => {
    const started = Date.now();
    console.log("\n  Front Desk — cruel cases (resolver, no model)\n");

    const { cases, corpus } = await buildCases();
    console.log(`  ${cases.length} cases built from ${corpus.toLocaleString()} properties. Running at concurrency ${CONCURRENCY}.\n`);

    const outcomes = await pool(cases, CONCURRENCY, runCase);

    const phases = [...new Set(cases.map((c) => c.phase))];
    const rows: { phase: string; n: number; wrong: number; resolved: number; correct: number; over: number }[] = [];

    for (const phase of phases) {
      const inPhase = outcomes.filter((o) => o.phase === phase);
      rows.push({
        phase,
        n: inPhase.length,
        wrong: inPhase.filter((o) => o.wrong).length,
        resolved: inPhase.filter((o) => o.decision === "resolved").length,
        correct: inPhase.filter((o) => o.correct).length,
        over: inPhase.filter((o) => o.overconfident).length,
      });
    }

    const width = Math.max(...rows.map((r) => r.phase.length)) + 2;
    console.log("  Phases");
    for (const r of rows) {
      const bad = r.wrong > 0 || r.over > 0;
      console.log(
        `   [${bad ? ICON.fail : ICON.pass}] ${r.phase.padEnd(width)} ` +
          `${String(r.n).padStart(4)} cases   ${String(r.wrong).padStart(3)} wrong   ` +
          `${String(r.resolved).padStart(4)} resolved   ${String(r.correct).padStart(4)} correct` +
          (r.over > 0 ? `   ${r.over} resolved when it must not` : ""),
      );
    }
    console.log("");

    const total = outcomes.length;
    const wrong = outcomes.filter((o) => o.wrong);
    const over = outcomes.filter((o) => o.overconfident);
    const resolved = outcomes.filter((o) => o.decision === "resolved").length;
    const correct = outcomes.filter((o) => o.correct).length;
    const rate = total === 0 ? 0 : wrong.length / total;
    const rateOfResolved = resolved === 0 ? 0 : wrong.length / resolved;

    console.log("  Measured");
    console.log(`   [${wrong.length === 0 ? ICON.pass : ICON.fail}] wrong-record rate          ${(rate * 100).toFixed(4)}%  (${wrong.length} of ${total} cases)`);
    console.log(`   [${wrong.length === 0 ? ICON.pass : ICON.fail}] wrong per resolution       ${(rateOfResolved * 100).toFixed(4)}%  (${wrong.length} of ${resolved} resolutions)`);
    console.log(`   [${ICON.pass}] recall (resolved to self)  ${((correct / total) * 100).toFixed(1)}%  (${correct} of ${total})`);
    const crossed = outcomes.filter((o) => o.crossResolved).length;
    console.log(`   [${over.length === 0 ? ICON.pass : ICON.fail}] resolved when forbidden    ${over.length}`);
    console.log(`   [${crossed === 0 ? ICON.pass : ICON.fail}] cross-resolved onto a twin  ${crossed}`);
    console.log(`   [${ICON.pass}] elapsed                    ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log("");

    for (const o of [...wrong, ...over.filter((x) => !x.wrong)]) {
      console.log(`   · ${o.phase} — ${o.label}`);
      console.log(`     said "${o.utterance.trim()}"${o.unit ? ` unit ${o.unit}` : ""} -> ${o.decision} id=${o.gotId ?? "-"} (expected ${o.expectedId}) conf ${o.confidence}`);
      console.log(`     resolver said: ${o.reason}`);
    }
    if (wrong.length || over.length) console.log("");

    const summary = {
      suite: "cruel",
      generatedAt: new Date().toISOString(),
      gate: "wrong_record_rate === 0",
      passed: wrong.length === 0 && over.length === 0,
      // Present and zero on purpose: the report reads one field across all four
      // suites, and "this gate costs nothing to run" is worth stating rather
      // than leaving as a missing key.
      spendUsd: 0,
      models: null,
      totals: {
        cases: total,
        wrong: wrong.length,
        resolvedWhenForbidden: over.length,
        resolutions: resolved,
        resolvedToSelf: correct,
      },
      metrics: {
        wrongRecordRate: rate,
        crossResolved: outcomes.filter((o) => o.crossResolved).length,
        wrongPerResolution: rateOfResolved,
        recall: total === 0 ? 0 : correct / total,
        elapsedMs: Date.now() - started,
      },
      phases: rows,
      failures: [...wrong, ...over].map((o) => ({
        phase: o.phase,
        label: o.label,
        utterance: o.utterance,
        unit: o.unit,
        expectedId: o.expectedId,
        gotId: o.gotId,
        decision: o.decision,
        confidence: o.confidence,
        reason: o.reason,
      })),
    };
    const path = join(ROOT, "reports", "cruel.json");
    writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`  Wrote ${path}\n`);

    if (!summary.passed) {
      console.log("  GATE FAILED — the milestone gate is a wrong-record rate of zero.\n");
      return 1;
    }
    console.log("  Gate held: zero wrong records.\n");
    return 0;
  })();
}

const code = await main().catch((err: unknown) => {
  console.error("\n  cruel suite crashed:", err);
  return 1;
});
await closeDb();
process.exit(code);
