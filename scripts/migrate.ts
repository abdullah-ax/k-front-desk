/**
 * Migration runner — applies src/db/migrations/*.sql in filename order.
 *
 * Hand-rolled rather than drizzle-kit, for one reason: drizzle-kit generates
 * DDL from the TypeScript schema and has no concept of row-level security, so a
 * drizzle-kit-owned migration silently ships tables with RLS off. Here the SQL
 * is the source of truth and the Drizzle definitions merely mirror it.
 *
 * Contract:
 *   - each file runs inside its own transaction: it applies whole or not at all
 *   - applied filenames are recorded in public._migration
 *   - re-running applies only files not yet recorded
 *
 * The ledger carries tenant_id and runs under the same RLS rules as every other
 * table, so scripts/check-rls.ts needs no exception list. The consequence: if
 * TENANT_ID changes, the ledger reads empty and the first migration re-runs and
 * fails loudly on `create table` — a visible error, never silent divergence.
 *
 * Steps:
 *   1. Ensure the ledger table exists (and is itself tenant-isolated)
 *   2. Read the migration directory
 *   3. Apply each unapplied file in one transaction
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, TENANT_ID } from "../src/config.js";
import { db, closeDb, type Sql } from "../src/db/client.js";

const MIGRATIONS_DIR = join(ROOT, "src", "db", "migrations");
const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
const PAD = 30;

/**
 * The ledger is created here rather than in 0001 because it has to exist before
 * the first migration can be recorded. It gets the same tenant_id + FORCE RLS
 * treatment as everything else, so the schema has no privileged corner.
 */
const LEDGER_DDL = `
  create table if not exists public._migration (
    filename   text        not null,
    tenant_id  text        not null,
    applied_at timestamptz not null default now(),
    primary key (tenant_id, filename)
  );
  create index if not exists _migration_tenant_id_idx on public._migration (tenant_id);
  alter table public._migration enable row level security;
  alter table public._migration force row level security;
  drop policy if exists _migration_tenant_isolation on public._migration;
  create policy _migration_tenant_isolation on public._migration for all
    using (tenant_id = (select current_setting('app.tenant_id', true)));
`;

// --- 2. Discovery ----------------------------------------------------------

function migrationFiles(): string[] {
  const all = readdirSync(MIGRATIONS_DIR);
  const bad = all.filter((f) => f.endsWith(".sql") && !FILE_PATTERN.test(f));
  if (bad.length) {
    throw new Error(
      `Migration filenames must be NNNN_lower_snake.sql — rejected: ${bad.join(", ")}`,
    );
  }
  return all.filter((f) => FILE_PATTERN.test(f)).sort();
}

// --- 1 + 3. Apply ----------------------------------------------------------

async function main(sql: Sql): Promise<number> {
  await sql.unsafe(LEDGER_DDL).simple();

  const applied = new Set(
    (
      await sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${TENANT_ID}, true)`;
        return tx<{ filename: string }[]>`
          select filename from public._migration where tenant_id = ${TENANT_ID}
        `;
      })
    ).map((r) => (r as { filename: string }).filename),
  );

  const files = migrationFiles();
  const pending = files.filter((f) => !applied.has(f));

  console.log(`\n  Front Desk — migrate  (tenant ${TENANT_ID})\n`);

  if (!pending.length) {
    console.log(
      `   [  ok  ] ${"nothing to apply".padEnd(PAD)} ${files.length} migration(s) already applied`,
    );
    console.log("");
    return 0;
  }

  for (const file of pending) {
    const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const started = Date.now();
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${TENANT_ID}, true)`;
        await tx.unsafe(body).simple();
        await tx`
          insert into public._migration (filename, tenant_id)
          values (${file}, ${TENANT_ID})
        `;
      });
      console.log(`   [  ok  ] ${file.padEnd(PAD)} ${Date.now() - started}ms`);
    } catch (e) {
      console.log(`   [ FAIL ] ${file.padEnd(PAD)} ${(e as Error).message}`);
      console.log("\n  Nothing from this file was applied — the transaction rolled back.\n");
      return 1;
    }
  }

  console.log(`\n  ${pending.length} migration(s) applied. Verify:  pnpm db:check-rls\n`);
  return 0;
}

let code = 1;
try {
  code = await main(db());
} catch (e) {
  console.error(`\n   [ FAIL ] migrate — ${(e as Error).message}\n`);
} finally {
  await closeDb();
}
process.exit(code);
