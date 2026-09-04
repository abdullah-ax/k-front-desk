/**
 * Billing — src/db/migrations/0001_core.sql step 5.
 *
 * Money is integer cents in the source and integer cents here: exact, byte for
 * byte the source's number, and no float ever reaches a balance read aloud on
 * a call.
 */
import { pgTable, boolean, integer, text } from "drizzle-orm/pg-core";
import { cents, fk, ingestedAt, pk, sourceId, tenantId, ts } from "./_shared.js";
import { job } from "./work.js";
import { rawRecord } from "./raw.js";

export const invoice = pgTable("invoice", {
  id: pk(),
  tenantId: tenantId(),
  sourceId: sourceId(),
  rawRecordId: fk("raw_record_id").references(() => rawRecord.id),
  jobId: fk("job_id").references(() => job.id),
  /** Link target used during load, before job rows exist. */
  jobSourceId: text("job_source_id"),

  invoiceRef: text("invoice_ref"),
  status: text("status"),
  /**
   * Derived. Balance answers must exclude these: the source status column has
   * both "voided" and "canceled" and neither owes money.
   */
  isVoided: boolean("is_voided").notNull().default(false),

  amountCents: cents("amount_cents"),
  subtotalCents: cents("subtotal_cents"),
  dueAmountCents: cents("due_amount_cents"),
  discountTotalCents: cents("discount_total_cents"),
  paymentTotalCents: cents("payment_total_cents"),

  paidAt: ts("paid_at"),
  sentAt: ts("sent_at"),
  serviceDate: ts("service_date"),
  invoiceDate: ts("invoice_date"),
  ingestedAt: ingestedAt(),
});

export const invoiceItem = pgTable("invoice_item", {
  id: pk(),
  tenantId: tenantId(),
  sourceId: sourceId(),
  invoiceId: fk("invoice_id")
    .notNull()
    .references(() => invoice.id),
  lineNo: integer("line_no"),
  name: text("name"),
  /** Source `type`. Renamed to keep the column name out of reserved-word land. */
  itemType: text("item_type"),
  unitPriceCents: cents("unit_price_cents"),
  qtyInHundredths: integer("qty_in_hundredths"),
  amountCents: cents("amount_cents"),
  ingestedAt: ingestedAt(),
});

export type Invoice = typeof invoice.$inferSelect;
export type NewInvoice = typeof invoice.$inferInsert;
export type InvoiceItem = typeof invoiceItem.$inferSelect;
export type NewInvoiceItem = typeof invoiceItem.$inferInsert;
