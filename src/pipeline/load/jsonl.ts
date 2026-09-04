/**
 * Raw landing — loads the source export into `raw_record`.
 *
 * Serves Part B task 3 of .claude/plans/front-desk.plan.md. Every line of the
 * export lands here untransformed, so every later table can be re-derived from
 * inside the database rather than by re-reading the files. Nothing in this
 * module interprets a field: no flattening, no cleaning, no type coercion. The
 * one thing it does is prove each line is a JSON object, because a line that
 * will not parse is a load failure, not a downstream surprise.
 *
 * Idempotent by upsert on (tenant_id, file, line_no), then a sweep that removes
 * any row this run did not touch — so a shrunken or re-cut export leaves the
 * table matching the files rather than matching the union of every run.
 *
 * Run:      pnpm pipeline:load
 * Validate: pnpm test:counts
 *
 * Every statement goes through withTenant(). The connection role holds
 * BYPASSRLS, so a query run outside it would write rows that row-level security
 * never sees (src/db/client.ts, src/db/migrations/0002_app_role.sql).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, SOURCE_FILES, TENANT_ID } from "../../config.js";
import { closeDb, withTenant, type Sql } from "../../db/client.js";

/**
 * Rows per insert statement. Four bound parameters per row, so this is far
 * under the 65,535 parameter ceiling while keeping the whole load to a handful
 * of round trips rather than 4,447 of them.
 */
const BATCH_ROWS = 500;

/** pipeline_run.task for this stage. The morning report groups on it. */
const TASK = "pipeline:load";

/** Columns written, in order. Enumerated so a schema change fails loudly. */
const COLUMNS = ["tenant_id", "file", "line_no", "payload"] as const;

const ICON = { pass: "  ok  ", fail: " FAIL ", warn: " warn " } as const;
type Status = keyof typeof ICON;

interface Line {
  /** 1-based physical line number in the source file, so a row traces back. */
  lineNo: number;
  payload: Record<string, unknown>;
}

interface FileResult {
  file: string;
  expected: number;
  read: number;
  stored: number;
  removed: number;
  status: Status;
  detail: string;
}

interface Check {
  group: string;
  name: string;
  status: Status;
  detail: string;
}

const checks: Check[] = [];
const add = (c: Check) => checks.push(c);

// --- reading ---------------------------------------------------------------

/**
 * Parses one JSONL file. Blank lines are skipped (the export ends with a
 * newline); anything else that is not a JSON object throws, naming the file and
 * line, because a half-loaded landing table is worse than no landing table.
 */
function readJsonl(file: string): Line[] {
  const text = readFileSync(join(DATA, file), "utf8");
  const lines: Line[] = [];
  let lineNo = 0;

  for (const raw of text.split("\n")) {
    lineNo += 1;
    if (!raw.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${file}:${lineNo} is not valid JSON — ${(e as Error).message}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${file}:${lineNo} is not a JSON object (got ${typeof parsed})`);
    }
    lines.push({ lineNo, payload: parsed as Record<string, unknown> });
  }

  return lines;
}

// --- writing ---------------------------------------------------------------

/**
 * Upserts one file's lines, then removes anything under that file the run did
 * not touch.
 *
 * The sweep keys on loaded_at rather than on a line-number range: the upsert
 * stamps every touched row with the transaction's now(), which is later than
 * `since`, so an untouched row is exactly a row the current export no longer
 * has. Whole thing is one transaction, so the file is never half-present.
 */
async function loadFile(file: string, lines: Line[], since: Date): Promise<number> {
  return withTenant(async (tx: Sql) => {
    for (let i = 0; i < lines.length; i += BATCH_ROWS) {
      const batch = lines.slice(i, i + BATCH_ROWS).map((l) => ({
        tenant_id: TENANT_ID,
        file,
        line_no: l.lineNo,
        // sql.json pins the parameter to jsonb rather than leaving the type to
        // inference. The value is the parsed line, unmodified.
        payload: tx.json(l.payload as Parameters<Sql["json"]>[0]),
      }));

      await tx`
        insert into raw_record ${tx(batch, ...COLUMNS)}
        on conflict (tenant_id, file, line_no)
        do update set payload = excluded.payload, loaded_at = now()
      `;
    }

    const removed = await tx`
      delete from raw_record where file = ${file} and loaded_at < ${since}
    `;
    return removed.count;
  });
}

/** Opens the pipeline_run row. Returns its id so the finish can find it. */
async function startRun(): Promise<number> {
  const rows = await withTenant(
    async (tx: Sql) => tx<{ id: string }[]>`
      insert into pipeline_run (tenant_id, task, status, detail)
      values (${TENANT_ID}, ${TASK}, 'running', ${tx.json({ files: SOURCE_FILES.map((s) => s.file) })})
      returning id
    `,
  );
  return Number(rows[0]?.id);
}

async function finishRun(
  id: number,
  status: "ok" | "failed",
  rowsIn: number,
  rowsOut: number,
  detail: Record<string, unknown>,
  error: string | null,
): Promise<void> {
  await withTenant(
    async (tx: Sql) => tx`
      update pipeline_run
         set status = ${status},
             finished_at = now(),
             rows_in = ${rowsIn},
             rows_out = ${rowsOut},
             cost_usd = 0,
             detail = ${tx.json(detail as Parameters<Sql["json"]>[0])},
             error = ${error}
       where id = ${id} and task = ${TASK}
    `,
  );
}

/** Counts what is actually in the table now, per file. Read back, not assumed. */
async function storedCounts(): Promise<Map<string, number>> {
  const rows = await withTenant(
    async (tx: Sql) => tx<{ file: string; n: number }[]>`
      select file, count(*)::int as n from raw_record group by file
    `,
  );
  return new Map(rows.map((r) => [r.file, r.n]));
}

// --- output ----------------------------------------------------------------

function render(elapsedMs: number): number {
  const groups = [...new Set(checks.map((c) => c.group))];
  const width = Math.max(...checks.map((c) => c.name.length)) + 2;

  console.log("\n  Front Desk — raw landing\n");
  for (const g of groups) {
    console.log(`  ${g}`);
    for (const c of checks.filter((x) => x.group === g)) {
      console.log(`   [${ICON[c.status]}] ${c.name.padEnd(width)} ${c.detail}`);
    }
    console.log("");
  }

  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length) {
    console.log(`  ${failed.length} check${failed.length === 1 ? "" : "s"} failed:\n`);
    for (const c of failed) console.log(`   · ${c.name} — ${c.detail}`);
    console.log("\n  The load is wrong. Nothing downstream should read it.\n");
    return 1;
  }

  console.log(`  Loaded in ${(elapsedMs / 1000).toFixed(1)}s. Verify:  pnpm test:counts\n`);
  return 0;
}

// --- main ------------------------------------------------------------------

async function main(): Promise<number> {
  const t0 = Date.now();
  const since = new Date();
  const runId = await startRun();

  const results: FileResult[] = [];
  let rowsIn = 0;

  try {
    for (const { file, rows: expected } of SOURCE_FILES) {
      const lines = readJsonl(file);
      rowsIn += lines.length;
      const removed = await loadFile(file, lines, since);
      results.push({
        file,
        expected,
        read: lines.length,
        stored: 0,
        removed,
        status: "pass",
        detail: "",
      });
    }

    const stored = await storedCounts();
    let rowsOut = 0;

    for (const r of results) {
      r.stored = stored.get(r.file) ?? 0;
      rowsOut += r.stored;
      const ok = r.read === r.expected && r.stored === r.expected;
      r.status = ok ? "pass" : "fail";
      r.detail = ok
        ? `${r.stored.toLocaleString()} rows` +
          (r.removed ? ` (${r.removed} stale removed)` : "")
        : `${r.read.toLocaleString()} read, ${r.stored.toLocaleString()} stored, ` +
          `expected ${r.expected.toLocaleString()}`;
      add({ group: "Source files", name: r.file, status: r.status, detail: r.detail });
    }

    const expectedTotal = SOURCE_FILES.reduce((a, s) => a + s.rows, 0);
    add({
      group: "raw_record",
      name: "total rows",
      status: rowsOut === expectedTotal ? "pass" : "fail",
      detail: `${rowsOut.toLocaleString()} of ${expectedTotal.toLocaleString()} expected`,
    });

    // Anything under a file name we no longer load is a leftover from an older
    // export and would be counted by every downstream query.
    const known = new Set<string>(SOURCE_FILES.map((s) => s.file));
    const strays = [...stored.keys()].filter((f) => !known.has(f));
    add({
      group: "raw_record",
      name: "unknown files",
      status: strays.length ? "fail" : "pass",
      detail: strays.length ? strays.join(", ") : "none",
    });

    const failed = checks.some((c) => c.status === "fail");
    await finishRun(
      runId,
      failed ? "failed" : "ok",
      rowsIn,
      rowsOut,
      {
        files: Object.fromEntries(
          results.map((r) => [r.file, { read: r.read, stored: r.stored, removed: r.removed }]),
        ),
        elapsed_ms: Date.now() - t0,
      },
      failed ? "row counts do not match the expected export" : null,
    );

    add({
      group: "raw_record",
      name: "pipeline_run",
      status: "pass",
      detail: `run #${runId} recorded as ${failed ? "failed" : "ok"}`,
    });

    return render(Date.now() - t0);
  } catch (e) {
    const message = (e as Error).message;
    await finishRun(runId, "failed", rowsIn, 0, { elapsed_ms: Date.now() - t0 }, message).catch(
      () => {},
    );
    add({ group: "Source files", name: "load", status: "fail", detail: message });
    return render(Date.now() - t0);
  }
}

const code = await main().finally(closeDb);
process.exit(code);
