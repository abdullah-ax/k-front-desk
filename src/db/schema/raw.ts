/**
 * Raw landing — src/db/migrations/0001_core.sql step 2.
 *
 * One row per source JSONL line, untransformed. Everything else in the schema
 * is derived from here, so a derivation bug never means re-reading the files.
 */
import { pgTable, integer, jsonb, text } from "drizzle-orm/pg-core";
import { pk, tenantId, ts } from "./_shared.js";

export const rawRecord = pgTable("raw_record", {
  id: pk(),
  tenantId: tenantId(),
  file: text("file").notNull(),
  lineNo: integer("line_no").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  loadedAt: ts("loaded_at").notNull().defaultNow(),
});

export type RawRecord = typeof rawRecord.$inferSelect;
export type NewRawRecord = typeof rawRecord.$inferInsert;
