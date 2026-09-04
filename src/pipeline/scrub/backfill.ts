/**
 * Populates note.content_scrubbed for all 6,954 notes.
 *
 * The gap this closes: `src/pipeline/scrub/anonymizer.ts` and its 55 tests are
 * only worth anything if something actually runs them over the corpus. Without
 * this step `content_scrubbed` stays null, every reader falls back to the raw
 * `content`, and the agent reads anonymizer damage down the phone:
 *
 *   "Jasmine need to assess damaged area"      -> should be "Will need to"
 *   "Summary of Tidewater Hospitality"          -> should be "Summary of Work"
 *   "Tidewater Hospitality performed:"          -> should be "Work performed:"
 *   "phone number: Ruby Avery"                  -> should be "[phone]"
 *
 * Runs after the derive step (which creates the note rows) and before
 * extraction (which must never see the raw text). Idempotent and re-runnable;
 * bump SCRUB_VERSION to force a rebuild after a rule change.
 */
import { withTenant } from "../../db/client.js";
import { scrubForExtraction } from "./anonymizer.js";

/** Bump to force every note to be re-scrubbed on the next run. */
export const SCRUB_VERSION = 1;

const BATCH = 500;

type Status = "pass" | "fail";
interface Row {
  name: string;
  status: Status;
  detail: string;
}
const rows: Row[] = [];

function render(): number {
  const width = Math.max(...rows.map((r) => r.name.length)) + 2;
  console.log("\n  Front Desk — scrub notes\n");
  for (const r of rows) {
    console.log(`   [${r.status === "pass" ? "  ok  " : " FAIL "}] ${r.name.padEnd(width)} ${r.detail}`);
  }
  const failed = rows.filter((r) => r.status === "fail");
  console.log("");
  if (failed.length) {
    console.log(`  ${failed.length} step(s) failed.\n`);
    return 1;
  }
  return 0;
}

export async function backfillScrubbed(): Promise<number> {
  const started = Date.now();

  const total = await withTenant(async (sql) => {
    const [r] = await sql`select count(*)::int as n from note`;
    return Number(r?.["n"] ?? 0);
  });

  if (total === 0) {
    rows.push({ name: "notes", status: "fail", detail: "no notes — run pnpm pipeline:derive first" });
    return render();
  }

  let processed = 0;
  let changed = 0;
  let flagged = 0;
  const flagCounts = new Map<string, number>();

  for (let offset = 0; offset < total; offset += BATCH) {
    await withTenant(async (sql) => {
      const batch = await sql`
        select id, content from note order by id limit ${BATCH} offset ${offset}
      `;
      if (!batch.length) return;

      const updates = (batch as unknown as { id: number; content: string }[]).map((n) => {
        const { text, flags } = scrubForExtraction(n.content ?? "");
        if (text !== n.content) changed += 1;
        if (flags.length) {
          flagged += 1;
          for (const f of flags) flagCounts.set(f.type, (flagCounts.get(f.type) ?? 0) + 1);
        }
        processed += 1;
        return { id: n.id, content_scrubbed: text };
      });

      // One statement per batch rather than one per note: 6,954 round trips to
      // a hosted database would dominate the runtime completely.
      await sql`
        update note set content_scrubbed = v.content_scrubbed
        from (values ${sql(updates.map((u) => [u.id, u.content_scrubbed]))})
             as v(id, content_scrubbed)
        where note.id = (v.id)::bigint
      `;
    });
  }

  const remaining = await withTenant(async (sql) => {
    const [r] = await sql`select count(*)::int as n from note where content_scrubbed is null`;
    return Number(r?.["n"] ?? 0);
  });

  rows.push({
    name: "notes scrubbed",
    status: processed === total ? "pass" : "fail",
    detail: `${processed.toLocaleString()} of ${total.toLocaleString()}`,
  });
  rows.push({
    name: "text changed",
    status: "pass",
    detail: `${changed.toLocaleString()} note(s) differ from the raw source`,
  });
  rows.push({
    name: "flags raised",
    status: "pass",
    detail:
      `${flagged.toLocaleString()} note(s) — ` +
      ([...flagCounts.entries()].map(([k, v]) => `${k} ${v}`).join(", ") || "none"),
  });
  rows.push({
    name: "content_scrubbed null",
    status: remaining === 0 ? "pass" : "fail",
    detail: `${remaining} remaining (must be 0)`,
  });
  rows.push({
    name: "elapsed",
    status: "pass",
    detail: `${((Date.now() - started) / 1000).toFixed(1)}s`,
  });

  return render();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await backfillScrubbed());
}
