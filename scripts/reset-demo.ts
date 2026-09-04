/**
 * Put the book back to how a demo should start.
 *
 *   pnpm demo:reset           say what it would do
 *   pnpm demo:reset --delete  do it
 *
 * Testing this project drives the REAL write path on purpose — that is what
 * makes the tests worth anything — so it leaves real rows behind: calls, the
 * changes those calls caused, the tickets the changes raised, and jobs the
 * suites booked. None of it is customer work, and all of it fills the screens a
 * dispatcher is supposed to read.
 *
 * Order matters: tickets, then changes, then call events, then calls, then the
 * test jobs themselves. Children before parents, or the foreign keys refuse —
 * which is the database correctly refusing to orphan a record.
 *
 * Real phone calls are never touched.
 */
import { db, closeDb, withTenant } from "../src/db/client.js";

const DELETE = process.argv.includes("--delete");

async function main(): Promise<number> {
  db();
  await withTenant(async (sql) => {
    const [before] = await sql`
      select scheduled_start from job where job_ref = '5409'`;
    const startedAt = (before as { scheduled_start: Date } | undefined)?.scheduled_start;

    // Web rehearsals, plus the synthetic phone calls the gate script and the
    // webhook probes open. A REAL call has a Vapi id (a UUID) and turns on it;
    // these have neither, and they were filling the Calls screen with rows
    // nobody ever spoke on.
    const calls = await sql`
      select id from "call"
       where (channel = 'web'
              and (caller_label in ('Test line','write-path gate','Josie','resolve probe','diagnostic',
                                   'ui verification','post-revert','MVP guarantee 1 retest',
                                   'Starfish Hospitality','Lighthouse Hospitality')
                   or caller_label like 'demo:%' or caller_label is null))
          -- Nobody ever spoke on it. A gate probe, a health check, a webhook
          -- that opened a record and stopped. Not a call.
          or (turn_count = 0 and not exists (select 1 from job_change ch2 where ch2.call_id = "call".id))
          or (provider_call_id like 'phone-gate%'
              or provider_call_id like 'health\_%' or provider_call_id like 'sim\_%'
              or provider_call_id like 'fire%'     or provider_call_id like 'know%'
              or provider_call_id like 'pop\_%'   or provider_call_id like 'lat\_%')`;
    const ids = (calls as unknown as { id: number }[]).map((c) => c.id);

    const [chg] = await sql`
      select count(*)::int as n from job_change where call_id = any(${ids})`;
    const [tk] = await sql`select count(*)::int as n from ticket where call_id = any(${ids})`;

    console.log(`\n  ${ids.length} test call(s)`);
    console.log(`  ${(chg as { n: number }).n} change(s) they caused`);
    console.log(`  ${(tk as { n: number }).n} ticket(s) those raised`);
    console.log(`  job 5409 currently at ${startedAt ? new Date(startedAt).toISOString() : "unknown"}`);

    if (!DELETE) { console.log("\n  Nothing was changed. Run with --delete to do it.\n"); return; }

    await sql`delete from ticket where call_id = any(${ids})`;
    await sql`update job_change set undone_by = null where call_id = any(${ids})`;
    await sql`delete from job_change where call_id = any(${ids})`;
    await sql`delete from call_event where call_id = any(${ids})`;
    await sql`delete from "call" where id = any(${ids})`;

    const [after] = await sql`select scheduled_start from job where job_ref = '5409'`;
    const endedAt = (after as { scheduled_start: Date } | undefined)?.scheduled_start;
    console.log(`\n  cleared. job 5409 still at ${endedAt ? new Date(endedAt).toISOString() : "unknown"}`);
    console.log(`  (the job never moves — only the record of the testing goes)\n`);
  });
  return 0;
}

main().then(async (c) => { await closeDb(); process.exit(c); })
      .catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
