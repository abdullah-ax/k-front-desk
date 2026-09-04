/**
 * Parties — src/db/migrations/0001_core.sql step 3.
 *
 * employee, customer and property. `property` is the one that carries real
 * design weight: it is a physical place, not an address record, and it has no
 * coordinates at all (see the comment on the table).
 */
import { pgTable, integer, jsonb, text } from "drizzle-orm/pg-core";
import { fk, ingestedAt, pk, sourceId, tenantId, ts } from "./_shared.js";

export const employee = pgTable("employee", {
  id: pk(),
  tenantId: tenantId(),
  sourceId: sourceId(),
  rawRecordId: fk("raw_record_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role"),
  /** The source's own `jobs` count. A claim by the export, not one we made. */
  jobCount: integer("job_count"),
  ingestedAt: ingestedAt(),
});

export const customer = pgTable("customer", {
  id: pk(),
  tenantId: tenantId(),
  sourceId: sourceId(),
  rawRecordId: fk("raw_record_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  company: text("company"),
  /** Source value, provenance only. Read `derivedKind` instead. */
  kind: text("kind"),
  derivedKind: text("derived_kind"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  ingestedAt: ingestedAt(),
});

/**
 * A physical service location.
 *
 * Identity is `canonicalKey`, not an address id: the source has 263 duplicate
 * address records and 48 addresses spelled two or more ways. Every address id
 * that collapsed into a property stays in `sourceAddressIds` so a raw record is
 * still traceable.
 *
 * There is no latitude, longitude or geography column, and there will not be:
 * 87.6% of the source coordinates plot in the Atlantic Ocean. Their absence is
 * asserted by scripts/check-rls.ts.
 */
export const property = pgTable("property", {
  id: pk(),
  tenantId: tenantId(),
  canonicalKey: text("canonical_key").notNull(),
  sourceAddressIds: text("source_address_ids").array().notNull().default([]),
  streetRaw: text("street_raw").notNull(),
  streetNorm: text("street_norm"),
  unit: text("unit"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  lastVisitAt: ts("last_visit_at"),
  nextVisitAt: ts("next_visit_at"),
  visitCount: integer("visit_count").notNull().default(0),
  ingestedAt: ingestedAt(),
});

export type Employee = typeof employee.$inferSelect;
export type NewEmployee = typeof employee.$inferInsert;
export type Customer = typeof customer.$inferSelect;
export type NewCustomer = typeof customer.$inferInsert;
export type Property = typeof property.$inferSelect;
export type NewProperty = typeof property.$inferInsert;
