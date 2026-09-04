/**
 * Preflight — Part A gate (.claude/plans/front-desk.plan.md).
 *
 * Checks every external thing the overnight run depends on and prints one
 * pass/fail table. Nothing here writes anything: it is safe to run repeatedly
 * while you work through setup.
 *
 * Every failure prints the exact setup step that fixes it, so the loop is
 * "run, read the red row, fix that one thing, run again".
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, SOURCE_FILES, MODEL_ROLES, env, ROOT } from "../src/config.js";

type Status = "pass" | "fail" | "warn";
interface Check {
  group: string;
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

const checks: Check[] = [];
const add = (c: Check) => checks.push(c);

// --- A1. Runtime -----------------------------------------------------------

function checkRuntime(): void {
  const major = Number(process.versions.node.split(".")[0]);
  add({
    group: "A1 Runtime",
    name: "Node >= 20",
    status: major >= 20 ? "pass" : "fail",
    detail: `v${process.versions.node}`,
    fix: "Install Node 20 or newer.",
  });

  const envFile = join(ROOT, ".env");
  add({
    group: "A1 Runtime",
    name: ".env present",
    status: existsSync(envFile) ? "pass" : "fail",
    detail: existsSync(envFile) ? ".env" : "not found",
    fix: "cp .env.example .env, then fill it in.",
  });
}

// --- Source data -----------------------------------------------------------

function checkSourceData(): void {
  for (const { file, rows } of SOURCE_FILES) {
    const path = join(DATA, file);
    if (!existsSync(path)) {
      add({
        group: "Source data",
        name: file,
        status: "fail",
        detail: "missing",
        fix: `Expected at ${path}`,
      });
      continue;
    }
    const actual = readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).length;
    add({
      group: "Source data",
      name: file,
      status: actual === rows ? "pass" : "fail",
      detail: `${actual.toLocaleString()} rows (expected ${rows.toLocaleString()})`,
      fix: "The export differs from the one the plan was built against.",
    });
  }
}

// --- A2/A3. OpenRouter -----------------------------------------------------

async function checkOpenRouter(): Promise<void> {
  const key = env("OPENROUTER_API_KEY");
  if (!key) {
    add({
      group: "A2 OpenRouter",
      name: "API key",
      status: "fail",
      detail: "OPENROUTER_API_KEY not set",
      fix: "Setup step A2 — create a key at openrouter.ai WITH a hard spend limit.",
    });
    return;
  }

  // /key reports the limit and usage on the credential itself.
  let remaining: number | null = null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      add({
        group: "A2 OpenRouter",
        name: "API key",
        status: "fail",
        detail: `rejected (HTTP ${res.status})`,
        fix: "Setup step A2 — check the key was copied whole.",
      });
      return;
    }
    interface KeyInfo {
      limit: number | null;
      usage: number | null;
      limit_remaining?: number | null;
    }
    const body = (await res.json()) as { data?: KeyInfo };
    const d: KeyInfo = body.data ?? { limit: null, usage: null };
    add({ group: "A2 OpenRouter", name: "API key", status: "pass", detail: "valid" });

    if (d.limit === null || d.limit === undefined) {
      add({
        group: "A2 OpenRouter",
        name: "Spend limit",
        status: "warn",
        detail: "no limit set on this key",
        fix: "Setup step A2 — set a hard limit before an unattended run. This is the only failure that costs money while you sleep.",
      });
    } else {
      remaining = d.limit_remaining ?? d.limit - (d.usage ?? 0);
      add({
        group: "A2 OpenRouter",
        name: "Spend limit",
        status: "pass",
        detail: `$${d.limit} limit, $${remaining?.toFixed(2)} remaining`,
      });
    }
  } catch (e) {
    add({
      group: "A2 OpenRouter",
      name: "API key",
      status: "fail",
      detail: `unreachable: ${(e as Error).message}`,
      fix: "Check network access to openrouter.ai.",
    });
    return;
  }

  // Model slugs drift. Resolve all three now, so a bad slug fails here at
  // 30 minutes rather than at 3am mid-run.
  let catalogue: Set<string>;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    const body = (await res.json()) as { data: { id: string }[] };
    catalogue = new Set(body.data.map((m) => m.id));
  } catch {
    add({
      group: "A3 Models",
      name: "catalogue",
      status: "fail",
      detail: "could not fetch model list",
    });
    return;
  }

  for (const role of MODEL_ROLES) {
    const slug = env(role);
    if (!slug) {
      add({
        group: "A3 Models",
        name: role,
        status: "fail",
        detail: "not set",
        fix: "Setup step A3 — list models and pick one per role.",
      });
      continue;
    }
    add({
      group: "A3 Models",
      name: role,
      status: catalogue.has(slug) ? "pass" : "fail",
      detail: catalogue.has(slug) ? slug : `${slug} — not in catalogue`,
      fix: "Setup step A3 — the slug is wrong or the model was retired. List models again.",
    });
  }
}

// --- A4. Postgres ----------------------------------------------------------

async function checkPostgres(): Promise<void> {
  const url = env("DATABASE_URL");
  if (!url) {
    add({
      group: "A4 Postgres",
      name: "DATABASE_URL",
      status: "fail",
      detail: "not set",
      fix: "Setup step A4 — Supabase project settings, connection string (session mode).",
    });
    return;
  }

  // postgres ships as CJS with an interop default; import it dynamically so a
  // missing install is a clear message rather than a module-resolution crash.
  let postgres: typeof import("postgres");
  try {
    postgres = (await import("postgres")).default as unknown as typeof import("postgres");
  } catch {
    add({
      group: "A4 Postgres",
      name: "driver",
      status: "fail",
      detail: "postgres package not installed",
      fix: "pnpm install",
    });
    return;
  }

  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    const [row] = await sql<{ version: string }[]>`select version()`;
    add({
      group: "A4 Postgres",
      name: "connection",
      status: "pass",
      detail: row?.version.split(",")[0] ?? "connected",
    });

    const installed = await sql<{ extname: string }[]>`
      select extname from pg_extension
      where extname in ('vector', 'pg_trgm', 'fuzzystrmatch')
    `;
    const have = new Set(installed.map((r: { extname: string }) => r.extname));
    for (const ext of ["vector", "pg_trgm", "fuzzystrmatch"] as const) {
      add({
        group: "A4 Postgres",
        name: `extension ${ext}`,
        status: have.has(ext) ? "pass" : "fail",
        detail: have.has(ext) ? "installed" : "missing",
        fix: `Setup step A4 — run: create extension if not exists ${ext};`,
      });
    }
  } catch (e) {
    add({
      group: "A4 Postgres",
      name: "connection",
      status: "fail",
      detail: (e as Error).message,
      fix: "Setup step A4 — check the connection string and that the project is awake.",
    });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

// --- A5. Phone -------------------------------------------------------------

async function checkVapi(): Promise<void> {
  const key = env("VAPI_API_KEY");
  const numberId = env("VAPI_PHONE_NUMBER_ID");

  if (!key) {
    add({
      group: "A5 Phone",
      name: "VAPI_API_KEY",
      status: "fail",
      detail: "not set",
      fix: "Setup step A5 — vapi.ai, Settings, API Keys.",
    });
    return;
  }

  try {
    const res = await fetch("https://api.vapi.ai/phone-number", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      add({
        group: "A5 Phone",
        name: "VAPI_API_KEY",
        status: "fail",
        detail: `rejected (HTTP ${res.status})`,
        fix: "Setup step A5 — check the key.",
      });
      return;
    }
    add({ group: "A5 Phone", name: "VAPI_API_KEY", status: "pass", detail: "valid" });

    const numbers = (await res.json()) as { id: string; number?: string }[];
    if (!numberId) {
      add({
        group: "A5 Phone",
        name: "VAPI_PHONE_NUMBER_ID",
        status: "fail",
        detail: numbers.length
          ? `not set — you own: ${numbers.map((n) => `${n.number ?? n.id} (${n.id})`).join(", ")}`
          : "not set, and no numbers owned",
        fix: "Setup step A5 — buy a number, then paste its id.",
      });
      return;
    }
    const match = numbers.find((n) => n.id === numberId);
    add({
      group: "A5 Phone",
      name: "VAPI_PHONE_NUMBER_ID",
      status: match ? "pass" : "fail",
      detail: match ? (match.number ?? numberId) : "id not found on this account",
      fix: "Setup step A5 — the id belongs to a different account, or was mistyped.",
    });
  } catch (e) {
    add({
      group: "A5 Phone",
      name: "VAPI_API_KEY",
      status: "fail",
      detail: `unreachable: ${(e as Error).message}`,
    });
  }

  const testNumber = env("TEST_PHONE_NUMBER");
  add({
    group: "A5 Phone",
    name: "TEST_PHONE_NUMBER",
    status: testNumber ? "pass" : "warn",
    detail: testNumber
      ? `${testNumber} — the run will place one real call`
      : "not set — the run will verify the webhook but not dial",
    fix: "Optional. Setup step A5.",
  });
}

// --- A6. Deploy target -----------------------------------------------------

async function checkDeploy(): Promise<void> {
  const url = env("PUBLIC_URL");
  const secret = env("VAPI_WEBHOOK_SECRET");

  add({
    group: "A6 Deploy",
    name: "PUBLIC_URL",
    status: url ? "pass" : "fail",
    detail: url ?? "not set",
    fix: "Setup step A6 — npx vercel link, then copy the production URL. A tunnel from your laptop will die overnight.",
  });

  // A short secret is worse than none, because it looks like protection.
  const longEnough = !!secret && secret.length >= 32;
  add({
    group: "A6 Deploy",
    name: "VAPI_WEBHOOK_SECRET",
    status: longEnough ? "pass" : "fail",
    detail: !secret
      ? "not set"
      : longEnough
        ? `${secret.length} chars`
        : `${secret.length} chars — too short, needs 32+`,
    fix: "Setup step A6 — openssl rand -hex 32. This is what stops a stranger reading door codes for 869 properties.",
  });
}

// --- output ----------------------------------------------------------------

const ICON: Record<Status, string> = { pass: "  ok  ", fail: " FAIL ", warn: " warn " };

function render(): number {
  const groups = [...new Set(checks.map((c) => c.group))];
  const width = Math.max(...checks.map((c) => c.name.length)) + 2;

  console.log("\n  Front Desk — preflight\n");
  for (const g of groups) {
    console.log(`  ${g}`);
    for (const c of checks.filter((x) => x.group === g)) {
      console.log(`   [${ICON[c.status]}] ${c.name.padEnd(width)} ${c.detail}`);
    }
    console.log("");
  }

  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");

  if (failed.length) {
    console.log(`  ${failed.length} check${failed.length === 1 ? "" : "s"} failed. Fix these:\n`);
    for (const c of failed) console.log(`   · ${c.name} — ${c.fix ?? c.detail}`);
    console.log("");
    return 1;
  }

  if (warned.length) {
    console.log("  Warnings (the run will proceed):\n");
    for (const c of warned) console.log(`   · ${c.name} — ${c.fix ?? c.detail}`);
    console.log("");
  }

  console.log("  All green. Start the run:  pnpm run overnight\n");
  return 0;
}

const [, , ...args] = process.argv;
const only = args.find((a) => a.startsWith("--only="))?.slice(7);

checkRuntime();
checkSourceData();
if (!only || only === "openrouter") await checkOpenRouter();
if (!only || only === "postgres") await checkPostgres();
if (!only || only === "vapi") await checkVapi();
if (!only || only === "deploy") await checkDeploy();

process.exit(render());
