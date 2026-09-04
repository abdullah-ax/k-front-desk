/**
 * Property resolver tests — `pnpm test:resolve`, task 7 of
 * `.claude/plans/front-desk.plan.md`.
 *
 * These run against the LIVE loaded database (1,327 property rows). Nothing is
 * mocked, because the whole point of the module under test is how it behaves
 * against this particular corpus: 259 house numbers reused across 955
 * addresses, 51 street pairs that differ only in spelling, and one address with
 * 18 units under 18 different customers.
 *
 * Expected counts are QUERIED, never hardcoded, so a reload that changes the
 * data fails the assertion instead of silently invalidating it.
 *
 * The headline test is `never resolves a near-miss`. Everything else can
 * degrade into asking another question; that one cannot fail without the agent
 * reading a stranger's service history aloud.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withTenant } from "../src/db/client.js";
import { normalizeStreet } from "../src/domain/address.js";
import {
  RESOLVE_MIN_CONFIDENCE,
  expandSpokenNumbers,
  normalizeQuery,
  resolveProperty,
  type PropertyQuery,
  type ResolutionResult,
} from "../src/domain/resolve-property.js";

// --- fixtures pulled from the live table -----------------------------------

interface PropRow {
  id: string;
  street_raw: string;
  street_norm: string;
  unit: string | null;
}

/** street_norm -> the property ids standing at it. */
const byStreet = new Map<string, PropRow[]>();
let allProperties: PropRow[] = [];

/** Measured numbers, printed at the end so the run reports rather than ticks. */
const measured: Record<string, string | number> = {};

async function loadStreets(streets: string[]): Promise<void> {
  const rows = await withTenant((sql) =>
    sql<PropRow[]>`
      select id::text as id, street_raw, street_norm, unit
        from property
       where street_norm = any(${streets})
       order by street_norm, unit nulls first`,
  );
  for (const r of rows) {
    const list = byStreet.get(r.street_norm) ?? [];
    list.push(r);
    byStreet.set(r.street_norm, list);
  }
}

function at(street: string): PropRow[] {
  const rows = byStreet.get(normalizeStreet(street));
  if (rows === undefined || rows.length === 0) {
    throw new Error(`fixture missing: no property at ${street}`);
  }
  return rows;
}

/**
 * Bounded-concurrency map. The pooler is free tier and capped at 15 clients in
 * session mode, shared with whatever else is running against this database, so
 * this stays deliberately small.
 */
async function pooled<T>(items: readonly T[], workers: number, fn: (t: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        await fn(items[i]!);
      }
    }),
  );
}

// --- the seven near-miss pairs from eda/04-customers-identity.md §4.4 -------
//
// Genuinely different addresses that sound near-identical over a phone line.
// Every one of them differs ONLY in the house number, which is why the resolver
// treats the house number as an equality gate rather than a similarity input.

const NEAR_MISS_PAIRS: readonly (readonly [string, string])[] = [
  ["112 Marlin Hollow Dr", "122 Marlin Hollow Dr"],
  ["103 Grouper Landing Rd", "11 Grouper Landing Rd"],
  ["1030 Cowrie Hollow Drive", "130 Cowrie Hollow Drive"],
  ["107 Seagrape Glen Run E", "157 Seagrape Glen Run E"],
  ["114 S Leeward Glen St", "145 S Leeward Glen St"],
  ["10254 E Old Mangrove Rd", "2542 E Old Mangrove Rd"],
  ["11 Amberjack Landing Rd", "19 Amberjack Landing Rd"],
];

/** Spellings of one address that must land on exactly the same property set. */
const SPELLING_VARIANTS: readonly (readonly [string, string])[] = [
  ["1008 Oleander Cay Rd", "1008 Oleander Cay Road"],
  ["10254 E Old Mangrove Rd", "10254 East Old Mangrove Rd"],
  ["104 N Grouper Hollow Square", "104 North Grouper Hollow Square"],
  ["1030 Cowrie Hollow Drive", "1030 Cowrie Hollow dr"],
  ["1432 Flamingo Harbor Cir E", "1432 Flamingo Harbor Circle East"],
  ["25 Permit Terrace Court", "25 Permit Terrace Ct"],
  ["8613 Rudder Landing Lane", "8613 Rudder Landing Ln"],
];

const CONDO = "1363 W Old Mangrove Rd";

beforeAll(async () => {
  const wanted = new Set<string>();
  for (const [a, b] of NEAR_MISS_PAIRS) {
    wanted.add(normalizeStreet(a));
    wanted.add(normalizeStreet(b));
  }
  for (const [a, b] of SPELLING_VARIANTS) {
    wanted.add(normalizeStreet(a));
    wanted.add(normalizeStreet(b));
  }
  wanted.add(normalizeStreet(CONDO));
  wanted.add(normalizeStreet("550 Cormorant Reef Blvd"));
  wanted.add(normalizeStreet("112 Marlin Hollow Blvd"));
  await loadStreets([...wanted]);

  allProperties = await withTenant((sql) =>
    sql<PropRow[]>`
      select id::text as id, street_raw, street_norm, unit
        from property
       where street_norm is not null and street_norm <> ''
       order by md5(id::text)`,
  );
}, 120_000);

afterAll(async () => {
  const lines = Object.entries(measured).map(([k, v]) => `  ${k}: ${v}`);
  console.log(`\n--- resolver, measured ---\n${lines.join("\n")}\n`);
  await closeDb();
});

// --- shape ------------------------------------------------------------------

describe("return shape", () => {
  it("is always a list plus a confidence, whatever happened", async () => {
    const inputs: PropertyQuery[] = [
      { rawStreet: CONDO },
      { rawStreet: CONDO, unit: at(CONDO)[1]!.unit },
      { rawStreet: "9999 Nowhere Street" },
      { lastName: "Jennings" },
      {},
    ];
    for (const input of inputs) {
      const r: ResolutionResult = await resolveProperty(input);
      expect(Array.isArray(r.candidates)).toBe(true);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(["resolved", "needs_unit", "needs_more", "not_found"]).toContain(r.decision);
      // A resolved answer is exactly one candidate. Never two, never zero.
      if (r.decision === "resolved") {
        expect(r.candidates).toHaveLength(1);
        expect(r.totalCandidates).toBe(1);
        expect(r.confidence).toBeGreaterThanOrEqual(RESOLVE_MIN_CONFIDENCE);
      } else {
        expect(r.candidates.filter((c) => c.eligible).length).not.toBe(1);
      }
    }
  }, 60_000);

  it("never confirms with city or ZIP", async () => {
    // The same physical address is filed under two ZIPs in this export, so a
    // ZIP is neither proof nor disproof. Passing a wrong one must change
    // nothing at all.
    const target = at(CONDO)[3]!;
    const withZip = await resolveProperty({
      rawStreet: CONDO,
      unit: target.unit,
      city: "Nowhereville",
      zip: "00000",
    });
    const without = await resolveProperty({ rawStreet: CONDO, unit: target.unit });
    expect(withZip.decision).toBe("resolved");
    expect(withZip.candidates[0]!.id).toBe(without.candidates[0]!.id);
    expect(withZip.confidence).toBe(without.confidence);
    // And the offered disambiguator never leans on either field.
    expect(withZip.candidates[0]!.disambiguator).not.toMatch(/gables|33162|coral/i);
  }, 60_000);
});

// --- the condo -------------------------------------------------------------

describe("1363 W Old Mangrove Rd — 18 units, 18 customers, one street string", () => {
  it("demands the unit and reports how many properties are behind the address", async () => {
    const expected = at(CONDO).length;
    measured["1363 W Old Mangrove candidates"] = expected;
    const r = await resolveProperty({ rawStreet: CONDO });
    expect(r.decision).toBe("needs_unit");
    expect(r.askFor).toBe("unit");
    expect(r.totalCandidates).toBe(expected);
    expect(r.candidates).toHaveLength(expected);
    expect(r.confidence).toBeLessThan(0.2);
    // Every candidate must carry a readable disambiguator, since the agent has
    // to separate them out loud without naming a city or a ZIP.
    for (const c of r.candidates) expect(c.disambiguator).toMatch(/unit|no unit on file/);
    expect(r.candidates.some((c) => c.disambiguator.includes("last serviced"))).toBe(true);
  }, 60_000);

  it("resolves to exactly one property once the unit is known", async () => {
    for (const row of at(CONDO)) {
      if (row.unit === null) continue;
      const r = await resolveProperty({ rawStreet: CONDO, unit: row.unit });
      expect(r.decision).toBe("resolved");
      expect(r.candidates).toHaveLength(1);
      expect(r.candidates[0]!.id).toBe(row.id);
      expect(r.candidates[0]!.unitMatch).toBe("exact");
    }
  }, 180_000);

  it("does not resolve when the caller names a unit that is not there", async () => {
    const r = await resolveProperty({ rawStreet: CONDO, unit: "9999" });
    expect(r.decision).toBe("needs_unit");
    expect(r.candidates.length).toBeGreaterThan(1);
  }, 60_000);
});

// --- the safety test -------------------------------------------------------

describe("near-miss addresses are never confused (the core safety test)", () => {
  it("never resolves the wrong one of a near-identical pair", async () => {
    const wrong: string[] = [];
    for (const pair of NEAR_MISS_PAIRS) {
      for (const [spoken, other] of [pair, [pair[1], pair[0]] as const]) {
        const mine = new Set(at(spoken).map((p) => p.id));
        const theirs = new Set(at(other).map((p) => p.id));
        const r = await resolveProperty({ rawStreet: spoken });

        if (r.decision === "resolved") {
          const got = r.candidates[0]!;
          if (!mine.has(got.id)) wrong.push(`${spoken} resolved to ${got.id} (${got.streetRaw})`);
          if (theirs.has(got.id)) wrong.push(`${spoken} resolved to its near miss ${other}`);
        }
        // Stronger: nothing at the other house number is ever even eligible.
        for (const c of r.candidates) {
          if (c.eligible && theirs.has(c.id)) {
            wrong.push(`${spoken} marked ${other} (${c.id}) eligible`);
          }
        }
      }
    }
    measured["near-miss wrong resolutions"] = wrong.length;
    expect(wrong).toEqual([]);
  }, 180_000);

  it("does not jump to the neighbour when the spoken unit only exists next door", async () => {
    // Unit 610 exists at 112 Marlin Hollow Dr. A caller who says 122 with that
    // unit must not be handed 112 — the house number is what they said.
    const at112 = at("112 Marlin Hollow Dr");
    const unit = at112.find((p) => p.unit !== null)?.unit ?? null;
    expect(unit).not.toBeNull();
    const r = await resolveProperty({ rawStreet: "122 Marlin Hollow Dr", unit });
    expect(r.decision).not.toBe("resolved");
    expect(r.candidates.map((c) => c.id)).not.toContain(at112[0]!.id);
  }, 60_000);

  it("keeps two suffixes of one house number apart", async () => {
    // 112 Marlin Hollow Dr and 112 Marlin Hollow Blvd are different streets.
    const dr = new Set(at("112 Marlin Hollow Dr").map((p) => p.id));
    const blvd = new Set(at("112 Marlin Hollow Blvd").map((p) => p.id));

    const saidDr = await resolveProperty({ rawStreet: "112 Marlin Hollow Dr" });
    for (const c of saidDr.candidates) expect(blvd.has(c.id)).toBe(false);

    const saidBlvd = await resolveProperty({ rawStreet: "112 Marlin Hollow Blvd" });
    for (const c of saidBlvd.candidates) expect(dr.has(c.id)).toBe(false);

    // With no suffix at all the resolver must refuse rather than pick one.
    const noSuffix = await resolveProperty({ rawStreet: "112 Marlin Hollow" });
    expect(noSuffix.decision).toBe("needs_more");
    expect(noSuffix.askFor).toBe("last_service_date");
    measured["'112 Marlin Hollow' (no suffix)"] =
      `${noSuffix.decision}, ${noSuffix.totalCandidates} candidates`;
  }, 60_000);

  it("returns not_found rather than the nearest thing for an address we do not have", async () => {
    for (const street of ["9999 Nowhere Street", "9999 Marlin Hollow Dr", "451 Old Mangrove Rd"]) {
      const r = await resolveProperty({ rawStreet: street });
      expect(r.decision).toBe("not_found");
      expect(r.candidates).toEqual([]);
      expect(r.confidence).toBe(0);
    }
  }, 60_000);
});

// --- spelling variants -----------------------------------------------------

describe("suffix and directional variants are one property", () => {
  it("gives the identical answer for every spelling of the same address", async () => {
    for (const [a, b] of SPELLING_VARIANTS) {
      const ra = await resolveProperty({ rawStreet: a });
      const rb = await resolveProperty({ rawStreet: b });
      expect(ra.query.street, `${a} vs ${b}`).toBe(rb.query.street);
      expect(rb.decision, `${a} vs ${b}`).toBe(ra.decision);
      expect(rb.candidates.map((c) => c.id).sort(), `${a} vs ${b}`).toEqual(
        ra.candidates.map((c) => c.id).sort(),
      );
      expect(ra.decision).not.toBe("not_found");
    }
  }, 180_000);

  it("resolves a suffix-and-direction variant to the one property it names", async () => {
    const r = await resolveProperty({ rawStreet: "25 Permit Terrace Court" });
    expect(r.decision).toBe("resolved");
    expect(r.candidates[0]!.id).toBe(at("25 Permit Terrace Ct")[0]!.id);
  }, 60_000);
});

// --- names -----------------------------------------------------------------

describe("a name is never enough", () => {
  it("returns needs_more for a bare last name and never a candidate", async () => {
    for (const lastName of ["Jennings", "Rowe", "Hospitality", "Cardenas"]) {
      const r = await resolveProperty({ lastName });
      expect(r.decision).toBe("needs_more");
      expect(r.candidates).toEqual([]);
      expect(r.confidence).toBe(0);
      expect(r.askFor).toBe("street_number");
    }
  }, 60_000);

  it("returns needs_more for a bare company name and never a candidate", async () => {
    for (const company of ["Lighthouse Hospitality", "Starfish Hospitality", "Whitecap"]) {
      const r = await resolveProperty({ company });
      expect(r.decision).toBe("needs_more");
      expect(r.candidates).toEqual([]);
    }
  }, 60_000);

  it("a name alongside an address changes nothing about the address", async () => {
    const target = at(CONDO)[2]!;
    const bare = await resolveProperty({ rawStreet: CONDO, unit: target.unit });
    const named = await resolveProperty({
      rawStreet: CONDO,
      unit: target.unit,
      lastName: "Nobody",
      company: "Nowhere Hospitality",
    });
    expect(named.decision).toBe(bare.decision);
    expect(named.candidates[0]!.id).toBe(bare.candidates[0]!.id);
  }, 60_000);

  it("a house number with no street name is needs_more, not a guess", async () => {
    const r = await resolveProperty({ streetNumber: 1363 });
    expect(r.decision).toBe("needs_more");
    expect(r.askFor).toBe("street_name");
    expect(r.candidates).toEqual([]);
  }, 60_000);

  it("a street with no house number asks for the number and reports the size", async () => {
    const r = await resolveProperty({ rawStreet: "Old Mangrove Rd" });
    expect(r.decision).toBe("needs_more");
    expect(r.askFor).toBe("street_number");
    expect(r.totalCandidates).toBeGreaterThan(20);
    measured["'Old Mangrove Rd' (no number)"] = `${r.totalCandidates} candidates`;
  }, 60_000);
});

// --- spoken forms ----------------------------------------------------------

describe("spoken-form robustness", () => {
  it("expands spoken house numbers", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["five fifty Cormorant Reef", "550 Cormorant Reef"],
      ["one three six three West Old Mangrove Road", "1363 West Old Mangrove Road"],
      ["Cormorant Reef five fifty", "550 Cormorant Reef"],
      ["five hundred fifty Cormorant Reef", "550 Cormorant Reef"],
      ["eleven sixty three Bayfront Hwy", "1163 Bayfront Hwy"],
      ["twelve twenty two Marlin Hollow", "1222 Marlin Hollow"],
    ];
    for (const [said, want] of cases) {
      expect(expandSpokenNumbers(said).text, said).toBe(want);
    }
    // A street with no spoken number is left exactly alone.
    for (const untouched of ["550 Cormorant Reef", "Cormorant Reef Blvd", ""]) {
      expect(expandSpokenNumbers(untouched)).toEqual({ text: untouched, expanded: false });
    }
  });

  it("handles a suffix-less street, mixed case and stray whitespace identically", async () => {
    const target = at("550 Cormorant Reef Blvd");
    const forms = [
      "550 Cormorant Reef",
      "  550   cormorant   REEF  ",
      "five fifty Cormorant Reef",
      "Cormorant Reef, five fifty",
    ];
    for (const said of forms) {
      const r = await resolveProperty({ rawStreet: said });
      expect(r.decision, said).toBe("needs_unit");
      expect(r.askFor).toBe("unit");
      expect(r.totalCandidates, said).toBe(target.length);
    }
    measured["'550 Cormorant Reef' candidates"] = target.length;

    // ...and with the unit, every one of them lands on the same single property.
    const unit = target.find((p) => p.unit !== null)!;
    for (const said of forms) {
      const r = await resolveProperty({ rawStreet: said, unit: unit.unit });
      expect(r.decision, said).toBe("resolved");
      expect(r.candidates[0]!.id, said).toBe(unit.id);
    }
  }, 180_000);

  it("accepts the unit spoken any of the ways it is said", async () => {
    const target = at(CONDO).find((p) => p.unit === "3116") ?? at(CONDO).find((p) => p.unit !== null)!;
    const forms: PropertyQuery[] = [
      { rawStreet: CONDO, unit: target.unit },
      { rawStreet: CONDO, unit: `Unit ${target.unit}` },
      { rawStreet: CONDO, unit: `#${target.unit}` },
      { rawStreet: `${CONDO} unit ${target.unit}` },
      { streetNumber: "1363", streetName: "West Old Mangrove Road", unit: target.unit },
    ];
    for (const f of forms) {
      const r = await resolveProperty(f);
      expect(r.decision, JSON.stringify(f)).toBe("resolved");
      expect(r.candidates[0]!.id, JSON.stringify(f)).toBe(target.id);
    }
  }, 120_000);

  it("normalizes an utterance into the same space the table was built in", () => {
    const q = normalizeQuery({ rawStreet: "  1363   West Old Mangrove ROAD, Unit #3116 " });
    expect(q.street).toBe("1363 w old mangrove rd");
    expect(q.houseNumber).toBe("1363");
    expect(q.unit).toBe("3116");
    expect(q.canonicalKey).toBe("1363 w old mangrove rd|3116|");
  });
});

// --- corpus sweep ----------------------------------------------------------

describe("corpus sweep", () => {
  /**
   * Feeds real properties their own address back and measures how often the
   * resolver returns that exact property.
   *
   * Three passes, because one number would be misleading on its own:
   *   A. verbatim street + unit — the floor. `(street_norm, unit)` is unique in
   *      this table, so anything below ~100% is a bug in this module.
   *   B. spoken degradation — suffix dropped, directional dropped half the
   *      time, upper-cased, whitespace mangled. This is the number that means
   *      something.
   *   C. no unit at all — the calibration check against the corpus itself.
   *      eda/04 measures 79.4% for "street # + street, no unit"; 79.6% of
   *      properties here stand alone on their street_norm, so pass C should
   *      land on that figure. Materially higher would mean the resolver is
   *      resolving things it cannot know.
   *
   * The assertion that actually matters in all three: a `resolved` answer is
   * NEVER a different property. Not once.
   */
  it("resolves real properties from their own address", async () => {
    const sample = allProperties.slice(0, 220);
    expect(sample.length).toBeGreaterThanOrEqual(200);

    let hitA = 0;
    let hitB = 0;
    let resolvedC = 0;
    let singletonC = 0;
    const misresolved: string[] = [];
    const streetGroups = new Map<string, number>();
    for (const p of allProperties) {
      streetGroups.set(p.street_norm, (streetGroups.get(p.street_norm) ?? 0) + 1);
    }

    await pooled(sample, 3, async (p) => {
      const a = await resolveProperty({ rawStreet: p.street_raw, unit: p.unit });
      if (a.decision === "resolved") {
        if (a.candidates[0]!.id === p.id) hitA += 1;
        else misresolved.push(`A ${p.street_raw} ${p.unit ?? "-"} -> ${a.candidates[0]!.streetRaw}`);
      }

      const said = spokenForm(p);
      const b = await resolveProperty({ rawStreet: said, unit: p.unit });
      if (b.decision === "resolved") {
        if (b.candidates[0]!.id === p.id) hitB += 1;
        else misresolved.push(`B "${said}" ${p.unit ?? "-"} -> ${b.candidates[0]!.streetRaw}`);
      }

      const c = await resolveProperty({ rawStreet: p.street_raw });
      const alone = (streetGroups.get(p.street_norm) ?? 1) === 1;
      if (alone) singletonC += 1;
      if (c.decision === "resolved") {
        resolvedC += 1;
        if (c.candidates[0]!.id !== p.id) {
          misresolved.push(`C ${p.street_raw} -> ${c.candidates[0]!.streetRaw}`);
        }
        // Resolving without a unit is only ever legitimate when the address
        // holds exactly one property.
        if (!alone) misresolved.push(`C ${p.street_raw} resolved despite sharing its address`);
      }
    });

    const pct = (n: number) => `${((n / sample.length) * 100).toFixed(1)}%`;
    measured["sweep sample size"] = sample.length;
    measured["sweep A (verbatim street + unit)"] = pct(hitA);
    measured["sweep B (spoken: no suffix, often no direction)"] = pct(hitB);
    measured["sweep C (street only, no unit)"] = `${pct(resolvedC)} resolved`;
    measured["sweep C corpus ceiling (alone on their street)"] = pct(singletonC);
    measured["sweep wrong-property resolutions"] = misresolved.length;

    // The gate. A wrong record is the one failure this system may not have.
    expect(misresolved).toEqual([]);
    // Verbatim feedback must be near-total: the pair is unique by construction.
    expect(hitA / sample.length).toBeGreaterThanOrEqual(0.99);
    // Spoken degradation loses only genuinely ambiguous addresses.
    expect(hitB / sample.length).toBeGreaterThanOrEqual(0.95);
    // Without a unit the resolver may never claim more than the corpus allows.
    expect(resolvedC).toBeLessThanOrEqual(singletonC);
  }, 600_000);
});

/**
 * What the address sounds like when a person says it: no street suffix, the
 * directional dropped for half of them, upper case, whitespace mangled.
 * Deterministic in the property id so a failure is reproducible.
 */
function spokenForm(p: PropRow): string {
  const tokens = p.street_norm.split(" ");
  let hash = 0;
  for (const ch of p.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const dropDirection = hash % 2 === 0;
  const SUFFIX = /^(st|rd|dr|ln|blvd|ct|cir|way|ave|pkwy|hwy|pl|ter|cv|trl|sq|aly|expy|trce|pt|loop|run|walk|path|row|bnd)$/;
  const DIRECTION = /^(n|s|e|w|ne|nw|se|sw)$/;
  const kept = tokens.filter(
    (t, i) => i === 0 || (!SUFFIX.test(t) && !(dropDirection && DIRECTION.test(t))),
  );
  return `  ${kept.join("   ").toUpperCase()} `;
}
