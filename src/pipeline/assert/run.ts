/**
 * Assertion runner — task 4's halt gate (.claude/plans/front-desk.plan.md).
 *
 * Runs immediately after the raw JSONL load and before anything derives from
 * it. The contract, borrowed from dbt: an assertion is a query that must return
 * ZERO rows. Rows returned are violations, and they get printed.
 *
 *   pnpm test:assert            run every assertion, in filename order
 *   pnpm test:assert --only=06  run one file
 *
 * Everything runs through withTenant(), which drops to the front_desk_app role
 * before touching a table. The connecting Supabase role holds BYPASSRLS, so a
 * query issued any other way would read across tenants and this suite would be
 * asserting facts about a superset of the data it claims to check.
 *
 * Exit code is non-zero if anything fails, because the overnight run reads it:
 * if the load is wrong, everything downstream is garbage, and continuing is
 * worse than stopping.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTenant, closeDb } from "../../db/client.js";

const DIR = dirname(fileURLToPath(import.meta.url));

/** One .sql file: its metadata, its prose, and the query itself. */
interface Assertion {
  file: string;
  /** Leading digits — what --only matches against. */
  num: string;
  group: string;
  title: string;
  /** The whole header comment, printed on failure so the operator sees WHY. */
  header: string;
  sql: string;
}

type Status = "pass" | "fail";

interface Result {
  assertion: Assertion;
  status: Status;
  rows: Record<string, unknown>[];
  error?: string;
  ms: number;
}

// --- discovery -------------------------------------------------------------

/**
 * Reads the header comment block: every leading `--` line, up to the first
 * blank or code line. `group:` and `title:` are lifted out as metadata; the
 * rest is prose shown when the assertion fails.
 */
function parse(file: string): Assertion {
  const sql = readFileSync(join(DIR, file), "utf8");
  const comment: string[] = [];

  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) {
      comment.push(trimmed.replace(/^--\s?/, ""));
      continue;
    }
    if (trimmed === "" && comment.length === 0) continue;
    break;
  }

  const meta = (key: string): string | undefined =>
    comment.find((l) => l.toLowerCase().startsWith(`${key}:`))?.slice(key.length + 1).trim();

  const isMeta = (l: string) => /^(group|title):/i.test(l);

  return {
    file,
    num: file.match(/^(\d+)/)?.[1] ?? file,
    group: meta("group") ?? "Assertions",
    title: meta("title") ?? file,
    header: comment
      .filter((l) => !isMeta(l))
      .join("\n")
      .trim(),
    sql,
  };
}

function discover(only?: string): Assertion[] {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const assertions = files.map(parse);
  if (!only) return assertions;

  // Match on the numeric prefix, tolerating `--only=6` for `06_...`.
  const want = only.replace(/^0+/, "");
  return assertions.filter((a) => a.num.replace(/^0+/, "") === want || a.file === only);
}

// --- execution -------------------------------------------------------------

async function run(a: Assertion): Promise<Result> {
  const started = Date.now();
  try {
    const rows = await withTenant(
      async (sql) => (await sql.unsafe(a.sql)) as unknown as Record<string, unknown>[],
    );
    return {
      assertion: a,
      status: rows.length === 0 ? "pass" : "fail",
      rows: [...rows],
      ms: Date.now() - started,
    };
  } catch (e) {
    // A query that cannot run is a failure, never a skip. A syntax error or a
    // missing table here would otherwise read as "no violations".
    return {
      assertion: a,
      status: "fail",
      rows: [],
      error: (e as Error).message,
      ms: Date.now() - started,
    };
  }
}

// --- output ----------------------------------------------------------------

const ICON: Record<Status, string> = { pass: "  ok  ", fail: " FAIL " };

function cell(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return `[${v.map(cell).join(", ")}]`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Violation rows as an aligned table, so the odd value is visible at a glance. */
function renderRows(rows: Record<string, unknown>[], limit = 5): string[] {
  const shown = rows.slice(0, limit);
  const cols = Object.keys(shown[0] ?? {});
  const widths = cols.map((c) =>
    Math.min(40, Math.max(c.length, ...shown.map((r) => clip(cell(r[c]), 40).length))),
  );

  const line = (cells: string[]) =>
    ("      " + cells.map((v, i) => v.padEnd(widths[i] ?? 0)).join("  ")).trimEnd();

  const out = [
    line(cols),
    "      " + widths.map((w) => "─".repeat(w)).join("  "),
    ...shown.map((r) => line(cols.map((c) => clip(cell(r[c]), 40)))),
  ];

  if (rows.length > shown.length) {
    out.push(`      … and ${rows.length - shown.length} more violation rows`);
  }
  return out;
}

function render(results: Result[]): number {
  const groups = [...new Set(results.map((r) => r.assertion.group))];
  const label = (r: Result) => `${r.assertion.num} ${r.assertion.title}`;
  const width = Math.max(...results.map((r) => label(r).length)) + 2;

  console.log("\n  Front Desk — data-integrity assertions\n");
  console.log("  An assertion is a query that must return zero rows.\n");

  for (const g of groups) {
    console.log(`  ${g}`);
    for (const r of results.filter((x) => x.assertion.group === g)) {
      const detail = r.error
        ? `query failed: ${clip(r.error, 90)}`
        : `${r.rows.length} row${r.rows.length === 1 ? "" : "s"}`;
      console.log(`   [${ICON[r.status]}] ${label(r).padEnd(width)} ${detail} · ${r.ms}ms`);
    }
    console.log("");
  }

  const failed = results.filter((r) => r.status === "fail");

  if (!failed.length) {
    console.log(
      `  All ${results.length} assertion${results.length === 1 ? "" : "s"} passed — zero violations. ` +
        `The load is trustworthy; task 5 may derive from it.\n`,
    );
    return 0;
  }

  console.log(
    `  ${failed.length} assertion${failed.length === 1 ? "" : "s"} failed. ` +
      `The load is wrong — nothing downstream may run on it.\n`,
  );

  for (const r of failed) {
    console.log(`  ${"─".repeat(74)}`);
    console.log(`  ${r.assertion.num} ${r.assertion.title}   (${r.assertion.file})\n`);
    // The header comment is the argument for why this matters. An operator
    // woken by a red row should not have to go read the file to find it.
    if (r.assertion.header) {
      for (const l of r.assertion.header.split("\n")) console.log(l ? `    ${l}` : "");
      console.log("");
    }
    if (r.error) {
      console.log(`    The query did not run:\n\n      ${r.error}\n`);
      continue;
    }
    console.log(
      `    ${r.rows.length} violation${r.rows.length === 1 ? "" : "s"}` +
        `${r.rows.length > 5 ? ", first 5" : ""}:\n`,
    );
    for (const l of renderRows(r.rows)) console.log(l);
    console.log("");
  }

  return 1;
}

// --- entry -----------------------------------------------------------------

const only = process.argv.slice(2).find((a) => a.startsWith("--only="))?.slice(7);
const assertions = discover(only);

if (assertions.length === 0) {
  console.error(
    only
      ? `\n  No assertion matches --only=${only}. Available: ${discover()
          .map((a) => a.num)
          .join(", ")}\n`
      : `\n  No .sql assertions found in ${DIR}\n`,
  );
  await closeDb();
  process.exit(1);
}

// Sequential on purpose: these are cheap, and a stable ordered table beats
// shaving a few seconds off a gate that only ever runs once per load.
const results: Result[] = [];
for (const a of assertions) results.push(await run(a));

const code = render(results);
await closeDb();
process.exit(code);
