/**
 * Tickets — src/db/migrations/0004_tickets.sql.
 *
 * A proposal the board raised for a person to approve, with the literal steps
 * that will run if they do. The four 0003 tables (call, call_event, job_change,
 * queue_item) have no Drizzle mirror and are read with plain SQL in src/read/;
 * this one is mirrored because its jsonb columns have a shape worth naming.
 * `callId` carries no `.references` for that reason: there is no `call` table
 * object here to point at. The SQL has the foreign key.
 */
import { pgTable, jsonb, text } from "drizzle-orm/pg-core";
import { fk, pk, tenantId, ts } from "./_shared.js";
import { job } from "./work.js";

/** One thing that will run on approval, through src/write/jobs.ts. */
export interface TicketStep {
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

/** A fact read from the record, with the table it came from. */
export interface TicketFact {
  label: string;
  value: string;
  source: string;
}

export const ticket = pgTable("ticket", {
  id: pk(),
  tenantId: tenantId(),
  /** 'board' — noticed on the board with no call involved. */
  source: text("source").notNull(),
  /** 'assign_unassigned' | 'late_notice'. With jobId, the dedupe key. */
  kind: text("kind").notNull(),
  callId: fk("call_id"),
  jobId: fk("job_id").references(() => job.id),
  goal: text("goal").notNull(),
  why: text("why"),
  steps: jsonb("steps").$type<TicketStep[]>().notNull().default([]),
  facts: jsonb("facts").$type<TicketFact[]>().notNull().default([]),
  risks: jsonb("risks").$type<string[]>().notNull().default([]),
  gaps: jsonb("gaps").$type<string[]>().notNull().default([]),
  closeCondition: text("close_condition").notNull(),
  dueAt: ts("due_at"),
  /** 'open' | 'approved' | 'dismissed' | 'countered' */
  status: text("status").notNull().default("open"),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  resolvedAt: ts("resolved_at"),
  resolvedBy: text("resolved_by"),
  resolutionNote: text("resolution_note"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Ticket = typeof ticket.$inferSelect;
export type NewTicket = typeof ticket.$inferInsert;
