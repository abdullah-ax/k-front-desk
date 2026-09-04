/**
 * Count gate for the raw landing — Part B task 3 validation
 * (.claude/plans/front-desk.plan.md).
 *
 * Asks the database what it holds and compares it to the numbers measured on
 * this exact export. The row counts prove every line arrived; the jsonb array
 * sums prove every line arrived *whole*, which a row count cannot show — a
 * truncated payload still counts as one row.
 *
 * These numbers are exact, not approximate. A mismatch means the load is wrong
 * or the export changed; the fix is upstream, never here.
 *
 * Run: pnpm test:counts   (tsx, not vitest — this talks to the live database)
 *
 * Every query runs through withTenant(), so it reads what the application role
 * can see. Run outside it, the connecting role's BYPASSRLS would make this pass
 * on rows the app can never read (src/db/client.ts).
 */
import { EXPECTED_COUNTS, SOURCE_FILES } from "../src/config.js";
import { closeDb, withTenant, type Sql } from "../src/db/client.js";

const ICON = { pass: "  ok  ", fail: " FAIL " } as const;
type Status = keyof typeof ICON;

/**
 * Embedded arrays, one row per assertion: the jsonb path, the file whose rows
 * carry it, and the total measured across the export.
 *
 * coalesce(..., '[]') mirrors the EDA loader's defensive access
 * (eda/scripts/sched_load_jobs.py:24-28 — `j.get("notes") or []`): a record
 * missing the key must contribute zero, not null the whole sum.
 */
const EMBEDDED = [
  { name: "notes", file: "jobs.jsonl", key: "notes", expected: EXPECTED_COUNTS.notes },
  {
    name: "invoice items",
    file: "invoices.jsonl",
    key: "items",
    expected: EXPECTED_COUNTS.invoice_items,
  },
  { name: "addresses", file: "customers.jsonl", key: "addresses", expected: 1390 },
  {
    name: "assigned employees",
    file: "jobs.jsonl",
    key: "assigned_employees",
    expected: 2551,
  },
] as const;

const EXPECTED_TOTAL = SOURCE_FILES.reduce((a, s) => a + s.rows, 0);

interface Row {
  group: string;
  name: string;
  expected: number | string;
  actual: number | string;
  status: Status;
}

const rows: Row[] = [];

function check(group: string, name: string, expected: number | string, actual: number | string) {
  rows.push({ group, name, expected, actual, status: expected === actual ? "pass" : "fail" });
}

// --- queries ---------------------------------------------------------------

async function main(): Promise<number> {
  // Row counts, per file and in total.
  const perFile = await withTenant(
    async (tx: Sql) => tx<{ file: string; n: number }[]>`
      select file, count(*)::int as n from raw_record group by file
    `,
  );
  const counts = new Map(perFile.map((r) => [r.file, r.n]));

  for (const { file, rows: expected } of SOURCE_FILES) {
    check("Row counts", file, expected, counts.get(file) ?? 0);
  }
  const total = [...counts.values()].reduce((a, n) => a + n, 0);
  check("Row counts", "total", EXPECTED_TOTAL, total);

  // Embedded arrays. Sums the jsonb in place — no re-reading the source files,
  // because the point is to test what landed, not what is on disk.
  for (const e of EMBEDDED) {
    const [row] = await withTenant(
      async (tx: Sql) => tx<{ n: number }[]>`
        select coalesce(sum(jsonb_array_length(coalesce(payload -> ${e.key}, '[]'::jsonb))), 0)::int as n
          from raw_record
         where file = ${e.file}
      `,
    );
    check("Embedded arrays", `${e.name} (${e.file})`, e.expected, row?.n ?? -1);
  }

  // Integrity: a payload that is null, or is not an object, is a line that did
  // not survive the load intact.
  const [shape] = await withTenant(
    async (tx: Sql) => tx<{ bad: number }[]>`
      select count(*)::int as bad
        from raw_record
       where payload is null or jsonb_typeof(payload) <> 'object'
    `,
  );
  check("Integrity", "null or non-object payloads", 0, shape?.bad ?? -1);

  // The unique index should make this impossible; asserted anyway, because a
  // duplicate line is how a count silently doubles.
  const dupes = await withTenant(
    async (tx: Sql) => tx<{ file: string; line_no: number; n: number }[]>`
      select file, line_no, count(*)::int as n
        from raw_record
       group by file, line_no
      having count(*) > 1
       limit 5
    `,
  );
  check("Integrity", "duplicate (file, line_no)", 0, dupes.length);

  // Idempotency has a second failure mode a total count would catch only by
  // luck: line numbers must be a contiguous 1..n per file.
  const gaps = await withTenant(
    async (tx: Sql) => tx<{ file: string; lo: number; hi: number; n: number }[]>`
      select file, min(line_no)::int as lo, max(line_no)::int as hi, count(*)::int as n
        from raw_record
       group by file
      having min(line_no) <> 1 or max(line_no) <> count(*)
    `,
  );
  check(
    "Integrity",
    "line numbers contiguous from 1",
    0,
    gaps.length,
  );

  return render(gaps);
}

// --- output ----------------------------------------------------------------

function render(gaps: { file: string; lo: number; hi: number; n: number }[]): number {
  const groups = [...new Set(rows.map((r) => r.group))];
  const width = Math.max(...rows.map((r) => r.name.length)) + 2;

  console.log("\n  Front Desk — raw landing counts\n");
  for (const g of groups) {
    console.log(`  ${g}`);
    console.log(`   ${" ".repeat(8)} ${"".padEnd(width)} ${"actual".padStart(9)} ${"expected".padStart(10)}`);
    for (const r of rows.filter((x) => x.group === g)) {
      console.log(
        `   [${ICON[r.status]}] ${r.name.padEnd(width)} ` +
          `${String(r.actual).padStart(9)} ${String(r.expected).padStart(10)}`,
      );
    }
    console.log("");
  }

  const failed = rows.filter((r) => r.status === "fail");
  if (failed.length) {
    console.log(`  ${failed.length} check${failed.length === 1 ? "" : "s"} failed:\n`);
    for (const r of failed) {
      console.log(`   · ${r.name} — measured ${r.actual}, expected ${r.expected}`);
    }
    for (const g of gaps) {
      console.log(`   · ${g.file} line numbers run ${g.lo}..${g.hi} across ${g.n} rows`);
    }
    console.log(
      "\n  These counts come from this exact export. Fix the load, not the numbers.\n",
    );
    return 1;
  }

  console.log(
    `  ${rows.length} checks passed — ${EXPECTED_TOTAL.toLocaleString()} raw rows, ` +
      `${EMBEDDED.reduce((a, e) => a + e.expected, 0).toLocaleString()} embedded records.\n`,
  );
  return 0;
}

const code = await main().finally(closeDb);
process.exit(code);
