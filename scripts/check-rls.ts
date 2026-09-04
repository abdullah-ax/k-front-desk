/**
 * RLS gate — Part B task 1 validation (.claude/plans/front-desk.plan.md).
 *
 * Asks the catalog, not the migration file, four questions of every table in
 * `public`, and one question of every column:
 *
 *   1. does it have tenant_id?           — nothing to isolate on without it
 *   2. is row level security enabled?
 *   3. is it FORCED?                     — the connection role owns these tables;
 *                                          without FORCE the owner bypasses every
 *                                          policy and the other three pass while
 *                                          isolating nothing
 *   4. does it have at least one policy? — RLS with no policy denies everything,
 *                                          which is safe but is not what we built
 *   5. no coordinate columns anywhere    — 87.6% of the source lat/lons plot in
 *                                          the Atlantic; their absence is the
 *                                          design, so it is asserted, not assumed
 *
 * Then one question the catalog cannot answer: does any of it actually bite?
 * Supabase's `postgres` role holds BYPASSRLS, and RLS is skipped entirely for
 * such a role — FORCE does not override it. So checks 1-4 can all be green
 * while every tenant reads every other tenant's rows. Migration 0002 adds
 * `front_desk_app`, a role without that attribute; the enforcement check below
 * proves isolation holds under it, and warns while the default connection role
 * is still the one doing the reading.
 *
 * Exits 1 on any failure. Read-only: safe to run whenever.
 * Output style mirrors scripts/preflight.ts.
 */
import { db, closeDb, withTenant, type Sql } from "../src/db/client.js";

/** Column names that must not exist in any table. */
const BANNED_COLUMNS = ["latitude", "longitude", "geog", "geom"] as const;
/** Postgres types that must not exist in any column. */
const BANNED_TYPES = ["geography", "geometry"] as const;
/** The role RLS is meant to apply to. Created by migration 0002. */
const APP_ROLE = "front_desk_app";
/** A tenant that owns nothing. If it can see a row, isolation is not working. */
const BOGUS_TENANT = "__check_rls_no_such_tenant__";

const ICON = { pass: "  ok  ", fail: " FAIL ", warn: " warn " } as const;
type Status = keyof typeof ICON;

interface Check {
  group: string;
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

interface TableRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_count: number;
  has_tenant_id: boolean;
  tenant_id_indexed: boolean;
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  udt_name: string;
}

const checks: Check[] = [];
const add = (c: Check) => checks.push(c);

// --- 1. Every table in public ----------------------------------------------

const TABLE_QUERY = `
  select
    c.relname                                    as table_name,
    c.relrowsecurity                             as rls_enabled,
    c.relforcerowsecurity                        as rls_forced,
    (select count(*)::int from pg_policies p
       where p.schemaname = 'public' and p.tablename = c.relname) as policy_count,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'tenant_id'
        and a.attnum > 0 and not a.attisdropped
    )                                            as has_tenant_id,
    exists (
      select 1 from pg_index i
      join pg_attribute a
        on a.attrelid = c.oid and a.attnum = i.indkey[0]
      where i.indrelid = c.oid and a.attname = 'tenant_id'
    )                                            as tenant_id_indexed
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
  order by c.relname
`;

const COLUMN_QUERY = `
  select c.relname as table_name, a.attname as column_name, t.typname as udt_name
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relkind in ('r', 'v', 'm')
    and a.attnum > 0
    and not a.attisdropped
  order by c.relname, a.attnum
`;

async function checkTables(sql: Sql): Promise<string[]> {
  const tables = await sql.unsafe<TableRow[]>(TABLE_QUERY);

  if (!tables.length) {
    add({
      group: "Tables",
      name: "public schema",
      status: "fail",
      detail: "no tables found",
      fix: "Run pnpm db:migrate first.",
    });
    return [];
  }

  for (const t of tables) {
    const problems: string[] = [];
    if (!t.has_tenant_id) problems.push("no tenant_id column");
    if (!t.rls_enabled) problems.push("RLS not enabled");
    if (!t.rls_forced) problems.push("RLS not forced");
    if (t.policy_count === 0) problems.push("no policies");

    if (problems.length) {
      add({
        group: "Tenant isolation",
        name: t.table_name,
        status: "fail",
        detail: problems.join(", "),
        fix:
          `alter table public.${t.table_name} add column tenant_id text not null; ` +
          `alter table public.${t.table_name} enable row level security; ` +
          `alter table public.${t.table_name} force row level security; ` +
          `create policy ${t.table_name}_tenant_isolation on public.${t.table_name} ` +
          `for all using (tenant_id = (select current_setting('app.tenant_id', true)));`,
      });
      continue;
    }

    add({
      group: "Tenant isolation",
      name: t.table_name,
      status: t.tenant_id_indexed ? "pass" : "warn",
      detail: t.tenant_id_indexed
        ? `tenant_id, rls, forced, ${t.policy_count} polic${t.policy_count === 1 ? "y" : "ies"}`
        : "isolated, but tenant_id is not the leading column of any index",
      fix: `create index ${t.table_name}_tenant_id_idx on public.${t.table_name} (tenant_id);`,
    });
  }

  add({
    group: "Summary",
    name: "tables checked",
    status: "pass",
    detail: `${tables.length} table(s) in public`,
  });

  return tables.map((t) => t.table_name);
}

// --- 2. No coordinates anywhere --------------------------------------------

async function checkNoCoordinates(sql: Sql): Promise<void> {
  const columns = await sql.unsafe<ColumnRow[]>(COLUMN_QUERY);

  const offenders = columns.filter(
    (c) =>
      (BANNED_COLUMNS as readonly string[]).includes(c.column_name) ||
      (BANNED_TYPES as readonly string[]).includes(c.udt_name),
  );

  if (offenders.length) {
    for (const o of offenders) {
      add({
        group: "No coordinates",
        name: `${o.table_name}.${o.column_name}`,
        status: "fail",
        detail: `banned (${o.udt_name})`,
        fix:
          `alter table public.${o.table_name} drop column ${o.column_name}; ` +
          "87.6% of the source coordinates plot in the Atlantic Ocean. " +
          "Storing them invites something downstream to trust them.",
      });
    }
    return;
  }

  add({
    group: "No coordinates",
    name: "latitude/longitude/geog/geom",
    status: "pass",
    detail: `absent across ${columns.length} column(s)`,
  });
}

// --- 3. Does any of it actually bite? --------------------------------------

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

async function checkEnforcement(sql: Sql, tables: string[]): Promise<void> {
  const [conn] = await sql<RoleRow[]>`
    select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user
  `;
  const [app] = await sql<RoleRow[]>`
    select rolname, rolsuper, rolbypassrls from pg_roles where rolname = ${APP_ROLE}
  `;

  if (!app) {
    add({
      group: "Enforcement",
      name: APP_ROLE,
      status: "fail",
      detail: "role does not exist",
      fix: "Run pnpm db:migrate — migration 0002 creates it.",
    });
    return;
  }

  add({
    group: "Enforcement",
    name: APP_ROLE,
    status: app.rolbypassrls || app.rolsuper ? "fail" : "pass",
    detail:
      app.rolbypassrls || app.rolsuper
        ? "role can bypass RLS — policies do not apply to it"
        : "exists, no BYPASSRLS",
    fix: `alter role ${APP_ROLE} nobypassrls nosuperuser;`,
  });

  // Behavioural proof, read-only: under the app role with a tenant that owns
  // nothing, no table may yield a row — while at least one table does have rows
  // to hide. An empty database cannot prove this either way, and says so.
  const anyRow = (t: string) => `select exists (select 1 from public.${t}) as hit`;
  const populated: string[] = [];
  for (const t of tables) {
    const [row] = await sql.unsafe<{ hit: boolean }[]>(anyRow(t));
    if (row?.hit) populated.push(t);
  }

  const leaked = await sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${APP_ROLE}`);
    await tx`select set_config('app.tenant_id', ${BOGUS_TENANT}, true)`;
    const bad: string[] = [];
    for (const t of populated) {
      const [row] = await tx.unsafe<{ hit: boolean }[]>(anyRow(t));
      if (row?.hit) bad.push(t);
    }
    return bad;
  });

  add({
    group: "Enforcement",
    name: "foreign tenant sees nothing",
    status: leaked.length ? "fail" : "pass",
    detail: leaked.length
      ? `LEAKED from: ${leaked.join(", ")}`
      : populated.length
        ? `proven against ${populated.length} populated table(s)`
        : "no rows loaded yet — nothing to hide, so nothing proven",
    fix: "A policy is wrong, or the role gained BYPASSRLS. Do not load data until this is green.",
  });

  // The connecting role holding BYPASSRLS is a fact of Supabase we cannot
  // change, so it is not itself a failure. What matters is whether the app
  // actually drops to the unprivileged role before touching tenant data.
  //
  // ASK THE DATABASE, don't grep the source. An earlier version of this check
  // searched client.ts for the literal string "set local role" and started
  // reporting a false failure the moment that was refactored into the
  // equivalent set_config('role', …) — a check that breaks on a rename is
  // testing spelling, not safety.
  const dropsRole = await withTenant(async (tx) => {
    const [row] = await tx`select current_user as role`;
    return row?.["role"] === APP_ROLE;
  }).catch(() => false);

  const privileged = !!conn && (conn.rolbypassrls || conn.rolsuper);

  add({
    group: "Enforcement",
    name: `connection role (${conn?.rolname ?? "?"})`,
    status: !privileged || dropsRole ? "pass" : "fail",
    detail: !privileged
      ? "subject to RLS"
      : dropsRole
        ? `holds BYPASSRLS, but withTenant() verifiably runs as ${APP_ROLE}`
        : "holds BYPASSRLS and nothing drops role — every policy is decoration",
    fix:
      `src/db/client.ts must run \`set local role ${APP_ROLE}\` alongside the ` +
      "transaction-local app.tenant_id in withTenant(). Without it every policy " +
      "in 0001 is decoration and any tenant id reads every tenant's rows.",
  });
}

// --- output ----------------------------------------------------------------

function render(): number {
  const groups = [...new Set(checks.map((c) => c.group))];
  const width = Math.max(...checks.map((c) => c.name.length)) + 2;

  console.log("\n  Front Desk — row level security\n");
  for (const g of groups) {
    console.log(`  ${g}`);
    for (const c of checks.filter((x) => x.group === g)) {
      console.log(`   [${ICON[c.status]}] ${c.name.padEnd(width)} ${c.detail}`);
    }
    console.log("");
  }

  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");

  if (failed.length) {
    console.log(`  ${failed.length} check${failed.length === 1 ? "" : "s"} failed. Fix these:\n`);
    for (const c of failed) console.log(`   · ${c.name} — ${c.fix ?? c.detail}`);
    console.log("");
    return 1;
  }

  if (warned.length) {
    console.log("  Warnings:\n");
    for (const c of warned) console.log(`   · ${c.name} — ${c.fix ?? c.detail}`);
    console.log("");
  }

  console.log("  Every table in public is tenant-isolated, isolation holds, and no\n  coordinates exist.\n");
  return 0;
}

let code = 1;
try {
  const sql = db();
  const tables = await checkTables(sql);
  await checkNoCoordinates(sql);
  if (tables.length) await checkEnforcement(sql, tables);
  code = render();
} catch (e) {
  console.error(`\n   [ FAIL ] check-rls — ${(e as Error).message}\n`);
} finally {
  await closeDb();
}
process.exit(code);
