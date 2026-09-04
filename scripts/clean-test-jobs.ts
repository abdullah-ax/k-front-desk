/**
 * Removes jobs left behind by the test suites.
 *
 *   pnpm clean:tests           list what would go, change nothing
 *   pnpm clean:tests --delete  actually remove them
 *
 * Why this exists: `tests/write-path.test.ts` books real jobs at a real address
 * and deletes them in afterAll. That works when a run finishes. It does not
 * when a run is interrupted — and it never covered the "Orphan" job, because
 * `bookJob` used to insert the row and only THEN throw the traceability error
 * the test was asserting. Twenty-nine test jobs had piled up at 8504 E Old
 * Mangrove Rd, one of the addresses the demo actually uses, and today's board
 * went from 8 jobs to 17.
 *
 * It matches on the exact descriptions the suites write, never on a pattern
 * that could catch a real job, and it prints every row before touching
 * anything.
 */
import { db, closeDb, withTenant } from "../src/db/client.js";
import { refreshPropertyRollup } from "../src/write/jobs.js";

/** The literal descriptions the test suites book with. Nothing fuzzy. */
const TEST_DESCRIPTIONS = [
  "Orphan", "Note test", "Assign test", "Attribution test", "Late test",
  "Undo test", "Append test", "Double undo", "Rollup test", "Started job",
  "Ticket-caused booking", "PM visit", "Untouched, move allowed",
  "Under way, move refused", "Under way, reassign refused",
  "Finished, move refused", "Finished, cancel refused",
  "QA SWEEP DELETE ME", "Guard test", "Round trip check",
  // The cancel-path tests. These end up `user canceled` / `pro canceled`, so
  // they survived the first sweep and sat on the board as three canceled jobs.
  "Cancel guard", "Undo a booking", "Double cancel",
  "Under way, cancel allowed", "Rollup cancel", "Cancel test", "Move test",
  "Book test", "Undo booking",
];

const DELETE = process.argv.includes("--delete");

async function main(): Promise<number> {
  db();
  const rows = await withTenant(async (sql) => await sql`
    select j.id, j.job_ref, j.description, j.scheduled_start, j.property_id, p.street_raw
    from job j join property p on p.id = j.property_id
    where j.description = any(${TEST_DESCRIPTIONS as unknown as string[]})
    order by j.id
  `);

  const list = rows as unknown as {
    id: number; job_ref: string; description: string;
    scheduled_start: Date | null; property_id: number; street_raw: string;
  }[];

  if (list.length === 0) {
    console.log("\n  Nothing to clean. The book has no test jobs in it.\n");
    return 0;
  }

  console.log(`\n  ${list.length} test job(s) in the book\n`);
  for (const r of list) {
    const when = r.scheduled_start ? new Date(r.scheduled_start).toISOString().slice(0, 16) : "no date";
    console.log(`   ${String(r.job_ref).padEnd(6)} ${when}  ${r.description.padEnd(28)} ${r.street_raw}`);
  }

  if (!DELETE) {
    console.log("\n  Nothing was changed. Run with --delete to remove them.\n");
    return 0;
  }

  const properties = new Set(list.map((r) => r.property_id));
  await withTenant(async (sql) => {
    for (const r of list) {
      // Same order the test's own teardown uses: children first, then the job.
      // Tickets too. The agent files a proposal against a job it noticed on the
      // board ("Put Felix Fitzgerald on job 5535"), so a test job acquires
      // tickets it never asked for, and ticket.job_id is a foreign key — the
      // first attempt at this failed on exactly that.
      await sql`delete from ticket where job_id = ${r.id}`;
      await sql`delete from call_event where job_id = ${r.id}`;
      await sql`delete from job_change where job_id = ${r.id}`;
      await sql`delete from note where job_id = ${r.id}`;
      await sql`delete from job_employee where job_id = ${r.id}`;
      await sql`delete from job where id = ${r.id}`;
    }
    // A raw delete bypasses the write path, so last_visit_at, next_visit_at and
    // visit_count stay wrong until they are recomputed.
    for (const pid of properties) await refreshPropertyRollup(sql, pid);
  });

  console.log(`\n  Removed ${list.length} job(s) and refreshed ${properties.size} property rollup(s).\n`);
  return 0;
}

main()
  .then(async (c) => { await closeDb(); process.exit(c); })
  .catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
