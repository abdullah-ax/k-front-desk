/**
 * Repairs the anonymizer's collisions in the Gulf Breeze Air note corpus, and
 * flattens the corpus's Unicode for text-to-speech.
 *
 * Serves the extraction pipeline (`src/pipeline/extract/*`) and the voice agent.
 * This module runs BEFORE any LLM reads a note, and BEFORE any note text is
 * spoken. Nothing here does I/O; every function is pure so the tables can be
 * exercised against the real corpus in `tests/scrub.test.ts`.
 *
 * WHY THIS EXISTS
 * The export in `front-desk-assignment/data/` was pseudonymised with a
 * name-substitution pass that did not respect token boundaries or entity types.
 * The README claims phone numbers became `[phone]`; `[phone]` occurs **zero**
 * times in 6,954 notes. What actually happened (measured, see the tables below):
 *
 *   - `Ruby Avery`            405 occ / 358 notes — a PHONE NUMBER wearing a
 *                             person's name. Three of those occurrences were
 *                             not phone numbers at all: an equipment serial, a
 *                             check number and an account number, destroyed by
 *                             the same redactor.
 *   - `Tidewater Hospitality` 914 occ / 516 notes — collides four ways: the
 *                             common noun/verb "work", the noun "test", a real
 *                             property-management customer, and the HVAC
 *                             company itself.
 *   - `Jasmine`               239 occ / 220 notes — the modal verb "will", and
 *                             also several genuine people (Jasmine Dorsey,
 *                             Jasmine Tillman, ...).
 *   - `Leeward Hospitality`    80 occ /  71 notes — the role noun
 *                             homeowner / owner / property manager, and a real
 *                             customer company of the same name.
 *   - `Starfish` / `Shoreline` / `Lighthouse Hospitality`, `Tidewater Shores`
 *                             — verified company-only; kept verbatim, listed so
 *                             the audit is explicit rather than an omission.
 *
 * DESIGN PRINCIPLE — never silently guess.
 * A wrong restoration is worse than a placeholder. A placeholder makes the
 * agent say "I don't have that on file"; a wrong guess makes it say something
 * false, confidently, to a customer. So every rule below either (a) restores a
 * word the surrounding cue makes near-certain, or (b) emits a neutral
 * placeholder AND raises a `ScrubFlag` carrying the original fragment, so the
 * caller can record that a fact came from damaged text.
 *
 * Substitution tables are hoisted to module top as constants, mirroring the EDA
 * loader convention (eda/scripts/dq_common.py, eda/scripts/notes_lib.py).
 * Adding a newly discovered corruption is one entry in `SUBSTITUTIONS`.
 */

// --- flags -----------------------------------------------------------------

/**
 * Why a note was touched. `destroyed-identifier` and `ambiguous-substitution`
 * are the two that must reach the fact record: they mean the agent knows less
 * than the text appears to say.
 */
export const SCRUB_FLAG_TYPES = [
  /** A serial / check / account number was overwritten by the phone redactor. */
  "destroyed-identifier",
  /** The token could not be disambiguated; a placeholder was emitted. */
  "ambiguous-substitution",
  /** A substituted name was restored to the common word it replaced. */
  "restored-common-word",
  /** A substituted name was recognised as a phone number and neutralised. */
  "phone-substitution",
  /** Residue of a redacted email that is no longer a valid address. */
  "mangled-email",
] as const;

export type ScrubFlagType = (typeof SCRUB_FLAG_TYPES)[number];

export interface ScrubFlag {
  type: ScrubFlagType;
  /** The exact fragment as it stood in the raw note. */
  original: string;
  /** What was emitted in its place. */
  replacement: string;
  /** `<token id>/<rule id>` — which table entry fired. */
  rule: string;
  /** Character offset of `original` in the raw text. */
  index: number;
}

export interface ScrubResult {
  text: string;
  flags: ScrubFlag[];
}

// --- placeholders ----------------------------------------------------------

/**
 * The neutral strings the scrubber is allowed to emit. Kept together so the
 * extraction prompt and the agent's refusal logic can import the same list
 * rather than re-typing literals.
 */
export const PLACEHOLDERS = {
  /** A phone number the export replaced with a person's name. */
  phone: "[phone]",
  /** A serial / check / account number destroyed by the phone redactor. */
  identifier: "[redacted-identifier]",
  /** A substituted token whose intended common word cannot be recovered. */
  unclearTerm: "[unclear-term]",
  /** Homeowner / owner / property manager — the export conflated all three. */
  propertyContact: "[property-contact]",
  /** Email residue that is no longer a resolvable address. */
  email: "[email]",
} as const;

/** Every placeholder string, for corpus sweeps and prompt construction. */
export const PLACEHOLDER_VALUES: readonly string[] = Object.values(PLACEHOLDERS);

// --- substitution tables ---------------------------------------------------

/**
 * One disambiguation rule. `before` is tested against the text preceding the
 * token (anchored at its end with `$`); `after` against the text following it
 * (anchored at its start with `^`). A rule with neither always fires, so it can
 * serve as a table-local default. First match wins — order the specific ones up.
 */
export interface ContextRule {
  /** Stable id; appears in `ScrubFlag.rule` so a flag is traceable to a line. */
  id: string;
  before?: RegExp;
  after?: RegExp;
  /** Text to emit in place of the token. */
  emit: string;
  /** Raise a flag when this rule fires. Omit for silent, confident rewrites. */
  flag?: ScrubFlagType;
}

/** A literal string the anonymizer emitted, plus how to read it back. */
export interface SubstitutionEntry {
  /** Stable id used in `ScrubFlag.rule`. */
  id: string;
  /** The literal the anonymizer wrote into the notes. */
  token: string;
  /** Occurrences / notes measured over jobs.jsonl at the export anchor. */
  measured: { occurrences: number; notes: number };
  /** What the token collided with, in prose, for whoever reads a flag later. */
  collision: string;
  /**
   * Require a word boundary before/after the token. Off for multi-word company
   * names (which are already unambiguous) — on for `Jasmine`, so `Jasmines`
   * would not match.
   */
  wordBoundary?: boolean;
  rules: readonly ContextRule[];
  /** Applied when no rule matches. `keep` leaves the token verbatim. */
  fallback: { keep: true } | { emit: string; flag: ScrubFlagType };
}

/**
 * Cues that mark a phone slot. Deliberately broad: over 400 occurrences of
 * `Ruby Avery` were inspected and every one is a phone number except the three
 * identifier collisions caught by `RUBY_IDENTIFIER_CUE` below. The corpus
 * writes them as `phone number:`, `PN:`, `PH:`, `Contact number confirmed as`,
 * `Call X at`, `— inbound from`, and bare `Name <number> / [email]`.
 */
const RUBY_PHONE_CUE =
  /(?:phone|\bPN\b|\bPH\b|\bph\b|number|numbers|calling|call|called|contact|text|texted|cell|tel|reach|inbound|enroute|en route|arrival|arrive|answer|#|at|from|is|as|-|:|\/|,|\(|^|\n)\s*[-:#/,(]?\s*$/i;

/**
 * The phone redactor also ate non-phone identifiers. Three occurrences:
 * `SERIAL NO. Ruby Avery`, `Check #Ruby Avery`, `account #Ruby Avery`.
 * These must never be reported as a phone number, and must never be reported
 * as a serial the agent can read out — the digits are gone for good.
 */
const RUBY_IDENTIFIER_CUE =
  /(?:serial(?:\s*(?:no\.?|number|#))?|\bs\/?n\s*#?|model\s*(?:no\.?|#)|check\s*#|account\s*#|acct\s*#?|invoice\s*#|\bpo\s*#)\s*[:\-]?\s*$/i;

/**
 * `Tidewater Hospitality` in a TEST slot. Every cue here was read in situ:
 * "leak test", "isolation test", "pressure test", "blower door test",
 * "static pressure test", "bubble test", "CFM test", "Ran test multiple times".
 */
const TIDEWATER_TEST_BEFORE =
  /(?:\bleak(?:\s+detection)?|\bisolation|\bpressure|\bblower\s+door|\bstatic\s+pressure|\bbubble|\bCFM|\bRan|\bredo\s+a\s+leak)[\s-]+$/i;

/**
 * `Tidewater Hospitality` in a WORK slot, as a NOUN. Two shapes: a head noun
 * after a modifier ("duct work", "repair work", "plumbing work", "additional
 * work", "no work was done") and a nominal after a determiner ("do the work",
 * "estimate for that work", "a lot of work").
 */
const TIDEWATER_WORK_NOUN_BEFORE =
  /(?:\bduct|\bducts|\bduck|\bductwork|\bsupply\s+duct|\bHVAC\s+duct|\bdrywall|\bdrainage|\bplumbing|\belectrical|\bhvac|\bHVAC|\bexhaust\/vent|\bvent|\breturn\/flex|\bair\s+conditioning|\binstallation|\bwater\s+heater|\bdrain\s+line|\bline|\bcompressor|\bcompressor\/drier|\bcontactor|\bsystem|\bprotection|\blandscaping|\brepair|\bestimate|\bestimated|\brequired|\brelated|\bfollow-up|\badditional|\bremaining|\bseparate|\boriginal|\bphenomenal|\b12-hour|\bweekend|\bcooling|\bprior|\bPrior|\bEverything|\ball|\bany|\bsome|\bother|\bnew|\bno|\bNo|\bGBA|\bAC|\bneed|\bcomplete|\bdoing|\bthe|\bThe|\bthis|\bThis|\bthat|\bThat|\bfor|\bsince|\bbefore|\bduring|\bif|\bof|\bmore|\bservice|\blarger|\bprevious|\bhis|\bher|\btheir|\byour|\b(?:scope|statement|summary|amount|hours|kind|type|lot|copy|flow|options)\s+of)[\s-]+$/i;

/**
 * `Tidewater Hospitality` in a WORK slot, as a VERB: "will not work",
 * "does not work", "seems to work", "the system works normally".
 * Modals and negated auxiliaries only — a bare preposition is too weak a cue.
 */
const TIDEWATER_WORK_VERB_BEFORE =
  /(?:\b(?:will|would|should|could|can|must|might|may|does|do|did)(?:\s*n[o’']?t)?|\bdon\s*[’']?t|\bdidn\s*[’']?t|\bdoesn\s*[’']?t|\bwon\s*[’']?t|\bwont|\bdoesnt|\bdidnt|\bdid\s+not|\bnot\s+actually\s+doing)\s+$/i;

/**
 * The bare infinitive `to <token>` is the one verb slot that is NOT safe to
 * restore blind: "not to work properly" and "to test refrigerant pressures"
 * both occur. Only restore "work" when what follows is an adverb, a
 * preposition or punctuation — i.e. the token takes no object. A `to <token>`
 * with a noun object falls through to `[unclear-term]`.
 */
const TIDEWATER_WORK_INFINITIVE_AFTER =
  /^(?:\s*[.,;!?)]|\s+(?:properly|correctly|normally|well|with|on|in|at|if|given|second\s+floor|the\s+way)\b|\s*$)/i;

/**
 * Cues that mark the HVAC company itself (the export's stand-in for Gulf Breeze
 * Air) or the property-management customer of the same name: "@ X", "with X",
 * "heard about X", "found X via Google", "has used X services", "Vendor X".
 */
const TIDEWATER_COMPANY_BEFORE =
  /(?:@\s*|\bwith|\bfrom|\bby|\bchoosing|\bcalling|\bcall|\bcalled|\bat|\babout|\bfound|\busing|\bused|\btrusting|\bhaving|\bsaid|\bexplained|\bHello|\bVendor|\bUpdated|\bupdated|\bunder|\bout\s+to|\bThis\s+is|\bthis\s+is)[\s/]+$/i;

/**
 * The company reading is also fixed by what FOLLOWS: a possessive, a verb the
 * company is the subject of, or one of its own nouns ("office", "services",
 * "jobs on file", "equipment install on file").
 */
const TIDEWATER_COMPANY_AFTER =
  /^(?:['’]s\b|\s*,?\s*(?:and\s+)?Plumbing\b|\s*,?\s*this\s+is\b|\s+(?:office|services|jobs|installed|inspected|adds|offers|previously|repaired|serviced)\b|\s+(?:can\s+provide|should\s+reach\s+out|normally\s+charges)\b|\s+(?:HVAC\s+|original\s+|full-system\s+)?(?:equipment\s+install|system\s+install)\b)/;

/**
 * `Jasmine` reads as the modal "will" when a bare verb follows. The list is the
 * complete set of verbs observed after `Jasmine` in the corpus, plus `you`
 * (call transcripts: "Will you be home?").
 */
const JASMINE_MODAL_AFTER =
  /^\s+(?:need|needs|be|been|have|has|call|calls|schedule|meet|take|get|go|follow|followup|quote|require|return|reach|do|send|check|checks|replace|order|inform|notify|drop|pick|pickup|prefer|let|see|end|reschedule|resend|run|install|stop|also|more|likely|not|never|no\b|you|we|then|still|probably|now|try|use|leave|bring|start|put|make|come|continue|work|update|charge|credit|apply|arrive|deliver|handle|assess|conduct|cut|add|remove|pull|wait|confirm|coordinate|monitor|verify|attempt|discuss|advise|review|submit|process|approve|complete|finish|proceed|contact)\b/i;

/** A capitalised surname immediately after `Jasmine` marks a real person. */
const JASMINE_SURNAME_AFTER = /^\s+[A-Z][a-z]+/;

/**
 * `Leeward Hospitality` preceded by a determiner or a role qualifier is the
 * role noun the anonymizer ate, not the customer company: "we let the Leeward
 * Hospitality know", "Kenneth Simmons is the Leeward Hospitality", "Authorized
 * Leeward Hospitality Nolan Weaver", "call Kayla (Leeward Hospitality)".
 * Which role — homeowner, owner, or property manager — is NOT recoverable, so
 * this always emits a placeholder and flags.
 */
const LEEWARD_ROLE_BEFORE =
  /(?:\bthe|\ba|\ban|\bour|\bhis|\bher|\btheir|\bauthorized|\bowner\s*\/|\(|,)\s*$/i;

/** `(Leeward Hospitality)` used as a parenthetical role tag after a name. */
const LEEWARD_ROLE_PAREN_AFTER = /^\s*\)/;

/**
 * The substitution table. **Adding a newly discovered corruption is one entry
 * here** — no other file changes. Rules are evaluated top to bottom per entry;
 * the first whose `before`/`after` both match wins.
 */
export const SUBSTITUTIONS: readonly SubstitutionEntry[] = [
  {
    id: "ruby-avery",
    token: "Ruby Avery",
    measured: { occurrences: 405, notes: 358 },
    collision: "a phone number, replaced with a person's name; 3 occurrences are a destroyed serial / check / account number",
    rules: [
      {
        id: "identifier",
        before: RUBY_IDENTIFIER_CUE,
        emit: PLACEHOLDERS.identifier,
        // The digits are unrecoverable. The agent must say it does not have the
        // serial rather than read out a plausible-looking one.
        flag: "destroyed-identifier",
      },
      {
        id: "phone-context",
        before: RUBY_PHONE_CUE,
        emit: PLACEHOLDERS.phone,
        flag: "phone-substitution",
      },
      {
        // Bare `Name Ruby Avery / [email]` and line-initial uses. Verified: no
        // occurrence of this token anywhere in the corpus is a real person.
        id: "default-phone",
        emit: PLACEHOLDERS.phone,
        flag: "phone-substitution",
      },
    ],
    fallback: { emit: PLACEHOLDERS.phone, flag: "phone-substitution" },
  },

  {
    id: "tidewater-hospitality",
    token: "Tidewater Hospitality",
    measured: { occurrences: 914, notes: 516 },
    collision: 'the word "work", the word "test", a property-management customer, and the HVAC company itself',
    rules: [
      // --- template boilerplate (the single largest block: ~340 occurrences) ---
      { id: "summary-of-upper", before: /SUMMARY OF\s+$/, emit: "WORK" },
      { id: "summary-of-title", before: /Summary of\s+$/, emit: "Work" },
      { id: "summary-of-lower", before: /summary of\s+$/, emit: "work" },
      { id: "work-performed", after: /^\s+performed\b/i, emit: "Work" },
      { id: "work-orders", after: /^\s+orders\b/i, emit: "Work", flag: "restored-common-word" },
      { id: "work-done-note", after: /^-done\b/i, emit: "work", flag: "restored-common-word" },

      // `No prior Tidewater Hospitality Tidewater Hospitality at this address`
      // — the company modifying the noun. Left token is the company, right is
      // the noun; resolve both by looking at the neighbour.
      { id: "company-modifier", after: /^\s+Tidewater Hospitality\b/, emit: "Tidewater Hospitality" },
      { id: "work-head-noun", before: /Tidewater Hospitality\s+$/, emit: "work", flag: "restored-common-word" },

      // --- the HVAC company signing off its own customer-facing text ---
      // `reached out to X twice and never heard back` is the company, not the
      // infinitive "to work"; it must outrank the verb rules below.
      { id: "company-reached-out-to", before: /\b(?:out|back)\s+to\s+$/i, emit: "Tidewater Hospitality" },
      { id: "work-home-from", before: /\bhome\s+from\s+$/i, emit: "work", flag: "restored-common-word" },
      { id: "thanks-for-choosing", before: /for choosing\s+$/i, emit: "Tidewater Hospitality" },
      { id: "thank-you-for-calling", before: /for calling\s+$/i, emit: "Tidewater Hospitality" },
      { id: "installed-by", before: /installed by\s+$/i, emit: "Tidewater Hospitality" },
      { id: "company-after-cue", after: TIDEWATER_COMPANY_AFTER, emit: "Tidewater Hospitality" },
      { id: "no-x-system", before: /\bNo\s+$/, after: /^\s+(?:system|full-system|other|HVAC)\b/i, emit: "Tidewater Hospitality" },

      // --- test slot ---
      { id: "test-noun", before: TIDEWATER_TEST_BEFORE, emit: "test", flag: "restored-common-word" },
      // Defensive: every corpus occurrence is already caught by `pressure`
      // above, but "X and vacuum and start up" is unambiguous on its own.
      { id: "test-and-vacuum", after: /^\s+and\s+vacuum\b/i, emit: "test", flag: "restored-common-word" },
      { id: "test-indicate", after: /^\s+indicate\b/i, emit: "test", flag: "restored-common-word" },

      // --- work slot ---
      { id: "work-noun", before: TIDEWATER_WORK_NOUN_BEFORE, emit: "work", flag: "restored-common-word" },
      { id: "work-verb", before: TIDEWATER_WORK_VERB_BEFORE, emit: "work", flag: "restored-common-word" },
      { id: "work-infinitive", before: /\bto\s+$/i, after: TIDEWATER_WORK_INFINITIVE_AFTER, emit: "work", flag: "restored-common-word" },
      { id: "work-is-done", after: /^\s+(?:is\s+(?:completed|done|needed)|was\s+(?:completed|done)|we\s+did|begins|proceeds|area\b)/i, emit: "work", flag: "restored-common-word" },
      { id: "work-charged", after: /^\s+will\s+have\s+to\s+be\s+charged\b/i, emit: "work", flag: "restored-common-word" },

      // --- company slot (generic prepositions, checked last) ---
      { id: "company-context", before: TIDEWATER_COMPANY_BEFORE, emit: "Tidewater Hospitality" },
    ],
    // Anything else is a coin-flip between "work", "test" and the company.
    // Emit a placeholder and flag, per the design principle.
    fallback: { emit: PLACEHOLDERS.unclearTerm, flag: "ambiguous-substitution" },
  },

  {
    id: "jasmine",
    token: "Jasmine",
    measured: { occurrences: 239, notes: 220 },
    collision: 'the modal verb "will"; also several genuine people (Jasmine Dorsey, Jasmine Tillman, ...)',
    wordBoundary: true,
    rules: [
      // The booking-form label. `Meet` is capitalised, so this must outrank the
      // surname rule: `Who Jasmine Meet Tech: Jasmine Dorsey` -> both readings
      // occur on the same line.
      { id: "who-will-meet", before: /\bWho\s+$/i, after: /^\s+Meet\b/i, emit: "Will" },
      { id: "modal-verb", after: JASMINE_MODAL_AFTER, emit: "will", flag: "restored-common-word" },
      // Sentence-initial `Jasmine need to...` after a hard break keeps its case.
      { id: "person-surname", after: JASMINE_SURNAME_AFTER, emit: "Jasmine" },
    ],
    // A bare `Jasmine` with no verb and no surname is most likely the real
    // first name (a neighbour, a PM). Keep it, but flag: it may be a "will".
    fallback: { keep: true },
  },

  {
    id: "leeward-hospitality",
    token: "Leeward Hospitality",
    measured: { occurrences: 80, notes: 71 },
    collision: 'the role noun homeowner / owner / property manager, and a real customer company of the same name',
    rules: [
      { id: "role-determiner", before: LEEWARD_ROLE_BEFORE, emit: PLACEHOLDERS.propertyContact, flag: "ambiguous-substitution" },
      { id: "role-paren-tag", after: LEEWARD_ROLE_PAREN_AFTER, emit: PLACEHOLDERS.propertyContact, flag: "ambiguous-substitution" },
      { id: "role-then-name", after: /^\s+[A-Z][a-z]+\s+[A-Z][a-z]+/, emit: PLACEHOLDERS.propertyContact, flag: "ambiguous-substitution" },
    ],
    // Everything else — "Followed up with Leeward Hospitality", "Spoke to
    // Leeward Hospitality and informed her" — is a coin flip between the role
    // noun and the customer company of the same name. `[property-contact]` is
    // TRUE under either reading (a management company IS the property
    // contact), so neutralising all 80 occurrences asserts nothing false. The
    // company/customer link is carried by customers.jsonl, not by note text,
    // so nothing the agent needs is lost. Always flagged.
    fallback: { emit: PLACEHOLDERS.propertyContact, flag: "ambiguous-substitution" },
  },

  // --- verified company-only. Listed so the audit is explicit, not an omission.
  {
    id: "starfish-hospitality",
    token: "Starfish Hospitality",
    measured: { occurrences: 57, notes: 52 },
    collision: "none found — every occurrence is the property-management customer",
    rules: [],
    fallback: { keep: true },
  },
  {
    id: "shoreline-hospitality",
    token: "Shoreline Hospitality",
    measured: { occurrences: 19, notes: 19 },
    collision: "none found — every occurrence is the property-management customer",
    rules: [],
    fallback: { keep: true },
  },
  {
    id: "tidewater-shores",
    token: "Tidewater Shores",
    measured: { occurrences: 19, notes: 19 },
    collision: "none found — every occurrence is a named contact/company",
    rules: [],
    fallback: { keep: true },
  },
  {
    id: "lighthouse-hospitality",
    token: "Lighthouse Hospitality",
    measured: { occurrences: 16, notes: 13 },
    collision: "none found — every occurrence is the property-management customer",
    rules: [],
    fallback: { keep: true },
  },
];

/**
 * Non-substitution damage: residue the redactor left behind that is not a name
 * collision. One entry today; the shape is the same so it stays data.
 */
export const RESIDUE_PATTERNS: ReadonlyArray<{
  id: string;
  pattern: RegExp;
  emit: string;
  flag: ScrubFlagType;
}> = [
  {
    // `email: reej2raol.com` — the local part and `@` were eaten, leaving a
    // string that looks like a domain but resolves to nothing.
    id: "mangled-email",
    pattern: /\breej2raol\.com\b/g,
    emit: PLACEHOLDERS.email,
    flag: "mangled-email",
  },
];

// --- speech normalisation --------------------------------------------------

/**
 * Ordered rewrite table for text the agent will speak. 755 of 6,954 notes carry
 * non-ASCII; a TTS voice either mispronounces it, spells it out, or stalls.
 * Order matters: degree units before the bare degree sign.
 */
export const SPEECH_REPLACEMENTS: ReadonlyArray<{
  id: string;
  pattern: RegExp;
  emit: string;
}> = [
  { id: "degree-f", pattern: /°\s*F\b/g, emit: " degrees Fahrenheit" },
  { id: "degree-c", pattern: /°\s*C\b/g, emit: " degrees Celsius" },
  { id: "degree", pattern: /°/g, emit: " degrees" },

  { id: "single-quote", pattern: /[‘’‚‛′]/g, emit: "'" },
  { id: "double-quote", pattern: /[“”„‟″]/g, emit: '"' },
  // An em dash is a spoken pause; an en dash inside a range is a hyphen.
  { id: "em-dash", pattern: /\s*—\s*/g, emit: " - " },
  { id: "en-dash", pattern: /–/g, emit: "-" },
  { id: "ellipsis", pattern: /…/g, emit: "..." },
  { id: "multiplication", pattern: /×/g, emit: "x" },
  { id: "micro", pattern: /µ/g, emit: "micro" },
  { id: "trademark", pattern: /[™®]/g, emit: "" },
  { id: "nbsp", pattern: /[   ]/g, emit: " " },

  // Bullets, arrows and dingbats: layout, never content. A bullet becomes a
  // separator so "•Ran test" does not slur into one word.
  { id: "bullet", pattern: /[•▪●‣⁃]/g, emit: "- " },
  { id: "arrow", pattern: /[➡→←➔⇒]/g, emit: " " },
  { id: "checkmark", pattern: /[✔✅✓❌❗❕]/g, emit: " " },

  // Zero-width and non-rendering: strip outright.
  // U+FFFC is a stripped inline image; U+FEFF a BOM mid-file.
  { id: "invisible", pattern: /[﻿￼︎️​‌‍⁠­]/g, emit: "" },

  // Emoji, skin-tone modifiers and regional-indicator pairs. NOT
  // `\p{Emoji_Component}` — that property includes the ASCII digits 0-9 and
  // `#`/`*` (they are keycap bases), which would silently delete every
  // temperature, pressure and date in the corpus.
  { id: "emoji", pattern: /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]/gu, emit: "" },
];

/**
 * Final backstop. Anything still outside printable ASCII after the table above
 * is dropped rather than handed to a TTS engine, so the guarantee "the agent
 * only ever speaks ASCII" holds without depending on table completeness.
 */
const NON_SPEAKABLE_ASCII = /[^\n\t\x20-\x7E]/g;

/** Horizontal whitespace runs, collapsed without eating line structure. */
const HORIZONTAL_RUNS = /[ \t]{2,}/g;

// --- engine ----------------------------------------------------------------

/** Escapes a literal for use inside a RegExp. */
function escapeLiteral(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compiled matcher per table entry, built once at module load. */
const COMPILED: ReadonlyArray<{ entry: SubstitutionEntry; matcher: RegExp }> =
  SUBSTITUTIONS.map((entry) => ({
    entry,
    matcher: new RegExp(
      entry.wordBoundary ? `\\b${escapeLiteral(entry.token)}\\b` : escapeLiteral(entry.token),
      "g",
    ),
  }));

/**
 * How much text on each side a rule may look at. Long enough for
 * `(copy/paste into Summary of ` and `Contact number confirmed as `, short
 * enough that a cue from a different sentence cannot reach across.
 */
const CONTEXT_WINDOW = 48;

interface Decision {
  emit: string;
  flag?: ScrubFlagType;
  ruleId: string;
}

/** Sentence-final punctuation, or nothing, before the token. */
const SENTENCE_START = /(?:^|[.!?|\n])\s*$/;

/**
 * Restores a restored common word to sentence case when the token it replaced
 * began a sentence: `... auto.\n\nTidewater Hospitality performed:` must come
 * back as `Work performed:`, not `work performed:`. Only touches all-lowercase
 * emissions, so placeholders and company names are left alone.
 */
function matchSentenceCase(emit: string, before: string): string {
  if (!/^[a-z]+$/.test(emit)) return emit;
  if (!SENTENCE_START.test(before)) return emit;
  return emit.charAt(0).toUpperCase() + emit.slice(1);
}

/** Resolves one occurrence of `entry.token` at `index` in `text`. */
function decide(entry: SubstitutionEntry, text: string, index: number): Decision {
  const before = text.slice(Math.max(0, index - CONTEXT_WINDOW), index);
  const after = text.slice(index + entry.token.length, index + entry.token.length + CONTEXT_WINDOW);

  for (const rule of entry.rules) {
    if (rule.before && !rule.before.test(before)) continue;
    if (rule.after && !rule.after.test(after)) continue;
    return { emit: matchSentenceCase(rule.emit, before), flag: rule.flag, ruleId: rule.id };
  }

  if ("keep" in entry.fallback) {
    return { emit: entry.token, ruleId: "fallback-keep" };
  }
  return { emit: entry.fallback.emit, flag: entry.fallback.flag, ruleId: "fallback" };
}

/**
 * Rewrites a raw note so an LLM extractor cannot mistake an anonymizer
 * collision for a real entity.
 *
 * Every substitution is either a confident restoration or a neutral
 * placeholder; a placeholder always comes with a flag naming the original
 * fragment, so a fact derived from this text can be marked as coming from
 * damaged source. Returns the input unchanged (and no flags) for the ~89% of
 * notes that carry no known corruption.
 */
export function scrubForExtraction(text: string): ScrubResult {
  if (typeof text !== "string" || text.length === 0) return { text: text ?? "", flags: [] };

  const hits = classifyOccurrences(text);
  if (hits.length === 0) return { text, flags: [] };

  const flags: ScrubFlag[] = [];
  const out: string[] = [];
  let cursor = 0;
  for (const hit of hits) {
    // `Tidewater Shores` and `Tidewater Hospitality` cannot overlap in this
    // corpus, but a future table entry might. First (leftmost) wins.
    if (hit.start < cursor) continue;
    out.push(text.slice(cursor, hit.start));
    out.push(hit.emit);
    if (hit.flag) {
      flags.push({
        type: hit.flag,
        original: hit.original,
        replacement: hit.emit,
        rule: `${hit.entryId}/${hit.ruleId}`,
        index: hit.start,
      });
    }
    cursor = hit.end;
  }
  out.push(text.slice(cursor));

  return { text: out.join(""), flags };
}

/** One resolved occurrence of a known corruption. */
export interface Occurrence {
  entryId: string;
  ruleId: string;
  /** The literal as it stood in the raw text. */
  original: string;
  /** What `scrubForExtraction` will emit in its place. */
  emit: string;
  flag?: ScrubFlagType;
  start: number;
  end: number;
}

/**
 * Every known-corrupt token in `text`, with the rule that resolved it, in
 * document order. Exposed so a corpus sweep can report coverage per rule
 * without re-implementing the matching (see `tests/scrub.test.ts`).
 */
export function classifyOccurrences(text: string): Occurrence[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const hits: Occurrence[] = [];

  // Matched against the ORIGINAL text, so one entry's replacement can never
  // create or destroy another entry's match.
  for (const { entry, matcher } of COMPILED) {
    matcher.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = matcher.exec(text)) !== null) {
      const start = m.index;
      const end = start + entry.token.length;
      const decision = decide(entry, text, start);
      hits.push({
        entryId: entry.id,
        ruleId: decision.ruleId,
        original: entry.token,
        emit: decision.emit,
        ...(decision.flag ? { flag: decision.flag } : {}),
        start,
        end,
      });
      matcher.lastIndex = end;
    }
  }

  for (const residue of RESIDUE_PATTERNS) {
    const matcher = new RegExp(residue.pattern.source, residue.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = matcher.exec(text)) !== null) {
      hits.push({
        entryId: residue.id,
        ruleId: residue.id,
        original: m[0],
        emit: residue.emit,
        flag: residue.flag,
        start: m.index,
        end: m.index + m[0].length,
      });
      if (m.index === matcher.lastIndex) matcher.lastIndex += 1;
    }
  }

  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  return hits;
}

/**
 * Flattens text to speakable ASCII for anything the voice agent reads aloud.
 *
 * Not a substitute for `scrubForExtraction` — it does nothing about the name
 * collisions. Compose them: `scrubForSpeech(scrubForExtraction(raw).text)`.
 */
export function scrubForSpeech(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text ?? "";

  let out = text;
  for (const rule of SPEECH_REPLACEMENTS) {
    out = out.replace(rule.pattern, rule.emit);
  }
  out = out.replace(NON_SPEAKABLE_ASCII, "");
  out = out.replace(HORIZONTAL_RUNS, " ");
  // A bullet or arrow at line start leaves a dangling separator.
  out = out.replace(/[ \t]+$/gm, "").replace(/^[ \t]+/gm, "");
  return out;
}

/**
 * Convenience for the agent path: extraction repair, then speech flattening,
 * with the flags preserved so a spoken answer can still be hedged.
 */
export function scrubForVoice(text: string): ScrubResult {
  const { text: repaired, flags } = scrubForExtraction(text);
  return { text: scrubForSpeech(repaired), flags };
}

/**
 * Table entries that must never leave their token in the output: no rule and no
 * fallback emits the token verbatim. `Ruby Avery` is the only one — it has no
 * legitimate reading anywhere in the corpus. `Tidewater Hospitality` and
 * `Leeward Hospitality` are excluded because they are also real customers, so
 * a surviving occurrence there is a deliberate keep, not a miss.
 */
export const ALWAYS_REWRITTEN_TOKENS: readonly string[] = SUBSTITUTIONS.filter(
  (e) =>
    !("keep" in e.fallback) &&
    e.fallback.emit !== e.token &&
    !e.rules.some((r) => r.emit === e.token),
).map((e) => e.token);

/**
 * True when `text` still contains a token that no reading justifies keeping.
 * A survivor here means a table entry is missing a rule — the corpus sweep in
 * `tests/scrub.test.ts` asserts this is zero across all 6,954 notes.
 */
export function hasUnresolvedCorruption(text: string): boolean {
  return ALWAYS_REWRITTEN_TOKENS.some((t) => text.includes(t));
}
