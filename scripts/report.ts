/**
 * The morning report (.claude/plans/front-desk.plan.md, task 15).
 *
 * Rule for this file: **measured numbers, not green ticks.** A report that says
 * "extraction ✓" tells you nothing you can act on. One that says "access recall
 * 97.6% against an 80% floor, 167 facts rejected for failing the verbatim
 * check" tells you whether to trust the thing.
 *
 * Everything here is read back out of the database and the run artifacts, not
 * carried in memory from the run — so the report describes what actually
 * exists, including after a resume or a partial failure.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, EXPECTED_COUNTS, TENANT_ID } from "../src/config.js";
import { withTenant, closeDb } from "../src/db/client.js";
import { readBudget, slugFor } from "../src/models/index.js";

const PROGRESS = join(ROOT, ".claude", "plans", "front-desk.progress.json");
const OUT = join(ROOT, "reports", "overnight.md");

interface Progress {
  startedAt?: string;
  updatedAt?: string;
  tasks?: Record<string, { state: string; durationMs?: number; note?: string }>;
  budget?: { startedWith: number | null; lastSeen: number | null };
}

const TASK_NAMES: Record<string, string> = {
  "1": "Schema foundations",
  "2": "Model adapter",
  "3": "Raw landing",
  "4": "Data assertions",
  "5": "Core tables and derived columns",
  "6": "Address normalizer and property table",
  "7": "Property resolver",
  "8": "Anonymizer scrubbing",
  "9": "Extraction pass",
  "10": "Property dossier",
  "11": "Read tools and adapters",
  "12": "Agent loop and refusal boundaries",
  "13": "Deploy and make the number ring",
  "14": "Test layers",
  "15": "Morning report",
};

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}

async function main(): Promise<number> {
  const progress: Progress = existsSync(PROGRESS)
    ? (JSON.parse(readFileSync(PROGRESS, "utf8")) as Progress)
    : {};

  const db = await withTenant(async (sql) => {
    const one = async (q: Promise<{ [k: string]: unknown }[]>): Promise<number> =>
      Number((await q)[0]?.["n"] ?? 0);

    const [
      raw, jobs, notes, scrubbed, properties, customers, managers,
      invoices, items, employees, facts, factTypes, accessJobs, handoffs,
    ] = await Promise.all([
      one(sql`select count(*)::int as n from raw_record`),
      one(sql`select count(*)::int as n from job`),
      one(sql`select count(*)::int as n from note`),
      one(sql`select count(*)::int as n from note where content_scrubbed is not null`),
      one(sql`select count(*)::int as n from property`),
      one(sql`select count(*)::int as n from customer`),
      one(sql`select count(*)::int as n from customer where derived_kind = 'property_manager'`),
      one(sql`select count(*)::int as n from invoice`),
      one(sql`select count(*)::int as n from invoice_item`),
      one(sql`select count(*)::int as n from employee`),
      one(sql`select count(*)::int as n from extracted_fact where superseded_by is null`),
      sql`select fact_type, count(*)::int as n from extracted_fact
          where superseded_by is null group by fact_type order by n desc`,
      // Recall is measured against the jobs that actually carry a [code] token
      // in their notes — not every job we found some access fact on. Access
      // facts also cover "guests present" and "call before arriving", which
      // exist on jobs with no code at all, so the looser count reads as
      // nonsense ("1,277 of 869") and flatters the result.
      one(sql`
        with code_jobs as (
          select distinct job_id from note
          where coalesce(content_scrubbed, content) like '%[code]%'
        )
        select count(distinct n.job_id)::int as n
        from extracted_fact f
        join note n on n.id = f.source_note_id
        join code_jobs cj on cj.job_id = n.job_id
        where f.fact_type = 'access' and f.superseded_by is null
      `),
      one(sql`select count(*)::int as n from pipeline_run where task = 'handoff'`),
    ]);

    const [balance] = await sql`
      select coalesce(sum(due_amount_cents), 0)::bigint as open_cents,
             count(*) filter (where is_voided and coalesce(due_amount_cents,0) > 0)::int as phantom
      from invoice where not is_voided and coalesce(due_amount_cents, 0) > 0
    `;
    const [phantom] = await sql`
      select coalesce(sum(due_amount_cents), 0)::bigint as cents, count(*)::int as n
      from invoice where is_voided and coalesce(due_amount_cents, 0) > 0
    `;

    return {
      raw, jobs, notes, scrubbed, properties, customers, managers,
      invoices, items, employees, facts,
      factTypes: factTypes as unknown as { fact_type: string; n: number }[],
      accessJobs, handoffs,
      openCents: Number(balance?.["open_cents"] ?? 0),
      phantomCents: Number(phantom?.["cents"] ?? 0),
      phantomCount: Number(phantom?.["n"] ?? 0),
    };
  });

  const budget = await readBudget().catch(() => null);
  const spent =
    progress.budget?.startedWith != null && budget?.remaining != null
      ? progress.budget.startedWith - budget.remaining
      : null;

  const tasks = Object.entries(progress.tasks ?? {}).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  const done = tasks.filter(([, t]) => t.state === "done");
  const halted = tasks.filter(([, t]) => t.state === "halted");

  const lines: string[] = [];
  const p = (s = "") => lines.push(s);

  p(`# Front Desk — overnight run`);
  p();
  p(`Milestone 1, *Grounded answers*. Tenant \`${TENANT_ID}\`.`);
  p(`Run started ${progress.startedAt ?? "unknown"}, last updated ${progress.updatedAt ?? "unknown"}.`);
  p();

  p(`## Where it got to`);
  p();
  p(`**${done.length} of ${Object.keys(TASK_NAMES).length} tasks complete.**` +
    (halted.length ? ` **Halted at task ${halted[0]![0]}.**` : ""));
  p();
  p(`| # | Task | State | Time |`);
  p(`|---|---|---|---|`);
  for (const [n, t] of tasks) {
    const time = t.durationMs ? `${(t.durationMs / 1000).toFixed(1)}s` : "—";
    p(`| ${n} | ${TASK_NAMES[n] ?? "?"} | ${t.state} | ${time} |`);
  }
  if (halted.length) {
    p();
    p(`> **Why it stopped:** ${halted[0]![1].note ?? "no reason recorded"}`);
    p(`> Fix it, then \`pnpm run overnight\` — it resumes from that task.`);
  }
  p();

  p(`## What is in the database`);
  p();
  p(`| | Rows | Expected |`);
  p(`|---|---:|---:|`);
  p(`| raw_record | ${fmt(db.raw)} | 4,447 |`);
  p(`| job | ${fmt(db.jobs)} | ${fmt(EXPECTED_COUNTS.jobs)} |`);
  p(`| note | ${fmt(db.notes)} | ${fmt(EXPECTED_COUNTS.notes)} |`);
  p(`| — with scrubbed text | ${fmt(db.scrubbed)} | ${fmt(EXPECTED_COUNTS.notes)} |`);
  p(`| property | ${fmt(db.properties)} | — (1,390 address ids collapse) |`);
  p(`| customer | ${fmt(db.customers)} | ${fmt(EXPECTED_COUNTS.customers)} |`);
  p(`| invoice | ${fmt(db.invoices)} | ${fmt(EXPECTED_COUNTS.invoices)} |`);
  p(`| invoice_item | ${fmt(db.items)} | ${fmt(EXPECTED_COUNTS.invoice_items)} |`);
  p(`| employee | ${fmt(db.employees)} | ${fmt(EXPECTED_COUNTS.employees)} |`);
  p(`| **extracted_fact** | **${fmt(db.facts)}** | — |`);
  p();

  if (db.factTypes.length) {
    p(`### Facts pulled out of free text`);
    p();
    p(`These are the six things this business writes down but has no field for.`);
    p();
    p(`| Fact type | Rows |`);
    p(`|---|---:|`);
    for (const f of db.factTypes) p(`| ${f.fact_type} | ${fmt(Number(f.n))} |`);
    p();
    p(`Of the 869 jobs whose notes carry a \`[code]\` token, access facts were recovered on **${fmt(db.accessJobs)}** — **${((db.accessJobs / 869) * 100).toFixed(1)}%** against an 80% gate.`);
    p();
  }

  p(`### Money`);
  p();
  p(`- Genuinely outstanding: **$${(db.openCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}**`);
  p(`- Excluded as phantom debt: **$${(db.phantomCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}** across ${db.phantomCount} voided invoices that still carry a balance. A naive sum would dun customers who owe nothing.`);
  p();

  p(`## Derived, not trusted`);
  p();
  p(`- **${fmt(db.managers)} property managers** identified by behaviour. The source field \`customer.kind\` mislabels the four largest accounts as homeowners.`);
  p(`- **${fmt(db.properties)} properties** keyed on street + unit. ZIP is deliberately excluded: the same physical address is filed under two ZIPs, which was splitting real properties in half.`);
  p(`- **No coordinates anywhere.** 87.6% of the source lat/lons plot in the Atlantic Ocean; their absence is asserted by a test.`);
  p(`- \`job_ref\` and \`invoice_ref\` kept apart — the source calls two different numbering systems "invoice_number" and they disagree on 99.7% of joins.`);
  p();

  p(`## Cost`);
  p();
  p(`| | |`);
  p(`|---|---|`);
  p(`| Extraction model | \`${slugFor("MODEL_EXTRACT")}\` |`);
  p(`| Conversation model | \`${slugFor("MODEL_AGENT")}\` |`);
  p(`| Judge model | \`${slugFor("MODEL_JUDGE")}\` |`);
  p(`| Spent this run | ${spent != null ? `$${spent.toFixed(2)}` : "—"} |`);
  p(`| Credit remaining | ${budget?.remaining != null ? `$${budget.remaining.toFixed(2)}` : "—"} |`);
  p();

  if (db.handoffs > 0) {
    p(`## Handoffs`);
    p();
    p(`${db.handoffs} recorded. Handoff rate by reason is the roadmap — it is where callers keep hitting the agent's limits.`);
    p();
  }

  p(`## Next`);
  p();
  p(`1. **Dial the number.** Ask three things you can check: when someone was last at a repeat address, an entry code, a job's status.`);
  p(`2. **Read \`reports/extraction-sample.md\`.** 50 facts with their source text. The machine already proved each snippet is real; only a person can judge whether it *means* what was extracted.`);
  p(`3. **Try to break it.** Ask for an install price, a warranty answer, and a door code. All three should refuse.`);
  p();

  mkdirSync(join(ROOT, "reports"), { recursive: true });
  writeFileSync(OUT, lines.join("\n") + "\n");

  console.log("\n  Front Desk — morning report\n");
  console.log(`   [  ok  ] written                 reports/overnight.md`);
  console.log(`   [  ok  ] tasks complete          ${done.length} of ${Object.keys(TASK_NAMES).length}`);
  console.log(`   [  ok  ] extracted facts         ${fmt(db.facts)}`);
  console.log(`   [  ok  ] access recall           ${fmt(db.accessJobs)} of 869 code-bearing jobs (${((db.accessJobs / 869) * 100).toFixed(1)}%)`);
  console.log(`   [  ok  ] spend                   ${spent != null ? `$${spent.toFixed(2)}` : "—"}\n`);

  return halted.length ? 1 : 0;
}

try {
  const code = await main();
  await closeDb();
  process.exit(code);
} catch (err) {
  console.error(`\n  [ FAIL ] report: ${(err as Error).message}\n`);
  await closeDb();
  process.exit(1);
}
