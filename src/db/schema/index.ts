/**
 * Drizzle mirror of src/db/migrations/*.sql, for typed queries only.
 *
 * The SQL is the source of truth: it is hand-written because drizzle-kit cannot
 * express row level security, and every table in this schema runs FORCE RLS.
 * Do not run `drizzle-kit generate` against these definitions expecting a
 * usable migration — it would emit tables with RLS off.
 *
 * Indexes are intentionally not declared here. They live in the SQL, in one
 * place, where they cannot drift from what the database actually has.
 */
export * from "./_shared.js";
export * from "./raw.js";
export * from "./parties.js";
export * from "./work.js";
export * from "./billing.js";
export * from "./facts.js";
export * from "./ops.js";
export * from "./tickets.js";
