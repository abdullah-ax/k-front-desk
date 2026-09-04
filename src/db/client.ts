/**
 * Database client.
 *
 * Every connection sets `app.tenant_id` before it is used, because every table
 * runs FORCE ROW LEVEL SECURITY — including for the owner role. A connection
 * that forgets to set it sees zero rows rather than everyone's rows, which is
 * the failure mode we want.
 */
import postgres from "postgres";
import { requireEnv, TENANT_ID } from "../config.js";

export type Sql = ReturnType<typeof postgres>;

let client: Sql | undefined;
let poolClient: Sql | undefined;

/**
 * TWO POOLS, because two things want a connection for different lengths of time.
 *
 * A live call reserves one connection for the whole call, so its scoping is set
 * once with `set_config(..., false)` and every tool call in that conversation
 * shares it. That needs SESSION mode, and Supabase's session pooler allows
 * FIFTEEN clients in total.
 *
 * Everything else — every board read, every poll, every screen — is one short
 * transaction: BEGIN, `set local`, query, COMMIT. That works perfectly well in
 * TRANSACTION mode, where the same pooler allows hundreds.
 *
 * Sharing one session-mode pool between them was the bug. A handful of live
 * calls plus two browser tabs polling every 2.5 seconds exhausted all fifteen
 * slots, and the platform answered "max clients reached" on every read — which
 * reaches a dispatcher as a screen that will not load, and reached a caller as
 * "there's been a system error, someone will call you back".
 *
 * Transaction mode cannot use prepared statements, hence `prepare: false`.
 */
function poolUrl(): string {
  const url = requireEnv("DATABASE_URL", "A4");
  return url.replace(/:5432\//, ":6543/");
}

/** The short-transaction pool. Everything that is not a live call. */
export function pool(): Sql {
  if (poolClient) return poolClient;
  poolClient = postgres(poolUrl(), {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    connection: { application_name: "front-desk" },
    onnotice: () => {},
    transform: { undefined: null },
  });
  return poolClient;
}

export function db(): Sql {
  if (client) return client;

  client = postgres(requireEnv("DATABASE_URL", "A4"), {
    // Session mode, and now ONLY for live calls — see pool() above. Three per
    // instance against fifteen total leaves room for several instances to each
    // hold a couple of calls, which is what this pool now exists for.
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    // Runs on every new physical connection, including ones the pool opens
    // later. Without this, RLS returns nothing.
    connection: { application_name: "front-desk" },
    onnotice: () => {},
    transform: { undefined: null },
  });

  return client;
}

/**
 * Sets the tenant on the current session WITHOUT dropping privileges.
 *
 * Admin and migration use only. The connecting role holds BYPASSRLS, so this
 * leaves row-level security inert — every tenant's rows are visible. Use
 * `withTenant` for anything that reads or writes business data.
 */
export async function setTenantUnsafe(sql: Sql, tenantId = TENANT_ID): Promise<void> {
  await sql`select set_config('app.tenant_id', ${tenantId}, false)`;
}

/**
 * Runs `fn` inside a transaction as the unprivileged app role, with the tenant
 * set. This is the ONLY safe way to touch tenant data.
 *
 * Both statements are required and neither is optional:
 *
 *   SET LOCAL ROLE  — Supabase's `postgres` role (the one in DATABASE_URL)
 *                     holds BYPASSRLS, which skips row-level security entirely.
 *                     FORCE ROW LEVEL SECURITY does NOT override it. Without
 *                     dropping to `front_desk_app` (NOBYPASSRLS), every policy
 *                     on every table is decorative and the catalog still
 *                     reports them as enabled — the checks pass and the data
 *                     leaks anyway.
 *   set_config      — supplies the tenant the policies compare against.
 *
 * Both are transaction-local, so they pair exactly and cannot leak to another
 * caller sharing the pool.
 */
/**
 * Connection faults that are a machine condition, not an answer.
 *
 * These kept surfacing as suite failures that passed on the next run: a pooler
 * capped at 15 session clients, and local ephemeral-port exhaustion once a
 * sweep opens a transaction per lookup. Each runner grew its own retry; putting
 * it here means every caller gets it and none has to remember.
 */
const TRANSIENT = new Set([
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EADDRNOTAVAIL",
  "EADDRINUSE",
  "EMAXCONNSESSION",
  "53300", // too_many_connections
  "57P01", // admin_shutdown
]);

function isTransient(err: unknown): boolean {
  const e = err as { code?: string; errno?: string; message?: string };
  return (
    TRANSIENT.has(String(e?.code ?? "")) ||
    TRANSIENT.has(String(e?.errno ?? "")) ||
    /ECONNRESET|ETIMEDOUT|EADDRNOTAVAIL|CONNECT_TIMEOUT|too many clients/i.test(e?.message ?? "")
  );
}

export async function withTenant<T>(
  fn: (sql: Sql) => Promise<T>,
  tenantId = TENANT_ID,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await withTenantOnce(fn, tenantId);
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === 3) throw err;
      // Jittered backoff: a pool under pressure recovers faster if the retries
      // are not synchronised.
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt + Math.random() * 200));
    }
  }
  throw lastError;
}

async function withTenantOnce<T>(
  fn: (sql: Sql) => Promise<T>,
  tenantId: string,
): Promise<T> {
  // The short-transaction pool, not the session one. See pool() above.
  const sql = pool();
  return sql.begin(async (tx) => {
    // One statement, not two. Each round trip to a hosted database costs ~140ms
    // and a phone call has ~2s for the entire turn, so the transaction preamble
    // is not a place to spend two of them. `set_config('role', …)` is exactly
    // equivalent to SET LOCAL ROLE when the third argument is true.
    await tx`
      select set_config('role', 'front_desk_app', true),
             set_config('app.tenant_id', ${tenantId}, true)
    `;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}

// --- the hot path ----------------------------------------------------------

/**
 * A connection scoped once and reused for a whole phone call.
 *
 * The problem this solves: `withTenant` costs four round trips — BEGIN, the
 * setup statement, the query, COMMIT — and at ~140ms each to a hosted database
 * that is ~560ms before a single row is read. A voice turn has roughly two
 * seconds in total, so paying that on every mid-call lookup is not affordable.
 *
 * Rejected alternative: passing `role` and `app.tenant_id` as connection
 * startup parameters. Supabase's pooler SILENTLY IGNORES them — `current_user`
 * comes back as `postgres` and the tenant setting is empty, so queries appear
 * to work while actually running unscoped with BYPASSRLS. Measured, not
 * assumed. Any future attempt at that shortcut must re-verify, which is what
 * the assertion below exists for.
 *
 * What works: reserve one exclusive connection, configure it at session level
 * once, then every subsequent query on it is a single round trip. A call holds
 * a connection for its duration, which also mirrors the domain nicely.
 *
 * ALWAYS release it — `try { … } finally { await handle.release() }`.
 */
export interface CallConnection {
  sql: Sql;
  release: () => Promise<void>;
}

export async function openCallConnection(tenantId = TENANT_ID): Promise<CallConnection> {
  const reserved = await db().reserve();

  // Session-level, not transaction-local: this connection is ours until it is
  // released, so the scoping outlives each individual query.
  await reserved`select set_config('role', 'front_desk_app', false),
                        set_config('app.tenant_id', ${tenantId}, false)`;

  // Prove the scoping actually took. The failure mode we are guarding against
  // is silent: an unscoped connection returns rows happily, just the wrong
  // tenant's. Never hand back a connection that only looks safe.
  const [check] = await reserved`
    select current_user as role, current_setting('app.tenant_id', true) as tenant
  `;
  const role = check?.["role"] as string | undefined;
  const tenant = check?.["tenant"] as string | undefined;
  if (role !== "front_desk_app" || tenant !== tenantId) {
    await reserved.release();
    throw new Error(
      `Call connection failed to scope: running as "${role}" with tenant "${tenant ?? ""}", ` +
        `expected "front_desk_app" / "${tenantId}". Refusing to serve reads that would bypass RLS.`,
    );
  }

  return {
    sql: reserved as unknown as Sql,
    release: async () => {
      await reserved.release();
    },
  };
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 }).catch(() => {});
    client = undefined;
  }
  // Both pools, or a script that only ever read would leave the transaction
  // pool open and hang on exit.
  if (poolClient) {
    await poolClient.end({ timeout: 5 }).catch(() => {});
    poolClient = undefined;
  }
}
