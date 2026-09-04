/**
 * Operations — src/db/migrations/0001_core.sql step 7, plus the migration
 * ledger created by scripts/migrate.ts.
 *
 * What ran, when, and what it cost. Read by the morning report.
 */
import { pgTable, bigint, jsonb, numeric, text } from "drizzle-orm/pg-core";
import { pk, tenantId, ts } from "./_shared.js";

export const pipelineRun = pgTable("pipeline_run", {
  id: pk(),
  tenantId: tenantId(),
  task: text("task").notNull(),
  /** 'running' | 'ok' | 'failed' | 'halted' */
  status: text("status").notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  rowsIn: bigint("rows_in", { mode: "number" }),
  rowsOut: bigint("rows_out", { mode: "number" }),
  /** Model spend in dollars. numeric, so it sums without drift. */
  costUsd: numeric("cost_usd", { precision: 14, scale: 6 }),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
});

/**
 * Written only by scripts/migrate.ts. Declared here so the RLS check and any
 * tooling can see the whole schema in one place — including the ledger, which
 * carries tenant_id and RLS like everything else so the schema has no
 * privileged corner.
 */
export const migrationLedger = pgTable("_migration", {
  filename: text("filename").notNull(),
  tenantId: tenantId(),
  appliedAt: ts("applied_at").notNull().defaultNow(),
});

export type PipelineRun = typeof pipelineRun.$inferSelect;
export type NewPipelineRun = typeof pipelineRun.$inferInsert;
