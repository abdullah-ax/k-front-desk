/**
 * Does the book still say what the export said?
 *
 *   pnpm verify:source
 *
 * The client's one rule for this take-home was: do not modify the data. The
 * PRODUCT modifies it — that is the product — so the question is not "has
 * anything changed" but "does anything the export supplied still differ from
 * what the export said". This compares every job's schedule against the raw
 * JSONL row it was loaded from, which is the only copy this system never
 * writes to.
 */
import { db, closeDb, withTenant } from "../src/db/client.js";

const FIX = process.argv.includes("--restore");

async function main(): Promise<number> {
  db();
  let drifted = 0;
  await withTenant(async (sql) => {
    const rows = await sql`
      select j.id, j.job_ref, j.scheduled_start, j.is_canceled, rr.payload
        from job j
        join raw_record rr on rr.id = j.raw_record_id
       where j.source_id not like 'local_job_%'`;
    for (const r of rows as any[]) {
      const p = r.payload as Record<string, unknown>;
      const rawStart = (p["scheduled_start"] ?? p["scheduledStart"] ?? p["start"] ?? null) as string | null;
      if (!rawStart) continue;
      const want = new Date(rawStart).toISOString();
      const have = r.scheduled_start ? new Date(r.scheduled_start).toISOString() : null;
      if (have === want) continue;
      drifted += 1;
      console.log(`  job ${r.job_ref}: book says ${String(have).slice(0, 19)}, export says ${want.slice(0, 19)}`);
      if (FIX) {
        await sql`
          update job set scheduled_start = ${want}::timestamptz,
                         scheduled_end = ${want}::timestamptz + (scheduled_end - scheduled_start),
                         window_end = ${want}::timestamptz + (coalesce(window_end, scheduled_end) - scheduled_start)
           where id = ${r.id}`;
      }
    }
  });
  console.log(drifted === 0
    ? "\n  Every job still sits where the export put it.\n"
    : FIX ? `\n  Put ${drifted} job(s) back.\n` : `\n  ${drifted} job(s) differ. Run with --restore to put them back.\n`);
  return 0;
}
main().then(async (c) => { await closeDb(); process.exit(c); })
      .catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
