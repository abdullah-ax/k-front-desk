/**
 * Column vocabulary shared by every table in src/db/schema/.
 *
 * These definitions MIRROR src/db/migrations/*.sql — they do not generate it.
 * The SQL is the source of truth because drizzle-kit cannot express row level
 * security, and RLS is the one thing here that must not be droppable by a
 * regenerate. Indexes are deliberately absent from these files for the same
 * reason: duplicating them in two places is how they drift.
 */
import { bigint, customType, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Postgres `tsvector`. Not a Drizzle built-in, and always a generated column
 * here, so it is read-only in practice.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/** `bigint generated always as identity primary key` — never a random UUID. */
export const pk = () =>
  bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();

/** A surrogate bigint FK column. Named at the call site. */
export const fk = (name: string) => bigint(name, { mode: "number" });

/** Money. Cents in the source, cents here — exact, and no float ever. */
export const cents = (name: string) => bigint(name, { mode: "number" });

/** Every table has one, not null, and an RLS policy that reads it. */
export const tenantId = () => text("tenant_id").notNull();

/** The source's string id (`job_dd4866de...`), unique per tenant. */
export const sourceId = () => text("source_id").notNull();

/** When our pipeline wrote the row — distinct from any source timestamp. */
export const ingestedAt = () =>
  timestamp("ingested_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

/** Timestamps are always `timestamptz`; the source is UTC, TZ is applied at read. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
