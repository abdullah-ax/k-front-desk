/**
 * Tests for `src/pipeline/scrub/anonymizer.ts`, run against the REAL corpus.
 *
 * The scrubber is a halt-gate: if it is wrong, false facts get baked into the
 * database that the voice agent reads aloud. So these tests do not use
 * fixtures for the corpus-level claims — they load all 6,954 notes from
 * `front-desk-assignment/data/jobs.jsonl` and measure. The literal examples in
 * the table-driven blocks are verbatim fragments from that file.
 *
 * Run: `pnpm vitest run tests/scrub.test.ts`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DATA, EXPECTED_COUNTS } from "../src/config";
import {
  ALWAYS_REWRITTEN_TOKENS,
  PLACEHOLDERS,
  SUBSTITUTIONS,
  classifyOccurrences,
  hasUnresolvedCorruption,
  scrubForExtraction,
  scrubForSpeech,
} from "../src/pipeline/scrub/anonymizer";

// --- corpus ----------------------------------------------------------------

/** Every note content, in file order. Mirrors eda/scripts/notes_lib.py:load_notes. */
function loadNotes(): string[] {
  const raw = readFileSync(join(DATA, "jobs.jsonl"), "utf8");
  const notes: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const job = JSON.parse(line) as { notes?: Array<{ id: string; content?: string }> };
    for (const note of job.notes ?? []) notes.push(note.content ?? "");
  }
  return notes;
}

const NOTES = loadNotes();

/** Occurrences of `needle` across the whole corpus. */
function occurrences(haystacks: readonly string[], needle: string): number {
  return haystacks.reduce((total, t) => total + (t.split(needle).length - 1), 0);
}

/** Notes containing `needle` at least once. */
function noteCount(haystacks: readonly string[], needle: string): number {
  return haystacks.filter((t) => t.includes(needle)).length;
}

const SCRUBBED = NOTES.map((t) => scrubForExtraction(t));
const SCRUBBED_TEXT = SCRUBBED.map((r) => r.text);

/**
 * Occurrences the tables could NOT disambiguate and therefore neutralised to
 * `[unclear-term]`. Measured, documented, and asserted exactly: if a rule
 * change moves this number, that is a deliberate decision, not a silent drift.
 * All 37 are `Tidewater Hospitality` in a slot where "work", "test" and the
 * company name are all live readings (e.g. `Placed a X TStat on the wall`,
 * `flush/X with gallon a water`, `the system X normally`).
 */
const UNRESOLVED_BUDGET = 37;

// --- the README is wrong ---------------------------------------------------

describe("the raw export", () => {
  it("has the note count src/config.ts expects", () => {
    expect(NOTES.length).toBe(EXPECTED_COUNTS.notes);
  });

  it("contains ZERO `[phone]` placeholders, contradicting the data README", () => {
    // The README says phone numbers "are replaced with `[phone]`". They are
    // not: they were replaced with the person name `Ruby Avery`. Any pipeline
    // that trusts the README will treat 405 phone numbers as a customer.
    expect(occurrences(NOTES, "[phone]")).toBe(0);
    expect(occurrences(NOTES, "Ruby Avery")).toBe(405);
  });

  it("matches every occurrence count recorded in the substitution table", () => {
    // The table's `measured` field is documentation that must not rot. If the
    // export is ever refreshed, this fails and the tables get re-derived.
    const actual = SUBSTITUTIONS.map((e) => [
      e.token,
      occurrences(NOTES, e.token),
      noteCount(NOTES, e.token),
    ]);
    const expected = SUBSTITUTIONS.map((e) => [e.token, e.measured.occurrences, e.measured.notes]);
    expect(actual).toEqual(expected);
  });
});

// --- Ruby Avery is a phone number ------------------------------------------

describe("Ruby Avery (a phone number wearing a person's name)", () => {
  it("never survives scrubbing anywhere in the corpus", () => {
    const survivors = SCRUBBED_TEXT.filter((t) => t.includes("Ruby Avery"));
    expect(survivors).toEqual([]);
  });

  it.each([
    ["phone number: Ruby Avery", "phone number: [phone]"],
    ["PN: Ruby Avery", "PN: [phone]"],
    ["contact number Ruby Avery and email [email]", "contact number [phone] and email [email]"],
    ["Ask for Marie when calling Ruby Avery", "Ask for Marie when calling [phone]"],
    ["Homeowner is paying the bill\nNolan Watts\nRuby Avery\n[email]\n", "Homeowner is paying the bill\nNolan Watts\n[phone]\n[email]\n"],
  ])("reads %j as a phone number", (input, expected) => {
    const { text, flags } = scrubForExtraction(input);
    expect(text).toBe(expected);
    expect(flags.every((f) => f.type === "phone-substitution")).toBe(true);
  });

  it("raises a flag rather than inventing a serial for `SERIAL NO. Ruby Avery`", () => {
    // Verbatim from the corpus: the phone redactor ate an equipment serial.
    const raw =
      "CONDENSER MODEL AND SERIAL\nMODEL GSZC160361CA\nSERIAL NO. Ruby Avery\n\n\nWARRANTY MOTOR";
    const { text, flags } = scrubForExtraction(raw);

    expect(text).toContain(`SERIAL NO. ${PLACEHOLDERS.identifier}`);
    // Crucially: nothing that could be read out as a serial number.
    expect(text).not.toContain("Ruby Avery");
    expect(text).not.toMatch(/SERIAL NO\.\s*[A-Z0-9]{4,}/);

    const flag = flags.find((f) => f.type === "destroyed-identifier");
    expect(flag).toBeDefined();
    expect(flag?.original).toBe("Ruby Avery");
    expect(flag?.replacement).toBe(PLACEHOLDERS.identifier);
    expect(flag?.rule).toBe("ruby-avery/identifier");
  });

  it.each([
    "Check #Ruby Avery ",
    "Caller (booking contact on account #Ruby Avery) called after online booking",
  ])("flags the other destroyed identifiers: %j", (raw) => {
    const { text, flags } = scrubForExtraction(raw);
    expect(text).toContain(PLACEHOLDERS.identifier);
    expect(flags.map((f) => f.type)).toContain("destroyed-identifier");
  });

  it("finds exactly three destroyed identifiers across the whole corpus", () => {
    const destroyed = SCRUBBED.flatMap((r) => r.flags).filter(
      (f) => f.type === "destroyed-identifier",
    );
    expect(destroyed).toHaveLength(3);
  });
});

// --- Tidewater Hospitality is three different things -----------------------

describe("Tidewater Hospitality (work / test / company)", () => {
  /**
   * Verbatim corpus fragments. `contains` is asserted present in the output,
   * `absent` asserted gone — so a company reading proves the company name
   * SURVIVED, and a common-word reading proves it did NOT.
   */
  const CASES: Array<{ label: string; raw: string; contains: string; absent?: string }> = [
    {
      label: "duct work (noun slot)",
      raw: "Duct Tidewater Hospitality / Repair - Replace Supply",
      contains: "Duct work /",
      absent: "Tidewater Hospitality",
    },
    {
      label: "will not work ... as pressure tests indicate",
      raw: "Leak seal most likely will not Tidewater Hospitality as pressure Tidewater Hospitality indicate a fast leak",
      contains: "will not work as pressure test indicate",
      absent: "Tidewater Hospitality",
    },
    {
      label: "isolation test",
      raw: "we will need to come back and do an isolation Tidewater Hospitality to find the leak",
      contains: "do an isolation test to find the leak",
      absent: "Tidewater Hospitality",
    },
    {
      label: "summary of work (both slots in the template header)",
      raw: "=== SUMMARY OF Tidewater Hospitality (copy/paste into Summary of Tidewater Hospitality field) ===",
      contains: "=== SUMMARY OF WORK (copy/paste into Summary of Work field) ===",
      absent: "Tidewater Hospitality",
    },
    {
      label: "Work performed: (sentence-initial noun)",
      raw: "- Clogged drain line found.\n\nTidewater Hospitality performed:\n- Cleared the line",
      contains: "Work performed:",
      absent: "Tidewater Hospitality",
    },
    {
      label: "scope of work",
      raw: "the kitchen island\n\nScope of Tidewater Hospitality:\n\n- Remove existing thermostat",
      contains: "Scope of work:",
      absent: "Tidewater Hospitality",
    },
    {
      label: "the real property-management company after @",
      raw: "Followed up with Malcolm @ Tidewater Hospitality",
      contains: "Malcolm @ Tidewater Hospitality",
    },
    {
      label: "the HVAC company itself, after `has used`",
      raw: "- Customer is the homeowner and has used Tidewater Hospitality services at this property before.",
      contains: "has used Tidewater Hospitality services",
    },
    {
      label: "the HVAC company signing off customer text",
      raw: "properly. Thank you for choosing Tidewater Hospitality!\n\n=== AI STATUS FLAGS ===",
      contains: "Thank you for choosing Tidewater Hospitality!",
    },
    {
      label: "the HVAC company as an install source",
      raw: "- Units were installed by Tidewater Hospitality a couple years ago",
      contains: "installed by Tidewater Hospitality",
    },
    {
      label: "no other jobs on file (company, not the noun)",
      raw: "(Javier Shaffer)\n\nNo other Tidewater Hospitality jobs on file at this address.",
      contains: "No other Tidewater Hospitality jobs on file",
    },
  ];

  it.each(CASES)("$label", ({ raw, contains, absent }) => {
    const { text } = scrubForExtraction(raw);
    expect(text).toContain(contains);
    if (absent !== undefined) expect(text).not.toContain(absent);
  });

  it("never restores a common word without flagging it", () => {
    const { flags } = scrubForExtraction(
      "we will need to come back and do an isolation Tidewater Hospitality to find the leak",
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]?.type).toBe("restored-common-word");
    expect(flags[0]?.original).toBe("Tidewater Hospitality");
    expect(flags[0]?.replacement).toBe("test");
  });

  it("emits a placeholder, not a guess, when the slot is genuinely ambiguous", () => {
    // "Placed a test TStat" / "Placed a work TStat" / the company are all live
    // readings. The rules must decline rather than pick one.
    const { text, flags } = scrubForExtraction(
      "-Placed a Tidewater Hospitality TStat on the wall and the ran well",
    );
    expect(text).toContain(PLACEHOLDERS.unclearTerm);
    expect(flags.map((f) => f.type)).toEqual(["ambiguous-substitution"]);
  });
});

// --- Jasmine is the modal verb "will" --------------------------------------

describe("Jasmine (the modal verb `will`)", () => {
  it("restores the booking-form label", () => {
    const raw = "[No Time Restrictions]\nWho Jasmine Meet Tech: NA\nAge/Location of the Unit";
    expect(scrubForExtraction(raw).text).toContain("Who Will Meet Tech: NA");
  });

  it("restores the label while keeping a real Jasmine on the same line", () => {
    // Both readings occur in one line in the corpus.
    const raw = "[Emergency slot]\nWho Jasmine Meet Tech: Jasmine Dorsey\nAge/Location";
    expect(scrubForExtraction(raw).text).toContain("Who Will Meet Tech: Jasmine Dorsey");
  });

  it.each([
    ["Jasmine need to come back in morning ", "Will need to come back in morning "],
    ["Ordered System with Mingle\nJasmine be delivered tomorrow 3/16", "Ordered System with Mingle\nWill be delivered tomorrow 3/16"],
    ["little sketch about payment \n\nJasmine schedule when part arrives", "little sketch about payment \n\nWill schedule when part arrives"],
    ["System is installed. \n\nJasmine have to return next day.", "System is installed. \n\nWill have to return next day."],
  ])("reads a bare verb after it as a modal: %j", (input, expected) => {
    expect(scrubForExtraction(input).text).toBe(expected);
  });

  it.each([
    "- Jasmine Dorsey is the homeowner and will meet the technician",
    "ask for manager Jasmine Benton and he will show you where",
    "The neighbor (Jasmine) will meet you there to talk",
    "- Send email to Jasmine to sign off / approve so repl",
  ])("keeps a genuine person named Jasmine: %j", (raw) => {
    expect(scrubForExtraction(raw).text).toContain("Jasmine");
  });
});

// --- lower-volume names ----------------------------------------------------

describe("the lower-volume substitutions", () => {
  it("neutralises every `Leeward Hospitality`, which is 74% role noun", () => {
    // `[property-contact]` is TRUE whether the original said homeowner, owner,
    // office, or the management company of that name — so it asserts nothing
    // false in either reading.
    expect(SCRUBBED_TEXT.some((t) => t.includes("Leeward Hospitality"))).toBe(false);

    const { text, flags } = scrubForExtraction("we let the Leeward Hospitality know of the issue");
    expect(text).toBe(`we let the ${PLACEHOLDERS.propertyContact} know of the issue`);
    expect(flags.map((f) => f.type)).toEqual(["ambiguous-substitution"]);
  });

  it.each([
    "Followed up with Starfish Hospitality and sent invoice ",
    "Spoke to Shoreline Hospitality over the phone. Sending a quote",
    "Followed up with Tidewater Shores in text thread - sent invoice",
    "Tara from Lighthouse Hospitality called because an AC unit",
  ])("keeps the verified company-only names verbatim: %j", (raw) => {
    expect(scrubForExtraction(raw).text).toBe(raw);
    expect(scrubForExtraction(raw).flags).toEqual([]);
  });

  it("replaces the one mangled email residue", () => {
    const { text, flags } = scrubForExtraction("email: reej2raol.com | phone: Ruby Avery");
    expect(text).toBe("email: [email] | phone: [phone]");
    expect(flags.map((f) => f.type).sort()).toEqual(["mangled-email", "phone-substitution"]);
  });
});

// --- speech ----------------------------------------------------------------

describe("scrubForSpeech", () => {
  it("expands the degree sign to a spoken word", () => {
    expect(scrubForSpeech("Return air was 72° inside")).toBe("Return air was 72 degrees inside");
    expect(scrubForSpeech("Supply at 77°F.")).toBe("Supply at 77 degrees Fahrenheit.");
  });

  it("does not eat digits (regression: \\p{Emoji_Component} includes 0-9)", () => {
    const raw = "Split of 20° on unit #3 at 8:15 🤦🏾‍♂️";
    const out = scrubForSpeech(raw);
    expect(out).toContain("20 degrees");
    expect(out).toContain("#3");
    expect(out).toContain("8:15");
  });

  it("normalises smart quotes and dashes to ASCII", () => {
    expect(scrubForSpeech("it’s “fine” — really – ok…")).toBe(
      "it's \"fine\" - really - ok...",
    );
  });

  it("strips bullets, arrows, zero-width and object-replacement characters", () => {
    const raw = "﻿•Ran test ➡ next￼ step here";
    const out = scrubForSpeech(raw);
    expect(out).toBe("- Ran test next step here");
    expect(out).not.toMatch(/[﻿￼️•➡]/);
  });

  it("leaves nothing unspeakable in ANY of the 6,954 notes", () => {
    const offenders: Array<{ index: number; codePoint: string }> = [];
    NOTES.forEach((note, index) => {
      const spoken = scrubForSpeech(note);
      const bad = spoken.match(/[^\n\t\x20-\x7E]/u);
      if (bad?.[0]) {
        offenders.push({ index, codePoint: `U+${bad[0].codePointAt(0)!.toString(16).toUpperCase()}` });
      }
    });
    expect(offenders).toEqual([]);
  });

  it("actually had work to do — 759 notes carry non-ASCII before scrubbing", () => {
    // Guards against the previous assertion passing because the loader broke.
    const before = NOTES.filter((t) => /[^\n\t\x20-\x7E]/u.test(t)).length;
    expect(before).toBe(759);
  });
});

// --- corpus-wide sweep -----------------------------------------------------

describe("corpus-wide sweep", () => {
  it("leaves zero occurrences of a token that has no legitimate reading", () => {
    expect([...ALWAYS_REWRITTEN_TOKENS]).toEqual(["Ruby Avery", "Leeward Hospitality"]);
    const survivors = SCRUBBED_TEXT.filter(hasUnresolvedCorruption);
    expect(survivors).toHaveLength(0);
  });

  it("resolves every occurrence through a named rule, never by accident", () => {
    const unruled = NOTES.flatMap((t) => classifyOccurrences(t)).filter((o) => !o.ruleId);
    expect(unruled).toEqual([]);
  });

  it(`leaves exactly ${UNRESOLVED_BUDGET} occurrences neutralised as ${PLACEHOLDERS.unclearTerm}`, () => {
    // Documented, not aspirational: these are the slots where "work", "test"
    // and the company name are all live readings. Every one carries a flag, so
    // no fact derived from them can be reported as certain.
    const unclear = occurrences(SCRUBBED_TEXT, PLACEHOLDERS.unclearTerm);
    expect(unclear).toBe(UNRESOLVED_BUDGET);

    const ambiguousFlags = SCRUBBED.flatMap((r) => r.flags).filter(
      (f) => f.type === "ambiguous-substitution" && f.replacement === PLACEHOLDERS.unclearTerm,
    );
    expect(ambiguousFlags).toHaveLength(UNRESOLVED_BUDGET);
  });

  it("flags 792 of the 986 notes that carry a corrupted token", () => {
    // 986 notes contain one of the four colliding tokens; 792 of them needed a
    // rewrite that the caller must record. The other 194 are notes where every
    // occurrence was a legitimate company mention (e.g. `Thanks for choosing
    // Tidewater Hospitality!`), which is a silent, confident keep.
    const CORE = ["Ruby Avery", "Tidewater Hospitality", "Jasmine", "Leeward Hospitality"];
    const carrying = NOTES.filter((t) => CORE.some((k) => t.includes(k))).length;
    const flagged = SCRUBBED.filter((r) => r.flags.length > 0).length;
    expect(carrying).toBe(986);
    expect(flagged).toBe(792);
  });

  it("carries the original fragment on every flag, so a fact can cite its damage", () => {
    for (const { flags } of SCRUBBED) {
      for (const flag of flags) {
        expect(flag.original.length).toBeGreaterThan(0);
        expect(flag.rule).toMatch(/^[a-z-]+\/[a-z-]+$/);
        expect(flag.index).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("is a no-op on clean text", () => {
    const clean = "Replaced dual run capacitor, system cooling at 18 degree split.";
    expect(scrubForExtraction(clean)).toEqual({ text: clean, flags: [] });
  });

  it("survives empty and whitespace input without throwing", () => {
    expect(scrubForExtraction("")).toEqual({ text: "", flags: [] });
    expect(scrubForSpeech("")).toBe("");
    expect(scrubForExtraction("   ").text).toBe("   ");
  });
});
