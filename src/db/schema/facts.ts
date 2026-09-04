/**
 * Derived knowledge — src/db/migrations/0001_core.sql step 6.
 *
 * One generic landing table for everything pulled out of note text. The shape
 * is deliberately open: a new fact type — access codes, contacts, unit
 * identifiers, warranty assertions, policies, part orders, whatever comes next
 * — is a new `factType` value and a payload shape, not a migration.
 *
 * `snippet` is NOT NULL because a fact that cannot point at the words it came
 * from is not evidence, and the integrity test rejects it.
 */
import { pgTable, jsonb, real, text } from "drizzle-orm/pg-core";
import { fk, pk, tenantId, ts } from "./_shared.js";
import { note } from "./work.js";

export const extractedFact = pgTable("extracted_fact", {
  id: pk(),
  tenantId: tenantId(),
  factType: text("fact_type").notNull(),
  /** 'property' | 'job' | 'customer' | ... — polymorphic, so no FK. */
  subjectType: text("subject_type").notNull(),
  subjectId: fk("subject_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  sourceNoteId: fk("source_note_id").references(() => note.id),
  /** Must appear verbatim in the source note. Checked, not trusted. */
  snippet: text("snippet").notNull(),
  confidence: real("confidence"),
  /** name@version, so a re-extraction is attributable to a specific extractor. */
  extractor: text("extractor").notNull(),
  superseded: fk("superseded_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type ExtractedFact = typeof extractedFact.$inferSelect;
export type NewExtractedFact = typeof extractedFact.$inferInsert;
