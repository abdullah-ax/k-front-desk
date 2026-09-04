/**
 * Overnight sequencer — Part B of .claude/plans/front-desk.plan.md.
 *
 * Runs the milestone's tasks in dependency order, unattended. Three properties
 * matter and everything else is detail:
 *
 *   1. It HALTS on a failed gate rather than continuing. A wrong data load
 *      makes everything downstream garbage, so proceeding is worse than
 *      stopping.
 *   2. It CHECKPOINTS after each task, so a failure at task 9 does not throw
 *      away tasks 1-8. Re-running resumes.
 *   3. It CHECKS THE BUDGET before every model-using task. An unattended loop
 *      is the only failure here that costs real money while nobody is watching.
 *
 * Usage:
 *   pnpm run overnight              resume from the last incomplete task
 *   pnpm run overnight --from=5     force a restart at task 5
 *   pnpm run overnight --only=9     run one task
 *   pnpm run overnight --dry-run    print the plan without executing
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.js";

// --- task table ------------------------------------------------------------

interface Task {
  n: number;
  name: string;
  /** Shell commands, run in order. Any non-zero exit halts the run. */
  steps: string[];
  /** Spends OpenRouter credit — budget is checked before it runs. */
  usesModel?: boolean;
  /** A failure here means everything downstream is untrustworthy. */
  gate?: string;
}

const TASKS: Task[] = [
  {
    n: 1,
    name: "Schema foundations",
    steps: ["pnpm db:migrate", "pnpm db:check-rls"],
    gate: "Every table must carry tenant_id with RLS forced. Without it, company #2 is a rewrite.",
  },
  {
    n: 2,
    name: "Model adapter",
    steps: ["pnpm test:models"],
    usesModel: true,
    gate: "All three model roles must resolve before anything spends money.",
  },
  {
    n: 3,
    name: "Raw landing",
    steps: ["pnpm pipeline:load", "pnpm test:counts"],
    gate: "Row counts must match the export exactly. A short load is a silent data loss.",
  },
  {
    n: 4,
    name: "Data assertions",
    steps: ["pnpm test:assert"],
    gate: "The EDA findings, frozen as zero-row queries. If these fail the load is wrong.",
  },
  { n: 5, name: "Core tables and derived columns", steps: ["pnpm pipeline:derive", "pnpm test:derived"] },
  { n: 6, name: "Address normalizer and property table", steps: ["pnpm test:address"] },
  { n: 7, name: "Property resolver", steps: ["pnpm test:resolve"] },
  {
    n: 8,
    name: "Anonymizer scrubbing",
    // The backfill is the step that matters. Testing the scrubber without ever
    // running it over the corpus leaves content_scrubbed null, every reader
    // falls back to raw text, and the agent reads "Jasmine need to assess"
    // down the phone.
    steps: ["pnpm test:scrub", "pnpm pipeline:scrub"],
    gate: "Runs before extraction by design. Extracting from unscrubbed text bakes false facts into the record.",
  },
  {
    n: 9,
    name: "Extraction pass",
    steps: ["pnpm pipeline:extract", "pnpm test:extract-integrity"],
    usesModel: true,
    gate: "Every snippet must appear verbatim in its source note, and access recall must clear 80%.",
  },
  { n: 10, name: "Property dossier", steps: ["pnpm test:dossier"] },
  { n: 11, name: "Read tools and adapters", steps: ["pnpm test:tools"] },
  {
    n: 11.1,
    name: "Redaction, before the trace exists",
    steps: ["pnpm test:redaction"],
    gate:
      "The call trace is a fourth surface holding entry codes for 869 properties. " +
      "Nothing that writes one may ship until this holds in BOTH directions: no code survives, " +
      "and no house number, job reference or price is destroyed.",
  },
  {
    n: 11.2,
    name: "Write path and undo",
    steps: ["pnpm test:write"],
    gate:
      "Every agent change must carry the call that caused it, and undo must restore the prior " +
      "state and refuse once the technician has started. A change nobody can explain or take back " +
      "is the reason a small office switches the agent off.",
  },
  {
    n: 12,
    name: "Agent loop and refusal boundaries",
    steps: ["BOUNDARY_REPEATS=3 pnpm test:boundaries"],
    usesModel: true,
    gate: "No reply may contain a code, price, distance or discount. Judge verdicts are reported, not gated — they move between identical runs.",
  },
  {
    n: 13,
    name: "Deploy and make the number ring",
    steps: ["pnpm build:app", "pnpm deploy:prod", "pnpm provision:vapi", "pnpm test:phone"],
    gate:
      "The webhook must reject unauthenticated requests; it holds door codes for 869 properties. " +
      "The deployment must also run the model the gates were measured against, because it once did not " +
      "and the symptom was not an error: the agent quietly stopped calling handoff on a refusal.",
  },
  {
    n: 14,
    name: "Test layers",
    // Replay's judged phase is sampled at 40 for the gate. The full 1,878-case
    // deterministic sweep still runs every time — only the judged sample is
    // trimmed, because a gate that takes 35 minutes gets skipped, and a gate
    // that gets skipped is not a gate. Run it deeper on demand:
    //   REPLAY_SAMPLE=150 pnpm test:replay
    steps: [
      "REPLAY_SAMPLE=40 pnpm test:replay",
      "pnpm test:cruel",
      "pnpm test:redteam",
    ],
    usesModel: true,
    gate: "Wrong-record rate must be zero. This is the milestone gate.",
  },
  {
    n: 14.1,
    name: "The call is legible",
    steps: ["pnpm test:observability"],
    usesModel: true,
    gate:
      "One real conversation must come back with all six layers present, every tool call complete, " +
      "nothing leaked, and findable by number and address.",
  },
  {
    n: 14.2,
    name: "A caller who calls back is recognised",
    steps: ["pnpm test:continuity"],
    gate:
      "A second call from the same number sees the first call's summary; a different number never " +
      "does, and a call cannot be its own predecessor. No model call — this is the persistence layer.",
  },
  { n: 15, name: "Morning report", steps: ["pnpm tsx scripts/report.ts"] },
];

// --- checkpoint ------------------------------------------------------------

const PROGRESS = join(ROOT, ".claude", "plans", "front-desk.progress.json");
const LOG = join(ROOT, "logs", "overnight.log");

type TaskState = "pending" | "running" | "done" | "halted";
interface Progress {
  startedAt: string;
  updatedAt: string;
  tasks: Record<string, { state: TaskState; durationMs?: number; note?: string }>;
  budget?: { startedWith: number | null; lastSeen: number | null };
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS)) {
    try {
      return JSON.parse(readFileSync(PROGRESS, "utf8")) as Progress;
    } catch {
      /* corrupt checkpoint — start fresh rather than crash */
    }
  }
  return { startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tasks: {} };
}

function saveProgress(p: Progress): void {
  p.updatedAt = new Date().toISOString();
  mkdirSync(join(ROOT, ".claude", "plans"), { recursive: true });
  writeFileSync(PROGRESS, JSON.stringify(p, null, 2) + "\n");
}

function log(line: string): void {
  const stamped = `${new Date().toISOString()}  ${line}`;
  console.log(line);
  mkdirSync(join(ROOT, "logs"), { recursive: true });
  appendFileSync(LOG, stamped + "\n");
}

// --- execution -------------------------------------------------------------

function run(cmd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    const relay = (buf: Buffer) => {
      const text = buf.toString();
      process.stdout.write(text);
      appendFileSync(LOG, text);
    };
    child.stdout.on("data", relay);
    child.stderr.on("data", relay);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const from = Number(args.find((a) => a.startsWith("--from="))?.slice(7) ?? 0);
  const only = Number(args.find((a) => a.startsWith("--only="))?.slice(7) ?? 0);
  const dryRun = args.includes("--dry-run");

  const progress = loadProgress();

  const selected = TASKS.filter((t) => {
    if (only) return t.n === only;
    if (from) return t.n >= from;
    return progress.tasks[t.n]?.state !== "done";
  });

  log("");
  log("  Front Desk — overnight run");
  log(`  ${selected.length} of ${TASKS.length} tasks to run`);
  log("");

  if (dryRun) {
    for (const t of selected) {
      log(`  ${String(t.n).padStart(2)}. ${t.name}${t.usesModel ? "   [spends credit]" : ""}`);
      for (const s of t.steps) log(`      $ ${s}`);
      if (t.gate) log(`      gate: ${t.gate}`);
    }
    log("");
    return;
  }

  // Read the starting budget once so the report can show what the run cost.
  const { assertBudget } = await import("../src/models/index.js");
  try {
    const b = await assertBudget();
    progress.budget = { startedWith: b.remaining, lastSeen: b.remaining };
    saveProgress(progress);
    log(`  Budget: $${b.remaining?.toFixed(2) ?? "unlimited"} available\n`);
  } catch (e) {
    log(`  HALT before starting: ${(e as Error).message}\n`);
    process.exit(1);
  }

  for (const task of selected) {
    const label = `Task ${task.n} — ${task.name}`;
    log(`  ▸ ${label}`);

    if (task.usesModel) {
      try {
        const b = await assertBudget();
        progress.budget = { ...progress.budget!, lastSeen: b.remaining };
        log(`    budget ok: $${b.remaining?.toFixed(2) ?? "unlimited"} remaining`);
      } catch (e) {
        progress.tasks[task.n] = { state: "halted", note: (e as Error).message };
        saveProgress(progress);
        log(`\n  HALTED at task ${task.n}: ${(e as Error).message}\n`);
        process.exit(1);
      }
    }

    progress.tasks[task.n] = { state: "running" };
    saveProgress(progress);
    const started = Date.now();

    for (const step of task.steps) {
      log(`    $ ${step}`);
      const code = await run(step);
      if (code !== 0) {
        const note = `\`${step}\` exited ${code}`;
        progress.tasks[task.n] = { state: "halted", durationMs: Date.now() - started, note };
        saveProgress(progress);
        log("");
        log(`  HALTED at task ${task.n} — ${note}`);
        if (task.gate) log(`  Why this halts rather than continues: ${task.gate}`);
        log(`  Fix it, then re-run \`pnpm run overnight\` — it resumes from here.`);
        log("");
        process.exit(1);
      }
    }

    const durationMs = Date.now() - started;
    progress.tasks[task.n] = { state: "done", durationMs };
    saveProgress(progress);
    log(`    done in ${(durationMs / 1000).toFixed(1)}s\n`);
  }

  log("  All selected tasks complete.");
  log("  Read reports/overnight.md, then dial the number.\n");
}

await main();
