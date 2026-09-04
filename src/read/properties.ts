/**
 * The property list — every building this company services, as a table.
 *
 * The Property screen used to be a search box and nothing else: you had to
 * already know an address to see anything at all. That is fine for a phone
 * agent, which always starts from an address a caller said out loud, and wrong
 * for a person at a desk who wants to know which buildings owe money, which
 * have nobody booked, or what is on a street.
 *
 * A property is the asset here, not the customer — the air conditioner never
 * moves, people do — so this is the closest thing the product has to an asset
 * register, and it carries the facts a dispatcher would ask a register for:
 * who the account is, when we were last there, what is next, what is owed.
 */
import type { Sql } from "../db/client.js";

export interface PropertyRow {
  id: number;
  address: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  customer: string | null;
  visits: number;
  lastVisitAt: string | null;
  /** The last day we were booked there, when no visit was ever marked finished. */
  lastBookedAt: string | null;
  nextVisitAt: string | null;
  openCents: number;
  openJobs: number;
  hasAccessNote: boolean;
}

export interface PropertyPage {
  rows: PropertyRow[];
  total: number;
  cities: string[];
}

export type PropertySort = "address" | "visits" | "last" | "next" | "owed";

export interface PropertyQuery {
  q?: string;
  city?: string;
  /** "owing" — money outstanding. "upcoming" — a visit booked. "quiet" — neither. */
  only?: string;
  sort?: PropertySort;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** Whitelisted, because these interpolate into ORDER BY rather than binding. */
const SORTS: Record<PropertySort, string> = {
  address: "p.street_raw",
  visits: "p.visit_count",
  last: "p.last_visit_at",
  next: "p.next_visit_at",
  owed: "owed.open_cents",
};

export async function listProperties(sql: Sql, opts: PropertyQuery = {}): Promise<PropertyPage> {
  const q = (opts.q ?? "").trim();
  const city = (opts.city ?? "").trim();
  const only = (opts.only ?? "").trim();
  const sortKey: PropertySort = (SORTS[opts.sort as PropertySort] ? opts.sort : "address") as PropertySort;
  const col = SORTS[sortKey];
  const dir = opts.dir === "desc" ? "desc" : "asc";
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Number(opts.offset ?? 0), 0);

  // Built once and reused by the page query and the count, so the number at the
  // top of the screen can never disagree with the rows underneath it.
  const where = sql`
    where (${q === ""} or p.street_raw ilike ${`%${q}%`} or coalesce(acct.name, '') ilike ${`%${q}%`})
      and (${city === ""} or p.city = ${city})
      and (${only !== "owing"} or coalesce(owed.open_cents, 0) > 0)
      and (${only !== "upcoming"} or p.next_visit_at is not null)
      and (${only !== "quiet"} or (p.next_visit_at is null and coalesce(owed.open_cents, 0) = 0))
  `;

  // The account is whoever has the most jobs at this building — 53.8% of the
  // work comes from property managers, so the newest caller is not the account.
  const joins = sql`
    from property p
    left join lateral (
      select coalesce(c.company, nullif(trim(c.first_name || ' ' || c.last_name), '')) as name
      from job j join customer c on c.id = j.customer_id
      where j.property_id = p.id
      group by c.id, c.company, c.first_name, c.last_name
      order by count(j.id) desc
      limit 1
    ) acct on true
    left join lateral (
      select coalesce(sum(i.due_amount_cents), 0)::bigint as open_cents
      from invoice i join job j on j.id = i.job_id
      where j.property_id = p.id and not i.is_voided and coalesce(i.due_amount_cents, 0) > 0
    ) owed on true
    left join lateral (
      select count(*)::int as n from job j
      where j.property_id = p.id and not j.is_canceled and j.completed_at is null
    ) live on true
    left join lateral (
      select max(j.scheduled_start) as at from job j
      where j.property_id = p.id and not j.is_canceled and j.scheduled_start < now()
    ) last_booked on true
  `;

  const rows = await sql`
    select p.id, p.street_raw, p.unit, p.city, p.state, p.zip,
           p.visit_count, p.last_visit_at, p.next_visit_at,
           acct.name as customer,
           coalesce(owed.open_cents, 0) as open_cents,
           -- 68 past jobs in this export were never marked finished, so 50
           -- buildings have visits and no last_visit_at and the column read "—"
           -- as if nobody had ever been. This is the day we were last booked
           -- there, shown only when there is no confirmed visit, and labelled
           -- as what it is rather than promoted to one.
           last_booked.at as last_booked_at,
           coalesce(live.n, 0) as open_jobs,
           exists (
             select 1 from extracted_fact f
             where f.fact_type = 'access' and f.superseded_by is null
               and ((f.subject_type = 'property' and f.subject_id = p.id)
                 or (f.subject_type = 'job' and f.subject_id in (select j2.id from job j2 where j2.property_id = p.id)))
           ) as has_access_note
    ${joins} ${where}
    order by ${sql.unsafe(col)} ${sql.unsafe(dir)} nulls last, p.street_raw asc
    limit ${limit} offset ${offset}
  `;

  const [count] = await sql`select count(*)::int as n ${joins} ${where}`;

  // The city list is the whole book, not the filtered page, so choosing a city
  // never empties the menu you chose it from.
  const cityRows = await sql`
    select distinct city from property where city is not null and city <> '' order by city
  `;

  return {
    rows: (rows as unknown as Record<string, unknown>[]).map((r) => ({
      id: Number(r["id"]),
      address: String(r["street_raw"] ?? ""),
      unit: (r["unit"] as string) ?? null,
      city: (r["city"] as string) ?? null,
      state: (r["state"] as string) ?? null,
      zip: (r["zip"] as string) ?? null,
      customer: (r["customer"] as string) ?? null,
      visits: Number(r["visit_count"] ?? 0),
      lastVisitAt: r["last_visit_at"] ? (r["last_visit_at"] as Date).toISOString() : null,
      lastBookedAt: r["last_booked_at"] ? (r["last_booked_at"] as Date).toISOString() : null,
      nextVisitAt: r["next_visit_at"] ? (r["next_visit_at"] as Date).toISOString() : null,
      openCents: Number(r["open_cents"] ?? 0),
      openJobs: Number(r["open_jobs"] ?? 0),
      hasAccessNote: Boolean(r["has_access_note"]),
    })),
    total: Number((count as unknown as { n: number }).n),
    cities: (cityRows as unknown as { city: string }[]).map((c) => c.city),
  };
}
