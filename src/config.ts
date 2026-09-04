/**
 * Shared configuration for the Front Desk build (.claude/plans/front-desk.plan.md).
 *
 * Constants are hoisted here rather than read at point of use, mirroring the
 * EDA loader convention (eda/scripts/dq_common.py:6-8, sched_load_jobs.py:1-12).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Source export. Never written to; loaded verbatim into raw_record. */
export const DATA = join(ROOT, "front-desk-assignment", "data");
export const CSV = join(DATA, "csv");

/**
 * Every job in the export carries America/New_York and there are zero timezone
 * anomalies. Applied at the ingest boundary, never at read
 * (mirrors eda/scripts/sched_load_jobs.py:12).
 */
export const TZ = "America/New_York";

/**
 * The export snapshot moment: max(updated_at) across jobs.jsonl. "Today" is
 * fixed here so the agent never claims a future visit already happened, and so
 * tests are deterministic.
 */
export const EXPORT_ANCHOR = "2026-09-02T00:53:59Z";

/**
 * Expected row counts. A mismatch means the load is wrong — halt, don't proceed.
 *
 * Only four of these are files. `notes` and `invoice_items` live inside jobs
 * and invoices; `addresses` inside customers; `assigned_employees` inside jobs.
 * All eight are asserted because a short embedded array is a silent data loss
 * that a file-level row count would never catch.
 */
export const EXPECTED_COUNTS = {
  jobs: 1992,
  notes: 6954,
  invoices: 1700,
  invoice_items: 4390,
  customers: 732,
  employees: 23,
  addresses: 1390,
  assigned_employees: 2551,
} as const;

/** Source files, with the record count each must yield. */
export const SOURCE_FILES = [
  { file: "jobs.jsonl", rows: 1992 },
  { file: "invoices.jsonl", rows: 1700 },
  { file: "customers.jsonl", rows: 732 },
  { file: "employees.jsonl", rows: 23 },
] as const;

// --- environment -----------------------------------------------------------

/** Minimal .env reader — avoids a dependency for six variables. */
function loadEnvFile(): void {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined && value !== "") process.env[key] = value;
  }
}
loadEnvFile();

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v === "" ? undefined : v;
}

/** Reads a required variable, failing loudly with the setup step that supplies it. */
export function requireEnv(name: string, setupStep: string): string {
  const v = env(name);
  if (!v) {
    throw new Error(
      `Missing ${name}. See setup step ${setupStep} in .claude/plans/front-desk.plan.md, ` +
        `or copy .env.example to .env.`,
    );
  }
  return v;
}

export const TENANT_ID = env("TENANT_ID") ?? "gulf-breeze-air";
export const BUDGET_FLOOR_USD = Number(env("BUDGET_FLOOR_USD") ?? "2");

/** Model roles. One variable each, so any role can be repointed without a code change. */
export const MODEL_ROLES = ["MODEL_EXTRACT", "MODEL_AGENT", "MODEL_JUDGE"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];
