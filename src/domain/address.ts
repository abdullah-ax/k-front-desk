/**
 * Address identity for the Front Desk voice agent.
 *
 * The address is the primary key of this system: in the source export, street +
 * unit identifies the right property record 95.3% of the time, a caller's last
 * name only 7.9%, and a company name 0.0%. Everything the agent reads aloud
 * hangs off resolving one spoken address to one stored record, so a *false
 * merge* here (two different properties collapsing to one key) is the worst
 * failure this system can produce. Every rule below is deliberately conservative
 * about that.
 *
 * The noise in the export is not typing noise -- casing and whitespace are clean.
 * It is *abbreviation* noise: 22 street-suffix types appear in both abbreviated
 * and spelled-out form (Dr/Drive 247/77, Rd/Road 184/18, Blvd/Boulevard 103/31,
 * ...), directionals appear as both N/North and as prefix or suffix, and units
 * live in three places (street_line_2, embedded in street, or nowhere).
 *
 * Deliberately NOT used:
 *   - latitude/longitude: 87.6% of coordinates plot in the Atlantic Ocean.
 *   - city: ZIP 33162 is shared by 6 different cities.
 *   - zip as anything but a coarse tiebreak: `213 Skimmer Cove Ln, Cutler Bay`
 *     is stored under two different ZIPs, so ZIP cannot confirm identity.
 *
 * Constants (the suffix / directional / keyword tables) are hoisted to module
 * top so adding a new pair is a one-line table edit, never a code change --
 * mirroring the loader convention in eda/scripts/dq_common.py and
 * eda/scripts/sched_load_jobs.py. Pure functions only; no I/O, no database.
 */

// --- tables ----------------------------------------------------------------

/**
 * Street-suffix canonicalization. Key = any spelling seen in the wild (lower
 * case), value = the single canonical form. Both spellings of a pair MUST map
 * to the same value; identity entries (`dr -> dr`) are kept so the table doubles
 * as the list of tokens we consider suffix-like.
 *
 * Every pair below was verified present in front-desk-assignment/data. Adding a
 * new pair is one line here.
 *
 * NOT in this table, on purpose -- these read as suffixes but are used as street
 * *name* elements in this export, and mapping them could merge distinct streets:
 * cay, glen, harbor, hollow, isle, key, landing, reef, ridge, shores, bluff.
 */
export const STREET_SUFFIXES: Readonly<Record<string, string>> = Object.freeze({
  street: "st",
  st: "st",
  road: "rd",
  rd: "rd",
  drive: "dr",
  dr: "dr",
  lane: "ln",
  ln: "ln",
  boulevard: "blvd",
  blvd: "blvd",
  court: "ct",
  ct: "ct",
  circle: "cir",
  cir: "cir",
  way: "way",
  wy: "way",
  avenue: "ave",
  ave: "ave",
  av: "ave",
  parkway: "pkwy",
  pkwy: "pkwy",
  highway: "hwy",
  hwy: "hwy",
  place: "pl",
  pl: "pl",
  terrace: "ter",
  terr: "ter",
  ter: "ter",
  cove: "cv",
  cv: "cv",
  trail: "trl",
  trl: "trl",
  square: "sq",
  sq: "sq",
  alley: "aly",
  aly: "aly",
  expressway: "expy",
  expy: "expy",
  trace: "trce",
  trce: "trce",
  pointe: "pt",
  point: "pt",
  pt: "pt",
  loop: "loop",
  run: "run",
  walk: "walk",
  path: "path",
  row: "row",
  bend: "bnd",
  bnd: "bnd",
});

/**
 * Directional canonicalization. Applied at every token position because
 * directionals appear as a prefix (`104 N Grouper Hollow Square`) and as a
 * suffix (`1432 Flamingo Harbor Cir E`). Position is preserved -- `5403 North
 * Orchid Isle Dr` and `5403 Orchid Isle Dr N` stay distinct, because in the real
 * world an east and a west segment of one street are different places.
 */
export const DIRECTIONALS: Readonly<Record<string, string>> = Object.freeze({
  north: "n",
  n: "n",
  south: "s",
  s: "s",
  east: "e",
  e: "e",
  west: "w",
  w: "w",
  northeast: "ne",
  ne: "ne",
  northwest: "nw",
  nw: "nw",
  southeast: "se",
  se: "se",
  southwest: "sw",
  sw: "sw",
});

/**
 * Tokens that introduce a unit designator. `unti` is a real typo in the export
 * (`Unti 505`, 3 jobs) and is treated as `unit`.
 */
export const UNIT_KEYWORDS: readonly string[] = Object.freeze([
  "unit",
  "unti",
  "apt",
  "apartment",
  "suite",
  "ste",
  "lot",
  "room",
  "rm",
  "cottage",
  "no",
]);

/** Tokens that introduce a *building* designator, which is not a unit. */
export const BUILDING_KEYWORDS: readonly string[] = Object.freeze([
  "building",
  "bldg",
  "tower",
]);

/*
 * Road numbers are NOT units. A street string ending in a bare number is a road
 * number, not a unit:
 * `1231 Harborlight Cay Rd 283`, `5245 Harborlight Cay Rd 30A`,
 * `1002 Barnacle Glen 98`, `4209 Firebush Pointe 2`. Florida numbers a lot of
 * its roads (30A, 98, 283, 331). Stripping these as units would merge distinct
 * properties, so a bare trailing number is NEVER treated as an embedded unit --
 * only an explicit keyword is.
 */
// --- street ----------------------------------------------------------------

const NON_ALNUM = /[^a-z0-9]+/g;

/**
 * Canonical street text: lowercase, punctuation stripped, whitespace collapsed,
 * suffixes and directionals folded to one form each.
 *
 * `104 N Grouper Hollow Square` and `104 North Grouper Hollow Square`
 * -> `104 n grouper hollow sq`.
 *
 * Hyphens become spaces (`Sea-Lavender` -> `sea lavender`), which is safe
 * because it is applied to both sides of any comparison.
 */
export function normalizeStreet(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  const tokens = raw.toLowerCase().replace(NON_ALNUM, " ").trim().split(/\s+/);
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "")) return "";
  return joinSpokenHouseNumber(tokens).map(canonicalizeToken).join(" ");
}

/**
 * Puts a house number back together after the transcriber has taken it apart.
 *
 * Deepgram with `numerals: true` does not emit a house number, it emits the
 * digits. Measured on this system's own recorded phone calls:
 *
 *   "so I'm talking about 7 4 0 1 Shoreline Drive"      house number 7401
 *   "It's 24 11 Sigma Drive"                            house number 2411
 *   "Unit 1 0 1"                                        unit 101
 *
 * Before this, every one of those resolved to `not_found` with confidence 0 —
 * verified against real rows: `8 5 0 4 E Old Mangrove Rd` and
 * `85 04 E Old Mangrove Rd` both missed a property that `8504 E Old Mangrove Rd`
 * matches at 0.96. The 98.2% figure recorded for "spoken form" was measured on
 * spoken forms written out as text, never on what the transcriber actually puts
 * on the wire, so the gap sat in the one place nothing was looking.
 *
 * It failed CLOSED, which is the one mercy here: a split house number found
 * nothing rather than finding the wrong property. The house-number-must-match-
 * exactly rule held. It still meant a caller who correctly stated their address
 * was told we had no record of it.
 *
 * ONLY THE LEADING RUN, AND ONLY UP TO FIVE DIGITS. `1231 Harborlight Cay Rd 283`
 * is a real address whose trailing 283 is a Florida state highway, and the
 * ledger already records that merging trailing numbers collapsed 11 distinct
 * properties. So this stops at the first non-digit token and never looks past
 * the house-number position. Five digits is the longest house number in the
 * book; a longer run is left alone rather than mangled into something new.
 */
function joinSpokenHouseNumber(tokens: string[]): string[] {
  if (tokens.length < 2 || !/^\d+$/.test(tokens[0]!)) return tokens;

  let joined = tokens[0]!;
  let taken = 1;
  while (taken < tokens.length && /^\d+$/.test(tokens[taken]!)) {
    if (joined.length + tokens[taken]!.length > 5) break;
    joined += tokens[taken]!;
    taken += 1;
  }
  // Nothing was split; leave the tokens exactly as they came.
  if (taken === 1) return tokens;

  // A NUMBERED STREET IS NOT A SPLIT HOUSE NUMBER. The book holds `208 59th St`,
  // `3871 47th Ave` and `304 68th St`. Written out, the ordinal survives as one
  // token (`59th`) and never reaches the loop above — but a transcriber that
  // splits it into `59 th` would otherwise turn `208 59 th st` into house
  // number 20859. So if the token straight after the run is a bare ordinal
  // suffix, the digits belonged to a street name, not to the house.
  if (taken < tokens.length && /^(?:st|nd|rd|th)$/.test(tokens[taken]!)) return tokens;

  return [joined, ...tokens.slice(taken)];
}

/** One token through the directional table, then the suffix table, else as-is. */
function canonicalizeToken(token: string): string {
  return DIRECTIONALS[token] ?? STREET_SUFFIXES[token] ?? token;
}

// --- units -----------------------------------------------------------------

/** A unit designator: has a digit, or is a 1-2 character tag like `A` or `2C`. */
function isDesignator(token: string): boolean {
  if (token === "") return false;
  if (/\d/.test(token)) return true;
  return token.length <= 2 && /^[a-z]+$/i.test(token);
}

function isUnitKeyword(token: string): boolean {
  return UNIT_KEYWORDS.includes(token.toLowerCase().replace(/[^a-z]/g, ""));
}

function isBuildingKeyword(token: string): boolean {
  return BUILDING_KEYWORDS.includes(token.toLowerCase().replace(/[^a-z]/g, ""));
}

const LEADING_UNIT_KEYWORD = new RegExp(
  `^(?:#|no\\.?|(?:${UNIT_KEYWORDS.join("|")})\\b)\\s*`,
  "i",
);

/**
 * Fold every spelling of one unit onto one token.
 * `Unit 202`, `unit 202`, `Unit #202`, `#202`, `202`, `Unti 202` -> `202`.
 * Returns uppercase for readability; canonicalKey lowercases it again.
 */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/\([^)]*\)/g, " ");
  // Strip repeated leading keywords: "Unit #8B" -> "8B".
  for (let i = 0; i < 4 && LEADING_UNIT_KEYWORD.test(s); i += 1) {
    s = s.replace(LEADING_UNIT_KEYWORD, "");
  }
  s = s.replace(/[^A-Za-z0-9/-]+/g, "");
  return s === "" ? null : s.toUpperCase();
}

export interface UnitParts {
  /** The street with any embedded unit / building removed. */
  street: string;
  /** Canonical unit designator, or null when the record names no unit. */
  unit: string | null;
  /** Free-text building or complex name, when street_line_2 held one. */
  buildingName: string | null;
}

/** Only an explicit keyword pulls a unit out of `street` -- see the road-number note. */
const EMBEDDED_BUILDING = /\s+((?:building|bldg|tower)\s+[A-Za-z0-9-]+)\s*$/i;
const EMBEDDED_UNIT = new RegExp(
  `\\s+(?:#\\s*|(?:${UNIT_KEYWORDS.join("|")})\\s*#?\\s*)([A-Za-z0-9][A-Za-z0-9/-]*)\\s*$`,
  "i",
);

/**
 * Split a stored address into street / unit / building name.
 *
 * `street` may carry the unit inline (5 address records in the export do, e.g.
 * `1363 W Old Mangrove Rd unit 3116`, whose twin is stored as
 * `1363 W Old Mangrove Rd` + street_line_2 `3116`). `streetLine2` is free text,
 * not a unit number: of its 376 distinct values, 35 are building or complex
 * names (`Casa de Egret`, `Lighthouse Warehouse`, `Daniels Retreat`) and one is
 * a person's name.
 */
export function extractUnit(
  street: string | null | undefined,
  streetLine2: string | null | undefined,
): UnitParts {
  let rest = typeof street === "string" ? street.trim() : "";
  let unit: string | null = null;
  let buildingName: string | null = null;

  const bldg = rest.match(EMBEDDED_BUILDING);
  if (bldg?.[1]) {
    buildingName = squash(bldg[1]);
    rest = rest.slice(0, bldg.index).trim();
  }
  const emb = rest.match(EMBEDDED_UNIT);
  if (emb?.[1]) {
    unit = normalizeUnit(emb[1]);
    rest = rest.slice(0, emb.index).trim();
  }

  const secondary = parseSecondary(streetLine2);
  if (unit === null) unit = secondary.unit;
  if (buildingName === null) buildingName = secondary.buildingName;

  return { street: rest, unit, buildingName };
}

interface Secondary {
  unit: string | null;
  buildingName: string | null;
}

const EMPTY_SECONDARY: Secondary = { unit: null, buildingName: null };

/**
 * Classify one free-text `street_line_2` value.
 *
 * Order of rules, most explicit first:
 *   1. a unit keyword    -> `High Pointe Unit 36W` = building "High Pointe", unit 36W
 *   2. a building keyword-> `Building G - B377`    = building "Building G",  unit B377
 *   3. trailing number   -> `Beach Manor 0812`     = building "Beach Manor", unit 0812
 *   4. leading number    -> `1892 Villa Lago`      = building "Villa Lago",  unit 1892
 *   5. no digits at all  -> `Casa de Egret`        = building name, no unit
 */
function parseSecondary(raw: string | null | undefined): Secondary {
  if (typeof raw !== "string") return EMPTY_SECONDARY;
  const cleaned = raw.replace(/\([^)]*\)/g, " ").replace(/[,:]+/g, " ").trim();
  if (cleaned === "") return EMPTY_SECONDARY;

  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t !== "-" && t !== "&" && t.toLowerCase() !== "and");
  if (tokens.length === 0) return EMPTY_SECONDARY;

  const unitAt = tokens.findIndex((t) => isUnitKeyword(t) || t.startsWith("#"));
  if (unitAt !== -1) {
    const after = tokens.slice(unitAt + 1);
    const hashInline = tokens[unitAt]!.startsWith("#") ? tokens[unitAt]!.slice(1) : "";
    const designator = hashInline !== "" ? [hashInline] : takeDesignator(after);
    const consumed = hashInline !== "" ? 0 : designator.length;
    const leftover = [...tokens.slice(0, unitAt), ...after.slice(consumed)];
    return {
      unit: normalizeUnit(designator.join("")),
      buildingName: nameOf(leftover),
    };
  }

  const bldgAt = tokens.findIndex(isBuildingKeyword);
  if (bldgAt !== -1) {
    // `R Building` -- the keyword trails, so the whole value is the name.
    if (bldgAt === tokens.length - 1) return { unit: null, buildingName: squash(cleaned) };
    const name = tokens.slice(0, bldgAt + 2);
    const leftover = tokens.slice(bldgAt + 2);
    return { unit: normalizeUnit(takeDesignator(leftover).join("")), buildingName: nameOf(name) };
  }

  const last = tokens[tokens.length - 1]!;
  const secondLast = tokens.length >= 2 ? tokens[tokens.length - 2]! : "";
  // `Cottage 20 B` / `20 B` -- a trailing bare letter belongs to the number before it.
  if (/^[A-Za-z]$/.test(last) && /\d/.test(secondLast)) {
    return {
      unit: normalizeUnit(secondLast + last),
      buildingName: nameOf(tokens.slice(0, -2)),
    };
  }
  if (/\d/.test(last) && tokens.length >= 2) {
    return { unit: normalizeUnit(last), buildingName: nameOf(tokens.slice(0, -1)) };
  }
  if (tokens.length === 1) {
    return isDesignator(last)
      ? { unit: normalizeUnit(last), buildingName: null }
      : { unit: null, buildingName: squash(last) };
  }
  const first = tokens[0]!;
  if (/\d/.test(first)) {
    return { unit: normalizeUnit(first), buildingName: nameOf(tokens.slice(1)) };
  }
  return { unit: null, buildingName: squash(cleaned) };
}

/**
 * Pull the designator that follows a unit keyword. Joins a letter-prefix onto
 * the number that follows it (`Unit EW 404` -> EW404, `Cottage 20 B` -> 20B) so
 * a split designator does not become a half designator.
 */
function takeDesignator(tokens: string[]): string[] {
  const first = tokens[0];
  if (first === undefined) return [];
  const second = tokens[1];
  if (second !== undefined && (!/\d/.test(first) || /^[A-Za-z]$/.test(second))) {
    return [first, second];
  }
  return [first];
}

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** A leftover token run is a building name only if it reads like words. */
function nameOf(tokens: string[]): string | null {
  const joined = squash(tokens.join(" "));
  if (joined === "" || !/[A-Za-z]/.test(joined)) return null;
  if (tokens.length === 1 && isDesignator(joined)) return null;
  return joined;
}

// --- identity --------------------------------------------------------------

export interface CanonicalParts {
  street: string | null | undefined;
  unit: string | null | undefined;
  zip: string | null | undefined;
}

/**
 * The stable identity string for one property. Deterministic, lowercase,
 * pipe-separated: `<street>|<unit>|<zip>`.
 *
 * ZIP is a *coarse* key only. It is included so two identically-named streets in
 * different ZIPs stay apart, but the resolver must never treat a ZIP mismatch as
 * disproof -- the export contradicts itself on ZIP. Pass `zip: null` to compare
 * on street identity alone.
 */
export function canonicalKey(parts: CanonicalParts): string {
  const street = normalizeStreet(parts.street);
  const unit = normalizeUnit(parts.unit) ?? "";
  const zip = typeof parts.zip === "string" ? parts.zip.trim().toLowerCase() : "";
  return `${street}|${unit.toLowerCase()}|${zip}`;
}

/** The shape of an `address` object in jobs.jsonl / customers.jsonl. */
export interface AddressLike {
  street?: string | null;
  street_line_2?: string | null;
  zip?: string | null;
}

/**
 * Defensive convenience wrapper: reads a raw export address (whose `street` is
 * null on at least one job) and returns its canonical key plus the parts it was
 * built from.
 */
export function canonicalizeAddress(
  address: AddressLike | null | undefined,
  options: { includeZip?: boolean } = {},
): UnitParts & { key: string } {
  const a = address ?? {};
  const parts = extractUnit(a.street ?? null, a.street_line_2 ?? null);
  const key = canonicalKey({
    street: parts.street,
    unit: parts.unit,
    zip: options.includeZip === true ? (a.zip ?? null) : null,
  });
  return { ...parts, key };
}
