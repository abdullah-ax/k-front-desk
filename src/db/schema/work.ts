/**
 * Work — src/db/migrations/0001_core.sql step 4.
 *
 * job, note and the job/employee join. The derived columns on `job` exist
 * because the corresponding source fields are wrong; nothing downstream reads
 * the originals.
 */
import { sql } from "drizzle-orm";
import { pgTable, boolean, integer, jsonb, text, vector } from "drizzle-orm/pg-core";
import { cents, fk, ingestedAt, pk, sourceId, tenantId, ts, tsvector } from "./_shared.js";
import { customer, employee, property } from "./parties.js";
import { rawRecord } from "./raw.js";

export const job = pgTable("job", {
  id: pk(),
  tenantId: tenantId(),
  sourceId: sourceId(),
  rawRecordId: fk("raw_record_id").references(() => rawRecord.id),
  customerId: fk("customer_id").references(() => customer.id),
  propertyId: fk("property_id").references(() => property.id),
  /** Link targets used during load, before the typed rows they point at exist. */
  customerSourceId: text("customer_source_id"),
  addressSourceId: text("address_source_id"),

  description: text("description"),
  workStatus: text("work_status"),
  leadSource: text("lead_source"),

  onMyWayAt: ts("on_my_way_at"),
  startedAt: ts("started_at"),
  completedAt: ts("completed_at"),
  scheduledStart: ts("scheduled_start"),
  scheduledEnd: ts("scheduled_end"),
  timeZone: text("time_zone"),
  arrivalWindowMin: integer("arrival_window_min"),

  tags: jsonb("tags").$type<string[]>().notNull().default([]),

  totalAmountCents: cents("total_amount_cents"),
  outstandingBalanceCents: cents("outstanding_balance_cents"),

  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
  canceledAt: ts("canceled_at"),
  ingestedAt: ingestedAt(),

  // --- derived ---
  /**
   * The number on the JOB record. The source calls this `invoice_number` and it
   * disagrees with the invoice's own number on 99.2% of jobs. Comparing this to
   * `invoiceRef` is always a bug, which is why they are two columns.
   */
  jobRef: text("job_ref"),
  /** The number on the INVOICE for this job. Never compare it to `jobRef`. */
  invoiceRef: text("invoice_ref"),
  isCanceled: boolean("is_canceled").notNull().default(false),
  windowEnd: ts("window_end"),
  serviceCode: text("service_code"),
});

export const note = pgTable("note", {
  id: pk(),
  tenantId: tenantId(),
  sourceId: sourceId(),
  rawRecordId: fk("raw_record_id").references(() => rawRecord.id),
  jobId: fk("job_id").references(() => job.id),
  noteIndex: integer("note_index"),
  /** Verbatim source text. Snippets are checked against it, so never edit in place. */
  content: text("content").notNull(),
  /** Anonymizer artifacts removed. Extractors read this. */
  contentScrubbed: text("content_scrubbed"),
  /** Generated column — computed by Postgres, never written from here. */
  searchTsv: tsvector("search_tsv").generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(content_scrubbed, content, ''))`,
  ),
  /** Populated by a later pass; nullable by design. HNSW-indexed in SQL. */
  embedding: vector("embedding", { dimensions: 1536 }),
  ingestedAt: ingestedAt(),
});

export const jobEmployee = pgTable("job_employee", {
  id: pk(),
  tenantId: tenantId(),
  jobId: fk("job_id")
    .notNull()
    .references(() => job.id),
  employeeId: fk("employee_id")
    .notNull()
    .references(() => employee.id),
  ingestedAt: ingestedAt(),
});

export type Job = typeof job.$inferSelect;
export type NewJob = typeof job.$inferInsert;
export type Note = typeof note.$inferSelect;
export type NewNote = typeof note.$inferInsert;
export type JobEmployee = typeof jobEmployee.$inferSelect;
export type NewJobEmployee = typeof jobEmployee.$inferInsert;
