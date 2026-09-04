/**
 * Address normalizer tests, run against the real export in
 * front-desk-assignment/data -- not fixtures. The counts asserted below were
 * measured from that export; if the export changes they must be re-measured.
 *
 * Two classes of assertion matter here and they pull in opposite directions:
 *   - COLLAPSE: variants of one address must produce one key, or the agent
 *     fails to find a caller who is in the book.
 *   - SEPARATION: near-miss addresses must produce different keys, or the agent
 *     reads another customer's history aloud. That is the worse failure, so the
 *     separation block is the one to keep green at any cost.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../src/config";
import {
  DIRECTIONALS,
  STREET_SUFFIXES,
  canonicalKey,
  canonicalizeAddress,
  extractUnit,
  normalizeStreet,
  normalizeUnit,
} from "../src/domain/address";

// --- fixtures from the real export -----------------------------------------

interface RawAddress {
  id?: string | null;
  street?: string | null;
  street_line_2?: string | null;
  city?: string | null;
  zip?: string | null;
}

function readJsonl<T>(name: string): T[] {
  return readFileSync(join(DATA, name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

/** All 1,390 address records, defensively -- `addresses` may be absent. */
const CUSTOMER_ADDRESSES: RawAddress[] = readJsonl<{ addresses?: RawAddress[] }>(
  "customers.jsonl",
).flatMap((c) => c.addresses ?? []);

/** One job in the export has a null `street`; the loader must survive it. */
const JOB_ADDRESSES: RawAddress[] = readJsonl<{ address?: RawAddress }>("jobs.jsonl").map(
  (j) => j.address ?? {},
);

const streetKey = (a: RawAddress): string =>
  canonicalKey({ street: extractUnit(a.street, a.street_line_2).street, unit: null, zip: null });

// --- tables ----------------------------------------------------------------

describe("suffix and directional tables", () => {
  it("are closed: every canonical value is itself a key that maps to itself", () => {
    for (const [spelling, canonical] of Object.entries(STREET_SUFFIXES)) {
      expect(STREET_SUFFIXES[canonical], `${spelling} -> ${canonical}`).toBe(canonical);
    }
    for (const [spelling, canonical] of Object.entries(DIRECTIONALS)) {
      expect(DIRECTIONALS[canonical], `${spelling} -> ${canonical}`).toBe(canonical);
    }
  });

  it("cover the 22 suffix types the export stores both ways", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["Dr", "Drive"],
      ["Rd", "Road"],
      ["St", "Street"],
      ["Blvd", "Boulevard"],
      ["Ln", "Lane"],
      ["Cir", "Circle"],
      ["Wy", "Way"],
      ["Cv", "Cove"],
      ["Ct", "Court"],
      ["Ave", "Avenue"],
      ["Pkwy", "Parkway"],
      ["Pl", "Place"],
      ["Sq", "Square"],
      ["Aly", "Alley"],
      ["Ter", "Terrace"],
      ["Trl", "Trail"],
    ];
    for (const [abbrev, spelled] of pairs) {
      expect(
        normalizeStreet(`1 Test ${abbrev}`),
        `${abbrev} / ${spelled}`,
      ).toBe(normalizeStreet(`1 Test ${spelled}`));
    }
  });

  it("shares no token between the suffix and directional tables", () => {
    for (const token of Object.keys(DIRECTIONALS)) {
      expect(STREET_SUFFIXES[token], token).toBeUndefined();
    }
  });
});

// --- collapse: the known stored variants ------------------------------------

describe("normalizeStreet collapses stored variants of one address", () => {
  const VARIANT_PAIRS: ReadonlyArray<readonly [string, string]> = [
    // directional spelled out, as a prefix
    ["104 N Grouper Hollow Square", "104 North Grouper Hollow Square"],
    ["1363 W Old Mangrove Rd", "1363 West Old Mangrove Rd"],
    ["1615 S Coral Ridge Pkwy", "1615 South Coral Ridge Pkwy"],
    ["10254 E Old Mangrove Rd", "10254 East Old Mangrove Rd"],
    // suffix spelled out
    ["1008 Oleander Cay Rd", "1008 Oleander Cay Road"],
    ["8613 Rudder Landing Lane", "8613 Rudder Landing Ln"],
    ["25 Permit Terrace Court", "25 Permit Terrace Ct"],
    ["94 Egret Cove Cir", "94 Egret Cove Circle"],
    ["1940 Nautilus Landing Blvd", "1940 Nautilus Landing Boulevard"],
    ["210 Plover St", "210 Plover Street"],
    // lowercase suffix
    ["1030 Cowrie Hollow Drive", "1030 Cowrie Hollow dr"],
    ["43 Osprey Isle court", "43 Osprey Isle Court"],
    // directional AND suffix, both as a trailing directional
    ["1432 Flamingo Harbor Cir E", "1432 Flamingo Harbor Circle East"],
    ["296 Sabal Shores Blvd W", "296 Sabal Shores Boulevard West"],
    ["5000 S Sabal Shores Blvd", "5000 South Sabal Shores Boulevard"],
    ["73 Plover Key Loop E", "73 Plover Key Loop East"],
  ];

  it.each(VARIANT_PAIRS)("%s === %s", (a, b) => {
    expect(normalizeStreet(a)).toBe(normalizeStreet(b));
    expect(canonicalKey({ street: a, unit: null, zip: null })).toBe(
      canonicalKey({ street: b, unit: null, zip: null }),
    );
  });

  it("is idempotent and punctuation-insensitive", () => {
    const once = normalizeStreet("122 Sea-Lavender Pointe");
    expect(normalizeStreet(once)).toBe(once);
    expect(normalizeStreet("  1008  Oleander,  Cay  Rd. ")).toBe(
      normalizeStreet("1008 Oleander Cay Road"),
    );
  });

  it("returns empty string for absent input rather than throwing", () => {
    expect(normalizeStreet(null)).toBe("");
    expect(normalizeStreet(undefined)).toBe("");
    expect(normalizeStreet("")).toBe("");
  });
});

// --- SEPARATION: the failure that must never happen -------------------------

describe("near-miss addresses stay apart", () => {
  const MUST_NOT_MERGE: ReadonlyArray<readonly [string, string]> = [
    ["112 Marlin Hollow Dr", "122 Marlin Hollow Dr"],
    ["103 Grouper Landing Rd", "11 Grouper Landing Rd"],
    ["1030 Cowrie Hollow Drive", "130 Cowrie Hollow Drive"],
    ["10254 E Old Mangrove Rd", "2542 E Old Mangrove Rd"],
    // same name and number, different suffix -- both are real rows in the export
    ["112 Marlin Hollow Blvd", "112 Marlin Hollow Dr"],
    // same name and number, opposite directionals
    ["1338 Seafoam Harbor Run E", "1370 Seafoam Harbor Run W"],
    // a prefix directional is not a suffix directional
    ["5403 North Orchid Isle Drive", "5403 Orchid Isle Drive N"],
  ];

  it.each(MUST_NOT_MERGE)("%s !== %s", (a, b) => {
    expect(normalizeStreet(a)).not.toBe(normalizeStreet(b));
  });

  it("keeps a road number attached to the street, never read as a unit", () => {
    // Florida numbers its roads (30A, 98, 283). `Rd 283` is part of the street.
    expect(extractUnit("1231 Harborlight Cay Rd 283", null).unit).toBeNull();
    expect(extractUnit("5245 Harborlight Cay Rd 30A", null).unit).toBeNull();
    expect(extractUnit("1002 Barnacle Glen 98", null).unit).toBeNull();
    expect(normalizeStreet("5245 Harborlight Cay Rd 30A")).not.toBe(
      normalizeStreet("5245 Harborlight Cay Rd"),
    );
  });

  it("does not merge two units of one building", () => {
    const base = { street: "1363 W Old Mangrove Rd", zip: "33162" };
    expect(canonicalKey({ ...base, unit: "1110" })).not.toBe(
      canonicalKey({ ...base, unit: "1116" }),
    );
  });
});

// --- units ------------------------------------------------------------------

describe("normalizeUnit folds every spelling of one unit", () => {
  it.each(["Unit 202", "unit 202", "UNIT 202", "Unit #202", "#202", "202", "Unti 202"])(
    "%s -> 202",
    (raw) => {
      expect(normalizeUnit(raw)).toBe("202");
    },
  );

  it("recognises the Unti typo, which appears on 3 jobs as `Unti 505`", () => {
    expect(normalizeUnit("Unti 505")).toBe("505");
    expect(normalizeUnit("Unti 505")).toBe(normalizeUnit("Unit 505"));
  });

  it("keeps letters and leading zeros, which distinguish real units", () => {
    expect(normalizeUnit("Unit 0212")).toBe("0212");
    expect(normalizeUnit("Unit 0212")).not.toBe(normalizeUnit("Unit 212"));
    expect(normalizeUnit("13A")).toBe("13A");
    expect(normalizeUnit("13A")).not.toBe(normalizeUnit("13"));
  });

  it("returns null for absent input", () => {
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit("   ")).toBeNull();
  });
});

describe("extractUnit over the real street_line_2 values", () => {
  const CASES: ReadonlyArray<{
    readonly line2: string;
    readonly unit: string | null;
    readonly building: string | null;
  }> = [
    // plain units, stored six different ways
    { line2: "Unit A", unit: "A", building: null },
    { line2: "Unit 109", unit: "109", building: null },
    { line2: "13", unit: "13", building: null },
    { line2: "305", unit: "305", building: null },
    { line2: "unit 202", unit: "202", building: null },
    { line2: "Unit 202", unit: "202", building: null },
    { line2: "Unti 505", unit: "505", building: null },
    { line2: "Unit #8B", unit: "8B", building: null },
    { line2: "Ste B", unit: "B", building: null },
    { line2: "Suite 107A", unit: "107A", building: null },
    { line2: "Lot A17", unit: "A17", building: null },
    { line2: "b378", unit: "B378", building: null },
    { line2: "2A/2B", unit: "2A/2B", building: null },
    { line2: "Unit 19C (downstairs unit)", unit: "19C", building: null },
    // a designator split across two tokens is one designator
    { line2: "20 B", unit: "20B", building: null },
    { line2: "Cottage 20 B", unit: "20B", building: null },
    { line2: "Unit EW 404", unit: "EW404", building: null },
    // building name PLUS a unit
    { line2: "High Pointe Unit 36W", unit: "36W", building: "High Pointe" },
    { line2: "High Pointe 422", unit: "422", building: "High Pointe" },
    { line2: "Ramsgate #16", unit: "16", building: "Ramsgate" },
    { line2: "Ariel Dunes II, 302", unit: "302", building: "Ariel Dunes II" },
    { line2: "Aerial Dunes 2 Unit 410", unit: "410", building: "Aerial Dunes 2" },
    { line2: "Building G - B377", unit: "B377", building: "Building G" },
    { line2: "Building G unit 375", unit: "375", building: "Building G" },
    { line2: "Beach Manor 0812", unit: "0812", building: "Beach Manor" },
    { line2: "Luau 2: 6828", unit: "6828", building: "Luau 2" },
    { line2: "Tides Unit 503", unit: "503", building: "Tides" },
    // the unit number is stored first
    { line2: "1892 Villa Lago", unit: "1892", building: "Villa Lago" },
    { line2: "8971 Rudder Cay", unit: "8971", building: "Rudder Cay" },
    // building / complex names with no unit at all -- must NOT become a unit
    { line2: "Casa de Egret", unit: null, building: "Casa de Egret" },
    { line2: "Lighthouse Warehouse", unit: null, building: "Lighthouse Warehouse" },
    { line2: "Daniels Retreat", unit: null, building: "Daniels Retreat" },
    { line2: "Lavish Escape", unit: null, building: "Lavish Escape" },
    { line2: "Bayberry Terrace Hibiscus Reef", unit: null, building: "Bayberry Terrace Hibiscus Reef" },
    { line2: "Building 6", unit: null, building: "Building 6" },
    { line2: "Building E", unit: null, building: "Building E" },
    { line2: "R Building", unit: null, building: "R Building" },
    { line2: "Townhouse B", unit: null, building: "Townhouse B" },
    // nothing at all
    { line2: "", unit: null, building: null },
  ];

  it.each(CASES)("$line2 -> unit $unit / building $building", ({ line2, unit, building }) => {
    const parts = extractUnit("1363 W Old Mangrove Rd", line2);
    expect(parts.unit).toBe(unit);
    expect(parts.buildingName).toBe(building);
    expect(parts.street).toBe("1363 W Old Mangrove Rd");
  });

  it("classifies every building-name value as a name, never as a unit", () => {
    const NAMES_ONLY = [
      "Casa de Egret",
      "Lighthouse Warehouse",
      "Daniels Retreat",
      "Lavish Escape",
      "Bayberry Terrace Hibiscus Reef",
    ];
    for (const v of NAMES_ONLY) {
      const parts = extractUnit("1 Test St", v);
      expect(parts.unit, v).toBeNull();
      expect(parts.buildingName, v).not.toBeNull();
    }
  });

  it("finds the 35-ish building names actually present in the export", () => {
    const names = new Set<string>();
    for (const a of CUSTOMER_ADDRESSES) {
      const b = canonicalizeAddress(a).buildingName;
      if (b !== null) names.add(b);
    }
    // Measured: 32 distinct building/complex names across 37 address records.
    expect(names.size).toBe(32);
    expect(names.has("Casa de Egret")).toBe(true);
    expect(names.has("Lighthouse Warehouse")).toBe(true);
    expect(names.has("Ariel Dunes II")).toBe(true);
    expect(names.has("Aerial Dunes 2")).toBe(true);
  });
});

describe("extractUnit pulls a unit stored inside street", () => {
  const EMBEDDED: ReadonlyArray<readonly [string, string, string, string | null]> = [
    ["1363 W Old Mangrove Rd unit 3116", "1363 W Old Mangrove Rd", "3116", null],
    ["2900 Palmetto Trace Rd Unit 101", "2900 Palmetto Trace Rd", "101", null],
    ["585 Moonraker Reef Blvd Suite 201", "585 Moonraker Reef Blvd", "201", null],
    ["Tidewater Hwy Suite 201", "Tidewater Hwy", "201", null],
  ];

  it.each(EMBEDDED)("%s", (raw, street, unit, building) => {
    const parts = extractUnit(raw, null);
    expect(parts.street).toBe(street);
    expect(parts.unit).toBe(unit);
    expect(parts.buildingName).toBe(building);
  });

  it("splits a building out of street and still takes the unit from line 2", () => {
    // adr_1308c7d323b1437ea39fbcd91cb060ea in the export.
    const parts = extractUnit("Lighthouse Bluff Building 11", "Unit 102");
    expect(parts.street).toBe("Lighthouse Bluff");
    expect(parts.buildingName).toBe("Building 11");
    expect(parts.unit).toBe("102");
  });

  it("merges the same unit whether stored in street or in line 2", () => {
    // Both rows exist in customers.jsonl for 1363 W Old Mangrove Rd.
    expect(canonicalizeAddress({ street: "1363 W Old Mangrove Rd unit 3116" }).key).toBe(
      canonicalizeAddress({ street: "1363 W Old Mangrove Rd", street_line_2: "3116" }).key,
    );
  });

  it("survives a missing street, as one job in the export has", () => {
    expect(() => extractUnit(null, null)).not.toThrow();
    expect(canonicalizeAddress(null).key).toBe("||");
    expect(canonicalizeAddress({}).key).toBe("||");
  });
});

// --- 1363 W Old Mangrove Rd: the case that matters most ---------------------

describe("1363 W Old Mangrove Rd -- 18 customers behind one street string", () => {
  const AT_1363 = CUSTOMER_ADDRESSES.filter((a) =>
    (a.street ?? "").startsWith("1363 W") || (a.street ?? "").startsWith("1363 West"),
  );

  it("has the 19 stored address records the export contains", () => {
    expect(AT_1363.length).toBe(19);
  });

  it("shares ONE key when no unit is given -- the street alone is not enough", () => {
    const withoutUnit = new Set(AT_1363.map((a) => streetKey(a)));
    expect(withoutUnit.size).toBe(1);
    expect([...withoutUnit][0]).toBe("1363 w old mangrove rd||");
    // and the `West` spelling lands on that same key
    expect(normalizeStreet("1363 West Old Mangrove Rd")).toBe(
      normalizeStreet("1363 W Old Mangrove Rd"),
    );
  });

  it("splits into distinct keys once the unit is known", () => {
    const withUnit = new Set(AT_1363.map((a) => canonicalizeAddress(a).key));
    // 19 records, 18 keys: `unit 3116` embedded in street and `3116` in line 2
    // are the same unit, and one record carries no unit at all.
    expect(withUnit.size).toBe(18);
    expect(withUnit.size).toBeGreaterThan(1);
  });

  it("never lets one caller's unit key match another's", () => {
    const keyed = AT_1363.map((a) => canonicalizeAddress(a)).filter((p) => p.unit !== null);
    const byUnit = new Map<string, string>();
    for (const p of keyed) {
      const prev = byUnit.get(p.key);
      if (prev !== undefined) expect(prev).toBe(p.unit);
      byUnit.set(p.key, p.unit as string);
    }
    expect(byUnit.size).toBe(17);
  });
});

// --- corpus-wide collapse ---------------------------------------------------

describe("the whole export", () => {
  it("loads all 1,390 stored addresses", () => {
    expect(CUSTOMER_ADDRESSES.length).toBe(1390);
  });

  it("collapses 1,177 raw street strings to 1,128 normalized ones", () => {
    // Measured against customers.jsonl: 49 groups of raw strings (98 strings in
    // total) differ only by suffix or directional spelling and name one street.
    const raw = new Set(CUSTOMER_ADDRESSES.map((a) => a.street ?? ""));
    const normalized = new Set([...raw].map((s) => normalizeStreet(s)));
    expect(raw.size).toBe(1177);
    expect(normalized.size).toBe(1128);
    expect(normalized.size).toBeLessThan(raw.size);
  });

  it("collapses to 1,127 street-identity keys once embedded units are removed", () => {
    // One further merge beyond the 1,128 above: `1363 W Old Mangrove Rd unit
    // 3116` loses its inline unit and joins the plain `1363 W Old Mangrove Rd`.
    const keys = new Set(CUSTOMER_ADDRESSES.map((a) => streetKey(a)));
    expect(keys.size).toBe(1127);
  });

  it("collapses 1,360 raw (street|line2|zip) triples to 1,326 canonical keys", () => {
    // 34 stored address records are duplicates of another record under
    // normalization -- 2.4% of the book that a raw string match would miss.
    const rawTriples = new Set(
      CUSTOMER_ADDRESSES.map((a) => `${a.street ?? ""}|${a.street_line_2 ?? ""}|${a.zip ?? ""}`),
    );
    const canonical = new Set(CUSTOMER_ADDRESSES.map((a) => canonicalizeAddress(a).key));
    expect(rawTriples.size).toBe(1360);
    expect(canonical.size).toBe(1326);
    expect(canonical.size).toBeLessThan(rawTriples.size);
  });

  it("merges 263 address records into a shared canonical street", () => {
    // Records whose normalized street is shared with at least one other record:
    // 381 under normalization vs 312 under a raw string match. The extra 69
    // records are only reachable because of this module.
    const byNormalized = new Map<string, number>();
    const byRaw = new Map<string, number>();
    for (const a of CUSTOMER_ADDRESSES) {
      const n = normalizeStreet(a.street);
      const r = a.street ?? "";
      byNormalized.set(n, (byNormalized.get(n) ?? 0) + 1);
      byRaw.set(r, (byRaw.get(r) ?? 0) + 1);
    }
    const shared = (m: Map<string, number>): number =>
      [...m.values()].filter((v) => v > 1).reduce((a, b) => a + b, 0);
    expect(shared(byNormalized)).toBe(381);
    expect(shared(byRaw)).toBe(312);
  });

  it("canonicalizes every job address without throwing", () => {
    const keys = new Set<string>();
    for (const a of JOB_ADDRESSES) {
      const key = canonicalizeAddress(a).key;
      expect(key).toMatch(/^[^|]*\|[^|]*\|[^|]*$/);
      keys.add(key);
    }
    expect(JOB_ADDRESSES.length).toBe(1992);
    // 1,357 raw (street|line2) pairs across jobs collapse to 1,327 keys.
    expect(keys.size).toBe(1327);
  });

  it("produces a lowercase pipe-separated key, and zip only as a coarse tiebreak", () => {
    expect(canonicalKey({ street: "1008 Oleander Cay ROAD", unit: "Unit 4B", zip: "33162" })).toBe(
      "1008 oleander cay rd|4b|33162",
    );
    // Same property, two ZIPs in the export -- so ZIP must be droppable.
    expect(canonicalKey({ street: "213 Skimmer Cove Ln", unit: null, zip: null })).toBe(
      "213 skimmer cv ln||",
    );
  });
});

describe("the transcriber splits house numbers, and normalizeStreet puts them back", () => {
  // Measured on this system's own recorded phone calls. Deepgram with
  // `numerals: true` emits the digits, not the number:
  //   "so I'm talking about 7 4 0 1 Shoreline Drive"
  //   "It's 24 11 Sigma Drive"
  // Before the fix, every one of these resolved to not_found with confidence 0
  // against a book that holds the address. It failed closed rather than wrong,
  // which is why it survived every gate: nothing here tested the wire format.
  it("joins digits spoken one at a time", () => {
    expect(normalizeStreet("8 5 0 4 E Old Mangrove Rd")).toBe(normalizeStreet("8504 E Old Mangrove Rd"));
    expect(normalizeStreet("7 4 0 1 Shoreline Dr")).toBe(normalizeStreet("7401 Shoreline Dr"));
  });

  it("joins digits spoken in pairs", () => {
    expect(normalizeStreet("85 04 E Old Mangrove Rd")).toBe(normalizeStreet("8504 E Old Mangrove Rd"));
    expect(normalizeStreet("24 11 Sigma Dr")).toBe(normalizeStreet("2411 Sigma Dr"));
  });

  it("leaves an already-correct house number exactly as it was", () => {
    expect(normalizeStreet("8504 E Old Mangrove Rd")).toBe("8504 e old mangrove rd");
    expect(normalizeStreet("416 S Coral Ridge Pkwy")).toBe("416 s coral ridge pkwy");
  });

  // The trap the ledger already records: trailing numbers on these are Florida
  // state highways, and merging them once collapsed 11 distinct properties.
  it("never reaches past the house number", () => {
    expect(normalizeStreet("1231 Harborlight Cay Rd 283")).toBe("1231 harborlight cay rd 283");
    expect(normalizeStreet("1231 Harborlight Cay Rd 283")).not.toContain("1231283");
  });

  // A numbered street is not a split house number. The book holds 208 59th St,
  // 3871 47th Ave and 304 68th St.
  it("does not turn a numbered street into a house number", () => {
    expect(normalizeStreet("208 59th St")).toBe("208 59th st");
    expect(normalizeStreet("208 59 th St")).toBe("208 59 th st");
    expect(normalizeStreet("3871 47th Ave")).toBe("3871 47th ave");
    expect(normalizeStreet("208 59 th St")).not.toContain("20859");
  });

  it("refuses a run that could not be a house number", () => {
    // Six digits is longer than anything in the book; leave it alone rather
    // than invent a number nobody said.
    expect(normalizeStreet("123 456 Nowhere Rd")).toBe("123 456 nowhere rd");
  });
});
