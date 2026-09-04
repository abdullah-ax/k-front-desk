/**
 * The property dossier — the single fetch made when a call connects
 * (.claude/plans/front-desk.plan.md, task 10).
 *
 * Why this exists in this shape:
 *
 *   A voice turn is about two seconds end to end. Speech recognition and
 *   synthesis eat ~400ms, the model's first token another ~400ms. Every
 *   mid-call tool has to fit in the few hundred milliseconds left, which rules
 *   out multi-hop lookups while a caller waits.
 *
 *   So instead of the agent reasoning its way to the answer one tool at a time,
 *   we fetch the whole property in one round trip the moment the phone is
 *   answered. Most questions then need ZERO reasoning steps, because the answer
 *   is already in front of the model.
 *
 *   This is affordable because of a measured fact: an address's entire note
 *   history is a median of ~230 tokens and ~2,000 at the 99th percentile. A
 *   property fits in a prompt. A CUSTOMER does not — the largest holds 145 jobs
 *   and 118,639 characters — which is one more reason property, not customer,
 *   is the key to this system.
 *
 * The top 1% still need a guard, so `budgetNotes` trims oldest-first and says
 * so, rather than silently truncating or blowing the turn.
 */
import { withTenant, type Sql } from "../db/client.js";
import { EXPORT_ANCHOR } from "../config.js";
import { normalizeStreet } from "../domain/address.js";
// The secret rules live in one module now, because the call trace added a
// second surface that has to obey exactly the same ones. See the header of
// src/security/redact.ts for why over-redaction is as dangerous as under.
import {
  SECRET_KINDS,
  CODE_SHAPED,
  INTERNAL_KEYS,
  isSecretFact,
  redactSecrets,
} from "../security/redact.js";

/** Rough token estimate. Deliberately crude — this gates a budget, not a bill. */
const charsPerToken = 4;
const estimateTokens = (s: string): number => Math.ceil(s.length / charsPerToken);

/**
 * Note budget for a single call. p99 of an address's history is ~2,000 tokens,
 * so this clears almost every property outright and only bites the tail.
 */
export const NOTE_TOKEN_BUDGET = 2500;

export interface DossierJob {
  jobRef: string;
  serviceCode: string;
  description: string | null;
  status: string;
  isCanceled: boolean;
  scheduledStart: Date | null;
  completedAt: Date | null;
  /**
   * When the technician actually began.
   *
   * Present because "move my appointment" is one of the five things the owner
   * said the agent cannot do, and the answer turns entirely on this column: a
   * visit already under way cannot be moved, and a caller asking to move one
   * almost always means the one that has not happened yet. Without it here the
   * agent picks the most recent job, which on a busy address is today's, and
   * dead-ends.
   */
  startedAt: Date | null;
  totalCents: number;
  employees: string[];
  notes: { id: number; content: string }[];
}

export interface DossierFact {
  factType: string;
  payload: Record<string, unknown>;
  /** Verbatim source text. The agent quotes this rather than asserting. */
  snippet: string;
  confidence: number;
  jobRef: string | null;
  /**
   * The note the snippet is in.
   *
   * Needed by the proof layer of the call trace: a verbatim sentence with no
   * way back to the note it came from is a quotation nobody can check, and
   * checkable is the entire point.
   */
  noteId: number | null;
  /** Every note this fact was written in. One fact, many people writing it down. */
  sources?: { noteId: number | null; jobRef: string | null; snippet: string }[];
}

export interface PropertyDossier {
  property: {
    id: number;
    canonicalKey: string;
    street: string;
    unit: string | null;
    city: string | null;
    zip: string | null;
    lastVisitAt: Date | null;
    nextVisitAt: Date | null;
    visitCount: number;
  };
  customers: { id: number; displayName: string; derivedKind: string; isPrimary: boolean }[];
  jobs: DossierJob[];
  /** Entry instructions, contacts, unit identifiers, warranty claims, policies, parts. */
  facts: Record<string, DossierFact[]>;
  balance: { openCents: number; openInvoices: number; oldestSentAt: Date | null };
  /** What the agent must be told before it opens its mouth. */
  policies: DossierFact[];
  meta: {
    noteTokens: number;
    notesIncluded: number;
    notesOmitted: number;
    truncated: boolean;
    fetchMs: number;
  };
}

/**
 * Everything a call needs about one property, in one round trip.
 *
 * Returns null when the property does not exist — callers must not paper over
 * that with an empty dossier, because "we have no record" and "we have a record
 * with nothing in it" are different things to say to a caller.
 */
export async function getPropertyDossier(
  propertyId: number,
  /**
   * A connection from `openCallConnection()`. Pass one during a live call: it
   * is already scoped, so each query is a single round trip instead of the four
   * a fresh transaction costs. Omit it for offline work (tests, pipelines).
   */
  conn?: Sql,
): Promise<PropertyDossier | null> {
  const started = Date.now();
  const run = <R>(fn: (sql: Sql) => Promise<R>): Promise<R> =>
    conn ? fn(conn) : withTenant(fn);

  return run(async (sql) => {
    const [property] = await sql`
      select id, canonical_key, street_raw, unit, city, zip,
             last_visit_at, next_visit_at, coalesce(visit_count, 0) as visit_count
      from property
      where id = ${propertyId}
    `;
    if (!property) return null;

    // NOTE ON PARALLELISM: these run on one transaction's connection, so
    // Promise.all does NOT overlap them — postgres pipelines them but they
    // still cost a round trip each. At ~140ms per trip to a hosted database
    // that is the dominant cost of this function, not the queries themselves.
    // Kept as separate statements for legibility; if the call-open budget ever
    // needs the last few hundred milliseconds, fold them into one CTE returning
    // a single json document.
    const [jobRows, factRows, customerRows, balanceRows] = await Promise.all([
      sql`
        select j.id, j.job_ref, j.service_code, j.description, j.work_status,
               j.is_canceled, j.scheduled_start, j.completed_at, j.started_at,
               coalesce(j.total_amount_cents, 0) as total_cents,
               coalesce(
                 array_agg(distinct trim(
                   coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')
                 )) filter (where e.id is not null),
                 '{}'
               ) as employees
        from job j
        left join job_employee je on je.job_id = j.id
        left join employee e on e.id = je.employee_id
        where j.property_id = ${propertyId}
        group by j.id
        order by coalesce(j.completed_at, j.scheduled_start, j.created_at) desc nulls last
      `,
      sql`
        select f.fact_type, f.payload, f.snippet, f.confidence, j.job_ref,
               f.source_note_id
        from extracted_fact f
        left join note n on n.id = f.source_note_id
        left join job j on j.id = n.job_id
        where f.superseded_by is null
          and (
            (f.subject_type = 'property' and f.subject_id = ${propertyId})
            or (f.subject_type = 'job' and f.subject_id in (
                  select id from job where property_id = ${propertyId}))
          )
        order by f.confidence desc nulls last
      `,
      sql`
        -- Display name must fall back through all three fields: 360 jobs have a
        -- customer with no human name at all, only a company.
        --
        -- COMPANY FIRST, matching src/read/board.ts, job.ts and tickets.ts. This
        -- one query used to put the person first, so the same account read as
        -- "Lighthouse Hospitality" on the board and "Tanya Delaney" on the
        -- property page — and the agent, which reads this dossier, said the
        -- second name to a caller looking at the first. For a commercial
        -- account the company IS the customer; the person is a contact.
        select c.id,
               coalesce(
                 c.company,
                 nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''),
                 'unnamed account'
               ) as display_name,
               c.derived_kind, count(j.id) as jobs
        from job j
        join customer c on c.id = j.customer_id
        where j.property_id = ${propertyId}
        group by c.id
        order by count(j.id) desc
      `,
      sql`
        select coalesce(sum(i.due_amount_cents), 0)::bigint as open_cents,
               count(*)::int as open_invoices,
               min(i.sent_at) as oldest_sent_at
        from invoice i
        join job j on j.id = i.job_id
        where j.property_id = ${propertyId}
          and not i.is_voided
          and coalesce(i.due_amount_cents, 0) > 0
      `,
    ]);

    // Notes, newest first, trimmed to a budget. Recency wins because the LAST
    // note is current state: 14.4% of jobs contain both "system is functioning
    // properly" and "still not cooling", and without note timestamps the only
    // honest ordering is the one the office wrote them in.
    const jobIds = (jobRows as unknown as { id: number | string }[]).map((j) => Number(j.id));
    const noteRows = jobIds.length
      ? await sql`
          -- content_scrubbed, not content: the raw text contains anonymizer
          -- damage (a phone number rendered as a person's name, "work" rendered
          -- as a company). The agent must never read the raw form aloud.
          select n.id, n.job_id,
                 coalesce(n.content_scrubbed, n.content) as content,
                 n.note_index
          from note n
          where n.job_id = any(${sql.array(jobIds)}::bigint[])
          order by n.job_id, n.note_index
        `
      : [];

    // Entry codes must not reach the model from ANY direction. Redacting the
    // fact payload and its snippet is not enough: most of this corpus uses a
    // `[code]` token, but a handful of notes carry a real number inline
    // ("Access info: 20396 check Carmen ..."), and the note text is rendered in
    // the history. So the known codes for this property are scrubbed out of the
    // note bodies too. Three places, one secret — miss any and the injection
    // that read "812898" aloud works again.
    const knownSecrets = new Set<string>();
    for (const f of factRows as unknown as Record<string, never>[]) {
      const payload = (f["payload"] as unknown as Record<string, unknown>) ?? {};
      const value = payload["value"];
      if (
        SECRET_KINDS.test(String(payload["kind"] ?? payload["type"] ?? "")) &&
        typeof value === "string" &&
        CODE_SHAPED.test(value)
      ) {
        knownSecrets.add(value.trim());
      }
    }
    const scrubSecrets = (text: string): string => {
      let out = text;
      for (const secret of knownSecrets) {
        out = out.split(secret).join("[code withheld]");
      }
      return out;
    };

    const notesByJob = new Map<number, { id: number; content: string }[]>();
    for (const n of noteRows as { id: number; job_id: number; content: string }[]) {
      const list = notesByJob.get(Number(n.job_id)) ?? [];
      list.push({ id: Number(n.id), content: scrubSecrets(n.content) });
      notesByJob.set(Number(n.job_id), list);
    }

    const streetForNotes = String(property["street_raw"] ?? "");
    let noteTokens = 0;
    let notesIncluded = 0;
    let notesOmitted = 0;
    let truncated = false;

    const jobs: DossierJob[] = (jobRows as unknown as Record<string, never>[]).map((j) => {
      const all = notesByJob.get(Number(j["id"])) ?? [];
      const kept: { id: number; content: string }[] = [];
      for (const n of all) {
        const cost = estimateTokens(n.content);
        if (noteTokens + cost > NOTE_TOKEN_BUDGET) {
          truncated = true;
          notesOmitted += 1;
          continue;
        }
        noteTokens += cost;
        notesIncluded += 1;
        // Corrected here, not only where the agent's text is rendered. The
        // Property screen reads these notes straight off the API and was
        // showing "7 Doris Rollins Cir" under a heading that says 7 Grouper
        // Shores Cir — the same wrong street, on a different surface.
        kept.push({ id: n.id, content: useOwnAddress(n.content, streetForNotes) });
      }
      return {
        jobRef: j["job_ref"] as unknown as string,
        serviceCode: j["service_code"] as unknown as string,
        description: j["description"] as unknown as string | null,
        status: j["work_status"] as unknown as string,
        isCanceled: j["is_canceled"] as unknown as boolean,
        scheduledStart: j["scheduled_start"] as unknown as Date | null,
        completedAt: j["completed_at"] as unknown as Date | null,
        startedAt: j["started_at"] as unknown as Date | null,
        totalCents: Number(j["total_cents"]),
        employees: (j["employees"] as unknown as string[]) ?? [],
        notes: kept,
      };
    });

    const streetForFacts = String(property["street_raw"] ?? "");
    const facts: Record<string, DossierFact[]> = {};
    for (const f of factRows as unknown as Record<string, never>[]) {
      const type = f["fact_type"] as unknown as string;
      const rawPayload = (f["payload"] as unknown as Record<string, unknown>) ?? {};
      // A `units` fact identifies what was worked on, and for a whole-property
      // job that identifier IS an address — carrying the same anonymiser damage
      // as the snippet beside it. Fixing only the quote left the heading wrong.
      const payload =
        typeof rawPayload["identifier"] === "string"
          ? { ...rawPayload, identifier: useOwnAddress(rawPayload["identifier"], streetForFacts) }
          : rawPayload;
      (facts[type] ??= []).push({
        factType: type,
        payload,
        // Same anonymiser damage as the notes: about 11% of this corpus names a
        // different street from the property it hangs off. A fact card headed
        // "7 Doris Rollins Cir" on the page for 7 Grouper Shores Cir is the
        // same lie the agent used to read out loud, just written down.
        snippet: useOwnAddress(String(f["snippet"] ?? ""), streetForFacts),
        confidence: Number(f["confidence"] ?? 0),
        jobRef: (f["job_ref"] as unknown as string | null) ?? null,
        noteId: f["source_note_id"] ? Number(f["source_note_id"]) : null,
      });
    }

    // ONE FACT PER THING KNOWN, NOT ONE PER NOTE.
    //
    // Every note that mentioned the door code produced its own row, so the
    // Locations screen showed "Door code is on file" six times in a column,
    // each with a different note number. That is one fact the office wrote down
    // six times, and a screen that repeats itself reads as broken.
    //
    // The sources are kept — all of them — on the fact that survives, because
    // "where did this come from" is the whole point of the panel. What goes is
    // the repetition, not the evidence.
    for (const [type, list] of Object.entries(facts)) {
      const merged = new Map<string, DossierFact>();
      for (const f of list) {
        const p = f.payload as Record<string, unknown>;
        // Same kind and same value is the same fact, however many people wrote
        // it down. `identifier` covers units, `claim` covers warranty.
        const key = [type, p["kind"] ?? "", p["value"] ?? "", p["identifier"] ?? "",
                     p["claim"] ?? "", p["name"] ?? "", p["role"] ?? ""].join("\u0000");
        const seen = merged.get(key);
        if (!seen) {
          merged.set(key, { ...f, sources: [{ noteId: f.noteId, jobRef: f.jobRef, snippet: f.snippet }] });
        } else {
          seen.sources = seen.sources ?? [];
          if (!seen.sources.some((s) => s.noteId === f.noteId)) {
            seen.sources.push({ noteId: f.noteId, jobRef: f.jobRef, snippet: f.snippet });
          }
        }
      }
      facts[type] = [...merged.values()];
    }

    const balance = balanceRows[0] as unknown as {
      open_cents: string;
      open_invoices: number;
      oldest_sent_at: Date | null;
    };

    return {
      property: {
        // bigint arrives from the driver as a STRING, so every id needs an
        // explicit Number(). Skipping it means `dossier.property.id === id`
        // is false for the caller who just looked it up.
        id: Number(property["id"]),
        canonicalKey: property["canonical_key"] as string,
        street: property["street_raw"] as string,
        unit: (property["unit"] as string | null) ?? null,
        city: (property["city"] as string | null) ?? null,
        zip: (property["zip"] as string | null) ?? null,
        lastVisitAt: (property["last_visit_at"] as Date | null) ?? null,
        nextVisitAt: (property["next_visit_at"] as Date | null) ?? null,
        visitCount: Number(property["visit_count"] ?? 0),
      },
      customers: (customerRows as unknown as Record<string, never>[]).map((c, i) => ({
        id: Number(c["id"]),
        displayName: c["display_name"] as unknown as string,
        derivedKind: c["derived_kind"] as unknown as string,
        isPrimary: i === 0,
      })),
      jobs,
      facts,
      // Surfaced separately from `facts` because the agent must read these
      // BEFORE it says anything — e.g. "do not discuss the diagnosis with the
      // tenants, call the property manager".
      policies: facts["policy"] ?? [],
      balance: {
        openCents: Number(balance?.open_cents ?? 0),
        openInvoices: Number(balance?.open_invoices ?? 0),
        oldestSentAt: balance?.oldest_sent_at ?? null,
      },
      meta: {
        noteTokens,
        notesIncluded,
        notesOmitted,
        truncated,
        fetchMs: Date.now() - started,
      },
    };
  });
}

/**
 * Compact text rendering for the model's context at call open.
 *
 * Deliberately terse and dated: the agent needs to be able to say "on the 19th
 * of August the office wrote X", not to paraphrase a summary of a summary.
 */
/**
 * Internal bookkeeping on an extracted fact. Valuable in the database — it is
 * how a wrong answer stays traceable — but it must never reach the model.
 *
 * The trap this closes: `_scrub` records what a corrupt token WAS before
 * repair, so it literally contains the strings "Ruby Avery" and "Tidewater
 * Hospitality". Dumping the raw payload put those back into the text the agent
 * reads aloud, defeating the entire scrubbing pass by way of its own audit
 * trail. Caught by the dossier test, not by inspection.
 */
function renderPayload(payload: Record<string, unknown>): string {
  const shown = Object.entries(redactSecrets(payload))
    .filter(([k, v]) => !INTERNAL_KEYS.has(k) && v != null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return shown.length ? shown.join(", ") : "(no details)";
}

/* Street words this corpus actually uses, longest first so "Cir" inside
   "Circle" does not win. */
const STREET_TYPE =
  "(?:Boulevard|Parkway|Terrace|Crossing|Landing|Circle|Avenue|Street|Place|Court|Drive|Trail|Ridge|Shores|Harbor|Hollow|Pointe|Bluff|Cove|Glen|Lane|Loop|Road|Trl|Pkwy|Blvd|Ave|Cir|Ct|Dr|Ln|Rd|St|Ter|Pl|Way|Cv|Cay|Key)";
const ADDRESS_IN_TEXT = new RegExp(
  String.raw`\b\d{1,6}\s+(?:[A-Z][A-Za-z'.-]*\s+){0,4}` + STREET_TYPE + String.raw`\b`,
  "g",
);

/**
 * Makes every address inside a note the property's own.
 *
 * About 11% of the notes in this export carry a DIFFERENT street from the
 * property they hang off — the anonymiser rewrote the address in the note text
 * but not the property row. 7 Grouper Shores Cir has nine notes that call it
 * 7 Doris Rollins Cir, so the model saw the wrong street nine times and the
 * right one once, and read the wrong one back to the caller at the exact moment
 * it was confirming a change. That is the worst possible place to be wrong.
 *
 * The prompt already tells the agent not to do this. Asking a model to ignore
 * the most repeated fact in its context is a losing bet, so the fix belongs
 * here: the resolver decided which property this is, and every address in the
 * text is made to agree with it. Nothing else in the note is touched, so what
 * the office actually wrote about the work still reads verbatim.
 */
export function useOwnAddress(text: string, canonicalStreet: string): string {
  if (!canonicalStreet) return text;
  const mine = normalizeStreet(canonicalStreet);
  if (!mine) return text;
  return text.replace(ADDRESS_IN_TEXT, (found) =>
    normalizeStreet(found) === mine ? found : canonicalStreet,
  );
}

export function renderDossier(d: PropertyDossier): string {
  const day = (x: Date | null): string =>
    x ? new Date(x).toLocaleDateString("en-US", { timeZone: "America/New_York" }) : "unknown";

  const lines: string[] = [];
  const p = d.property;
  lines.push(`PROPERTY: ${p.street}${p.unit ? ` unit ${p.unit}` : ""}${p.city ? `, ${p.city}` : ""}`);
  lines.push(
    `${p.visitCount} visit(s). Last ${day(p.lastVisitAt)}.` +
      (p.nextVisitAt ? ` Next scheduled ${day(p.nextVisitAt)}.` : ""),
  );

  if (d.customers.length) {
    lines.push(
      `ACCOUNT: ${d.customers.map((c) => `${c.displayName} (${c.derivedKind})`).join("; ")}`,
    );
  }

  if (d.policies.length) {
    lines.push("STANDING RULES — read before answering:");
    for (const pol of d.policies) lines.push(`  - "${pol.snippet.trim()}"`);
  }

  for (const [type, list] of Object.entries(d.facts)) {
    if (type === "policy" || !list.length) continue;
    lines.push(`${type.toUpperCase()}:`);
    for (const f of list.slice(0, 8)) {
      // The snippet is the verbatim source sentence — and for an entry code
      // that sentence IS the code. Redacting the payload while printing the
      // quote leaks it through the evidence trail, which is the same mistake
      // the _scrub metadata made. Secrets get no quote.
      const secret = isSecretFact(f.payload);
      lines.push(
        secret
          ? `  - ${renderPayload(f.payload)}`
          : `  - ${renderPayload(f.payload)}  [source: "${f.snippet.trim()}"]`,
      );
    }
  }

  if (d.balance.openCents > 0) {
    lines.push(
      `BALANCE: $${(d.balance.openCents / 100).toFixed(2)} across ${d.balance.openInvoices} open invoice(s).`,
    );
  }

  // Upcoming visits first and named as movable, because "move my appointment"
  // is a question about the future and the history is ordered by the past.
  const movable = d.jobs.filter(
    (j) => !j.isCanceled && !j.startedAt && !j.completedAt && j.scheduledStart &&
      new Date(j.scheduledStart).getTime() > Date.now(),
  );
  if (movable.length) {
    lines.push("UPCOMING — these are the visits that can still be moved or canceled:");
    for (const j of movable.slice(0, 6)) {
      lines.push(`  #${j.jobRef} ${day(j.scheduledStart)} — ${j.serviceCode}`);
    }
  } else {
    lines.push("UPCOMING: none. There is no future visit here to move.");
  }

  lines.push("HISTORY (newest first):");
  for (const j of d.jobs.slice(0, 12)) {
    const when = j.completedAt ? day(j.completedAt) : `scheduled ${day(j.scheduledStart)}`;
    const underway = !j.completedAt && j.startedAt ? " (UNDER WAY — cannot be moved)" : "";
    lines.push(
      `  #${j.jobRef} ${when}${underway} — ${j.serviceCode}${j.isCanceled ? " (CANCELED)" : ""}` +
        (j.employees.length ? ` — ${j.employees.join(", ")}` : ""),
    );
    for (const n of j.notes) {
      lines.push(`      ${useOwnAddress(n.content, p.street).replace(/\s+/g, " ").trim()}`);
    }
  }

  if (d.meta.truncated) {
    lines.push(
      `(${d.meta.notesOmitted} older note(s) omitted for length — say so rather than implying this is the whole history.)`,
    );
  }

  // Two different dates, and conflating them is what made the agent say
  // "tomorrow, September second" on a call placed on September fourth.
  //
  //   EXPORT_ANCHOR  where the RECORDS stop. Nothing was imported after it.
  //   now()          what day it actually is, which is what a caller means by
  //                  "today" and what the board and the write path both use.
  //
  // The anchor stood in for "today" while nothing ever wrote. The product books
  // visits now, against the real clock, so an agent that thinks it is still the
  // freeze date promises a date the dispatch board will never show.
  lines.push(
    `Records begin March 2026 and run to ${day(new Date(EXPORT_ANCHOR))}. Today is ${day(new Date())}.`,
  );
  return lines.join("\n");
}
