/**
 * pnpm pipeline:derive — raw_record -> typed core tables with derived columns.
 * (.claude/plans/front-desk.plan.md, Part B task 5.)
 *
 * Runs the numbered SQL files in this directory in order, inside ONE transaction
 * as the unprivileged app role (src/db/client.ts withTenant). One transaction
 * because a half-derived database is worse than an empty one: a caller reading
 * jobs whose properties have not been rolled up yet gets confident wrong answers.
 *
 * Step order is the dependency order, and each file says what it fixes:
 *
 *   01_employee          employees.jsonl
 *   02_customer          customers.jsonl (derived_kind deferred to 10)
 *   03_property          canonical addresses -> one row per physical place
 *   04_job               job_ref / invoice_ref / is_canceled / window_end / service_code
 *   05_note              verbatim note text
 *   06_job_employee      assignments
 *   07_invoice           is_voided — the flag every balance must filter on
 *   08_invoice_item      the paper bill, unedited
 *   09_property_rollup   last_visit_at / next_visit_at / visit_count
 *   10_customer_kind     derived_kind from behaviour
 *
 * ONE derivation is not in SQL: the address canonical key. It comes from
 * src/domain/address.ts, which is built and tested (99 tests), and reimplementing
 * suffix and unit normalization in SQL to keep the pipeline pure would be a
 * second implementation of the system's primary key. It is computed here into a
 * temporary table that 03 and 04 read.
 *
 * Two session settings are set before any step and are part of the contract each
 * SQL file is written against:
 *   TimeZone                    America/New_York (src/config.ts TZ) — 53 jobs sit
 *                               at 00:00Z and read as midnight starts otherwise.
 *   front_desk.export_anchor    src/config.ts EXPORT_ANCHOR — the one fixed
 *                               "now", so "next visit" is deterministic.
 *
 * Prints a preflight-style table (scripts/preflight.ts), records a pipeline_run
 * row, and exits non-zero on failure.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EXPECTED_COUNTS, EXPORT_ANCHOR, SOURCE_FILES, TENANT_ID, TZ } from "../../config.js";
import { closeDb, withTenant, type Sql } from "../../db/client.js";
import { canonicalizeAddress, normalizeStreet, type AddressLike } from "../../domain/address.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Property identity is (street, unit) — ZIP is deliberately EXCLUDED.
 *
 * The export's ZIPs contradict themselves: the same physical address is filed
 * under both 33155 and 33162. Including ZIP split four real properties in two,
 * three of which carry an identical city name on both halves:
 *
 *   78 Cowrie Ln .......... 33155 / 33162 · 6 visits split across 2 records
 *   277 E Kelp Key St ..... 33155 / 33162 · both "Pinecrest"
 *   213 Skimmer Cove Ln ... 33155 / 33162 · both "Cutler Bay"
 *   46 Palmetto Glen Loop . 33155 / 33162 · both "Homestead"
 *
 * A split property answers "when were you last here" with half the history,
 * which is the exact failure this milestone is gated against. ZIP stays as an
 * attribute for service-area queries; it is not part of identity.
 */
const CANONICAL_OPTIONS = { includeZip: false } as const;

type Status = "pass" | "fail" | "warn";
interface Row {
  group: string;
  name: string;
  status: Status;
  detail: string;
}

const rows: Row[] = [];
const add = (r: Row): void => void rows.push(r);

// --- helpers ---------------------------------------------------------------

/** postgres.js returns rows as objects; every measurement here reads one. */
async function scalar<T>(sql: Sql, query: string): Promise<T> {
  const result = await sql.unsafe(query);
  const first = result[0] as Record<string, unknown> | undefined;
  if (first === undefined) throw new Error(`query returned no rows: ${query}`);
  return Object.values(first)[0] as T;
}

const n = (v: unknown): number => Number(v ?? 0);
const pct = (part: number, whole: number): string =>
  whole === 0 ? "n/a" : `${((100 * part) / whole).toFixed(2)}%`;
const money = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// --- staging: the one derivation that needs TypeScript ----------------------

interface StagedAddress {
  address_source_id: string | null;
  canonical_key: string;
  street_raw: string | null;
  street_norm: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ord: number;
}

interface CustomerAddressRow {
  addresses: AddressLike[] | null;
}
interface JobAddressRow {
  job_source_id: string;
  address: (AddressLike & { id?: string | null }) | null;
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * Build stg_address (one row per physical place seen) and stg_job_address (one
 * row per job, so a job with a null address.id — 4 of them — still resolves to
 * its property).
 *
 * Customers are walked before jobs, and both in file order, so "first seen" is
 * deterministic across runs.
 */
async function buildAddressStaging(sql: Sql): Promise<{
  addresses: number;
  withoutId: number;
  jobs: number;
}> {
  await sql.unsafe(`
    create temporary table stg_address (
      address_source_id text,
      canonical_key     text not null,
      street_raw        text,
      street_norm       text,
      unit              text,
      city              text,
      state             text,
      zip               text,
      ord               integer not null
    ) on commit drop`);
  await sql.unsafe(`
    create temporary table stg_job_address (
      job_source_id text primary key,
      canonical_key text not null
    ) on commit drop`);

  const staged = new Map<string, StagedAddress>();
  let ord = 0;

  const stage = (address: (AddressLike & { id?: string | null }) | null): string => {
    const canonical = canonicalizeAddress(address, CANONICAL_OPTIONS);
    const id = text(address?.id);
    // An address with no id is keyed by the place itself, so the 4 id-less job
    // addresses still land on one property row rather than one row each.
    const dedupeKey = id ?? `key:${canonical.key}`;
    if (!staged.has(dedupeKey)) {
      ord += 1;
      staged.set(dedupeKey, {
        address_source_id: id,
        canonical_key: canonical.key,
        street_raw: text(address?.street),
        street_norm: text(normalizeStreet(canonical.street)),
        unit: canonical.unit,
        city: text((address as { city?: unknown } | null)?.city),
        state: text((address as { state?: unknown } | null)?.state),
        zip: text(address?.zip),
        ord,
      });
    }
    return canonical.key;
  };

  const customers = await sql.unsafe<CustomerAddressRow[]>(`
    select payload -> 'addresses' as addresses
    from raw_record where file = 'customers.jsonl' order by line_no`);
  for (const c of customers) for (const a of c.addresses ?? []) stage(a);

  const jobs = await sql.unsafe<JobAddressRow[]>(`
    select payload ->> 'id' as job_source_id, payload -> 'address' as address
    from raw_record where file = 'jobs.jsonl' order by line_no`);
  const jobKeys = jobs.map((j) => ({ job_source_id: j.job_source_id, canonical_key: stage(j.address) }));

  const addressRows = [...staged.values()];
  if (addressRows.length > 0) {
    await sql`insert into stg_address ${sql(
      addressRows,
      "address_source_id",
      "canonical_key",
      "street_raw",
      "street_norm",
      "unit",
      "city",
      "state",
      "zip",
      "ord",
    )}`;
  }
  if (jobKeys.length > 0) {
    await sql`insert into stg_job_address ${sql(jobKeys, "job_source_id", "canonical_key")}`;
  }
  return {
    addresses: addressRows.filter((a) => a.address_source_id !== null).length,
    withoutId: addressRows.filter((a) => a.address_source_id === null).length,
    jobs: jobKeys.length,
  };
}

// --- steps -----------------------------------------------------------------

interface StepResult {
  file: string;
  affected: number;
  detail: string;
}

/** What each numbered file should leave behind, so a silent short-load is loud. */
const STEP_TABLE: Readonly<Record<string, { table: string; expected?: number }>> = {
  "01_employee.sql": { table: "employee", expected: EXPECTED_COUNTS.employees },
  "02_customer.sql": { table: "customer", expected: EXPECTED_COUNTS.customers },
  "03_property.sql": { table: "property" },
  "04_job.sql": { table: "job", expected: EXPECTED_COUNTS.jobs },
  "05_note.sql": { table: "note", expected: EXPECTED_COUNTS.notes },
  "06_job_employee.sql": { table: "job_employee", expected: EXPECTED_COUNTS.assigned_employees },
  "07_invoice.sql": { table: "invoice", expected: EXPECTED_COUNTS.invoices },
  "08_invoice_item.sql": { table: "invoice_item", expected: EXPECTED_COUNTS.invoice_items },
  "09_property_rollup.sql": { table: "property" },
  "10_customer_kind.sql": { table: "customer" },
};

function stepFiles(): string[] {
  return readdirSync(HERE)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
}

async function runSteps(sql: Sql): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const file of stepFiles()) {
    const body = readFileSync(join(HERE, file), "utf8");
    const started = Date.now();
    const result = await sql.unsafe(body);
    const ms = Date.now() - started;
    const spec = STEP_TABLE[file];
    const table = spec?.table;
    const total = table === undefined ? 0 : n(await scalar(sql, `select count(*) from ${table}`));
    const expected = spec?.expected;
    const mismatch = expected !== undefined && total !== expected;
    add({
      group: "Steps",
      name: file,
      status: mismatch ? "fail" : "pass",
      detail:
        `${String(result.count ?? 0).padStart(5)} written · ` +
        `${table} now ${total.toLocaleString()}` +
        (expected === undefined ? "" : ` (expected ${expected.toLocaleString()})`) +
        ` · ${ms}ms`,
    });
    if (mismatch) {
      throw new Error(`${file}: ${table} has ${total} rows, expected ${expected}`);
    }
    results.push({ file, affected: n(result.count), detail: table ?? "" });
  }
  return results;
}

// --- the derived-column measurements ---------------------------------------

/**
 * Every check below is a number, not a tick. Each corresponds to one defect in
 * eda/05-data-quality.md, and the same numbers are asserted in
 * tests/derived.test.ts — this table is what a human reads in the morning.
 */
async function measure(sql: Sql): Promise<Record<string, number | string>> {
  const detail: Record<string, number | string> = {};

  // job_ref vs invoice_ref — two namespaces, never compared.
  const bothRefs = n(
    await scalar(sql, `select count(*) from job where job_ref is not null and invoice_ref is not null`),
  );
  const differ = n(
    await scalar(
      sql,
      `select count(*) from job
       where job_ref is not null and invoice_ref is not null and job_ref <> invoice_ref`,
    ),
  );
  detail.ref_pairs = bothRefs;
  detail.ref_disagreements = differ;
  add({
    group: "Derived",
    name: "job_ref ≠ invoice_ref",
    status: bothRefs > 0 && differ / bothRefs >= 0.99 ? "pass" : "fail",
    detail: `${differ.toLocaleString()} of ${bothRefs.toLocaleString()} jobs with both (${pct(differ, bothRefs)}) — two namespaces, never compared`,
  });

  // is_canceled — neither source field alone is sufficient.
  const canceled = n(await scalar(sql, `select count(*) from job where is_canceled`));
  const byStatus = n(await scalar(sql, `select count(*) from job where work_status ilike '%cancel%'`));
  const proNoTimestamp = n(
    await scalar(
      sql,
      `select count(*) from job where work_status = 'pro canceled' and canceled_at is null and is_canceled`,
    ),
  );
  const timestampOnly = n(
    await scalar(
      sql,
      `select count(*) from job where canceled_at is not null and work_status not ilike '%cancel%'`,
    ),
  );
  detail.canceled_jobs = canceled;
  detail.canceled_by_status = byStatus;
  detail.canceled_pro_without_timestamp = proNoTimestamp;
  detail.canceled_by_timestamp_only = timestampOnly;
  add({
    group: "Derived",
    name: "job.is_canceled",
    status: byStatus === 225 && proNoTimestamp === 67 ? "pass" : "fail",
    detail: `${canceled} canceled = ${byStatus} by work_status (incl. ${proNoTimestamp} 'pro canceled' with no canceled_at) + ${timestampOnly} by canceled_at alone`,
  });

  // window_end — from arrival_window, capped at 4h; never from scheduled_end.
  const overCap = n(
    await scalar(
      sql,
      `select count(*) from job
       where window_end is not null
         and (window_end < scheduled_start or window_end > scheduled_start + interval '4 hours')`,
    ),
  );
  const windows = n(await scalar(sql, `select count(*) from job where window_end is not null`));
  const maxWindow = n(
    await scalar(
      sql,
      `select coalesce(max(extract(epoch from (window_end - scheduled_start)) / 60), 0) from job`,
    ),
  );
  const scheduledEndAbuse = n(
    await scalar(
      sql,
      `select count(*) from job
       where scheduled_end is not null and scheduled_start is not null
         and scheduled_end > scheduled_start + interval '1 day'`,
    ),
  );
  detail.window_end_rows = windows;
  detail.window_end_over_cap = overCap;
  detail.window_end_max_minutes = maxWindow;
  detail.scheduled_end_over_one_day = scheduledEndAbuse;
  add({
    group: "Derived",
    name: "job.window_end",
    status: overCap === 0 ? "pass" : "fail",
    detail: `${windows.toLocaleString()} windows, longest ${maxWindow} min, ${overCap} over the 4h cap · scheduled_end (unused) exceeds 24h on ${scheduledEndAbuse} jobs`,
  });

  // service_code — 244 price-book strings rolled up to bookable types.
  const codes = (await sql.unsafe(
    `select service_code, count(*)::bigint as n from job group by 1 order by n desc`,
  )) as unknown as { service_code: string; n: string }[];
  detail.service_codes = codes.length;
  detail.service_code_distribution = codes.map((c) => `${c.service_code}=${c.n}`).join(", ");
  add({
    group: "Derived",
    name: "job.service_code",
    status: codes.length > 0 && codes.length <= 8 ? "pass" : "fail",
    detail: `${codes.length} codes · ${codes.map((c) => `${c.service_code} ${c.n}`).join(", ")}`,
  });

  // derived_kind — behaviour, not the source label and not name tokens.
  const managers = n(
    await scalar(sql, `select count(*) from customer where derived_kind = 'property_manager'`),
  );
  const mislabelled = n(
    await scalar(
      sql,
      `select count(*) from customer where derived_kind = 'property_manager' and kind = 'homeowner'`,
    ),
  );
  const mislabelledJobs = n(
    await scalar(
      sql,
      `select count(*) from job j join customer c on c.id = j.customer_id
       where c.derived_kind = 'property_manager' and c.kind = 'homeowner'`,
    ),
  );
  const topFour = n(
    await scalar(
      sql,
      `select count(*) from (
         select c.id from customer c join job j on j.customer_id = c.id
         where c.derived_kind = 'property_manager'
         group by c.id having count(*) in (145, 101, 83, 59)
       ) t`,
    ),
  );
  detail.property_managers = managers;
  detail.property_managers_mislabelled_by_source = mislabelled;
  detail.jobs_rescued_from_wrong_kind = mislabelledJobs;
  add({
    group: "Derived",
    name: "customer.derived_kind",
    status: topFour >= 4 ? "pass" : "fail",
    detail: `${managers} property managers (${mislabelled} the source calls 'homeowner', covering ${mislabelledJobs.toLocaleString()} jobs) · all 4 largest accounts caught`,
  });

  // property visits — max(completed_at), never customer.last_job.
  const future = n(
    await scalar(
      sql,
      `select count(*) from property
       where last_visit_at > current_setting('front_desk.export_anchor')::timestamptz`,
    ),
  );
  const withVisit = n(await scalar(sql, `select count(*) from property where last_visit_at is not null`));
  const withNext = n(await scalar(sql, `select count(*) from property where next_visit_at is not null`));
  detail.properties_with_last_visit = withVisit;
  detail.properties_with_next_visit = withNext;
  detail.last_visit_in_future = future;
  add({
    group: "Derived",
    name: "property.last_visit_at",
    status: future === 0 ? "pass" : "fail",
    detail: `${withVisit.toLocaleString()} properties visited, ${withNext} with a next visit ahead of the anchor, ${future} in the future`,
  });

  // balance — voided and canceled invoices carry phantom debt.
  const excluded = n(
    await scalar(sql, `select count(*) from invoice where is_voided and coalesce(due_amount_cents, 0) > 0`),
  );
  const phantom = n(
    await scalar(
      sql,
      `select coalesce(sum(due_amount_cents), 0) from invoice where is_voided and coalesce(due_amount_cents, 0) > 0`,
    ),
  );
  const balance = n(
    await scalar(sql, `select coalesce(sum(due_amount_cents), 0) from invoice where not is_voided`),
  );
  detail.voided_invoices_excluded = excluded;
  detail.phantom_debt_cents = phantom;
  detail.balance_due_cents = balance;
  add({
    group: "Derived",
    name: "invoice.balance_due",
    status: excluded === 68 ? "pass" : "fail",
    detail: `${money(balance)} real · ${excluded} voided/canceled invoices excluded, holding ${money(phantom)} of phantom debt`,
  });

  // timezone — the instant is right; the reading is America/New_York.
  const midnightUtc = n(
    await scalar(sql, `select count(*) from job where extract(hour from scheduled_start at time zone 'UTC') = 0`),
  );
  const midnightLocal = n(
    await scalar(sql, `select count(*) from job where extract(hour from scheduled_start at time zone '${TZ}') = 0`),
  );
  detail.midnight_utc_starts = midnightUtc;
  detail.midnight_local_starts = midnightLocal;
  add({
    group: "Derived",
    name: `timestamps in ${TZ}`,
    status: midnightLocal < midnightUtc ? "pass" : "fail",
    detail: `${midnightUtc} jobs read as midnight starts in UTC; ${midnightLocal} in ${TZ}`,
  });

  return detail;
}

// --- preflight on the input ------------------------------------------------

async function requireLoadedInput(sql: Sql): Promise<number> {
  let total = 0;
  for (const { file, rows: expected } of SOURCE_FILES) {
    const actual = n(await scalar(sql, `select count(*) from raw_record where file = '${file}'`));
    total += actual;
    add({
      group: "Input",
      name: file,
      status: actual === expected ? "pass" : "fail",
      detail: `${actual.toLocaleString()} raw rows (expected ${expected.toLocaleString()})`,
    });
    if (actual !== expected) {
      throw new Error(
        `raw_record has ${actual} rows for ${file}, expected ${expected}. Run pnpm pipeline:load first.`,
      );
    }
  }
  return total;
}

// --- output ----------------------------------------------------------------

const ICON: Record<Status, string> = { pass: "  ok  ", fail: " FAIL ", warn: " warn " };

function render(): void {
  const groups = [...new Set(rows.map((r) => r.group))];
  const width = Math.max(...rows.map((r) => r.name.length)) + 2;
  console.log("\n  Front Desk — derive\n");
  for (const g of groups) {
    console.log(`  ${g}`);
    for (const r of rows.filter((x) => x.group === g)) {
      console.log(`   [${ICON[r.status]}] ${r.name.padEnd(width)} ${r.detail}`);
    }
    console.log("");
  }
}

// --- main ------------------------------------------------------------------

async function main(): Promise<number> {
  const started = Date.now();
  let rowsIn = 0;
  let rowsOut = 0;
  let detail: Record<string, number | string> = {};

  try {
    ({ rowsIn, rowsOut, detail } = await withTenant(async (sql) => {
      await sql.unsafe(`set local timezone to '${TZ}'`);
      await sql`select set_config('front_desk.export_anchor', ${EXPORT_ANCHOR}, true)`;

      const inputRows = await requireLoadedInput(sql);
      const staged = await buildAddressStaging(sql);
      add({
        group: "Input",
        name: "canonical addresses",
        status: staged.addresses === EXPECTED_COUNTS.addresses ? "pass" : "fail",
        detail: `${staged.addresses.toLocaleString()} distinct source address ids (expected ${EXPECTED_COUNTS.addresses.toLocaleString()}) + ${staged.withoutId} id-less job addresses, ${staged.jobs.toLocaleString()} job links — src/domain/address.ts`,
      });

      const steps = await runSteps(sql);
      const measured = await measure(sql);
      return {
        rowsIn: inputRows,
        rowsOut: steps.reduce((sum, s) => sum + s.affected, 0),
        detail: measured,
      };
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    render();
    console.error(`  derive FAILED: ${message}\n`);
    await recordRun("failed", rowsIn, rowsOut, detail, message, started);
    return 1;
  }

  render();
  await recordRun("ok", rowsIn, rowsOut, detail, null, started);
  console.log(`  Derived in ${((Date.now() - started) / 1000).toFixed(1)}s. Next:  pnpm test:derived\n`);
  return 0;
}

async function recordRun(
  status: string,
  rowsIn: number,
  rowsOut: number,
  detail: Record<string, number | string>,
  error: string | null,
  started: number,
): Promise<void> {
  try {
    await withTenant(
      (sql) => sql`
        insert into pipeline_run (tenant_id, task, status, started_at, finished_at, rows_in, rows_out, detail, error)
        values (${TENANT_ID}, 'derive', ${status}, ${new Date(started).toISOString()}, now(),
                ${rowsIn}, ${rowsOut}, ${sql.json(detail)}, ${error})`,
    );
  } catch (e) {
    console.error(`  (could not record pipeline_run: ${(e as Error).message})`);
  }
}

const code = await main();
await closeDb();
process.exit(code);
