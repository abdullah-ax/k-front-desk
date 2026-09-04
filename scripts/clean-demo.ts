/**
 * Clears everything this project's own testing left behind.
 *
 *   pnpm clean:demo           list it, change nothing
 *   pnpm clean:demo --delete  remove it
 *
 * `pnpm clean:tests` removes test JOBS by description. This is the rest of it:
 * the synthetic calls the suites open, the rehearsal calls the scripted demo
 * makes, and the tickets and notes that hang off both. Left alone they fill the
 * ticket board with work nobody has to do — seventeen "call the caller back"
 * rows, eleven of which came from a script.
 *
 * It never touches a real phone call, or anything a real call caused.
 */
import { db, closeDb, withTenant } from "../src/db/client.js";

const DELETE = process.argv.includes("--delete");

async function main(): Promise<number> {
  db();
  await withTenant(async (sql) => {
    const calls = await sql`
      select id, caller_label, channel, turn_count from "call"
       where channel = 'web'
         and (caller_label = 'Test line' or caller_label like 'demo:%'
              or caller_label = 'write-path gate' or caller_label is null)`;
    const list = calls as unknown as { id: number; caller_label: string | null; turn_count: number }[];
    console.log(`\n  ${list.length} rehearsal or test call(s)`);

    const tickets = await sql`
      select t.id, t.kind, t.goal from ticket t
       left join "call" c on c.id = t.call_id
       where t.kind = 'callback'
         and (t.call_id is null
              or (c.channel = 'web' and (c.caller_label = 'Test line' or c.caller_label like 'demo:%')))`;
    console.log(`  ${(tickets as unknown as unknown[]).length} ticket(s) filed by one of them`);

    if (!DELETE) { console.log("\n  Nothing was changed. Run with --delete to remove them.\n"); return; }

    let t = 0, c = 0;
    for (const row of tickets as unknown as { id: number }[]) {
      await sql`delete from ticket where id = ${row.id}`; t += 1;
    }
    for (const row of list) {
      // A change caused by a rehearsal is not real work either, but the job it
      // touched might be. Undo rows and notes go first, then the change, then
      // the call — children before parents, or the foreign keys refuse.
      // The change rows stay. A rehearsal drove the real write path, so the job
      // really did move — deleting the change would leave the job somewhere with
      // no record of how it got there, which is worse than a tidy board. They
      // are flagged as rehearsals and hidden from the ticket board instead; what
      // goes is the CALL, once nothing points at it.
      const [held] = await sql`select count(*)::int as n from job_change where call_id = ${row.id}`;
      if ((held as { n: number }).n > 0) continue;
      await sql`delete from ticket where call_id = ${row.id}`;
      await sql`delete from call_event where call_id = ${row.id}`;
      const gone = await sql`delete from "call" where id = ${row.id} returning id`;
      c += (gone as unknown as unknown[]).length;
    }
    console.log(`\n  removed ${t} ticket(s) and ${c} call(s). Calls that caused a real change were kept — the change is the record of what happened.\n`);
  });
  return 0;
}

main().then(async (x) => { await closeDb(); process.exit(x); })
      .catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
