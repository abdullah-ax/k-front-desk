/**
 * Unit / system identifiers — WHICH of a property's several systems this is.
 *
 * MEASURED (eda/01-notes-corpus.md §3): 2,089 notes across **1,238 jobs (65.9%
 * of noted jobs)** carry a unit or floor identifier. That makes it the most
 * extractable and most operationally valuable structured fact in the corpus, and
 * it is the one first-class entity the platform needs that Housecall Pro does
 * not have: a property has SEVERAL systems, and an appointment is against ONE
 * of them.
 *
 * The vocabulary is not a code. It is whatever the caller said:
 *   "3rd floor system", "2nd and 3rd floor systems", "Unit 8.4", "Unit #903",
 *   "the one that controls the main living area and the oldest unit",
 *   "pool house", "air handler closet", and named properties —
 *   "Casa de Egret", "Saltgrass Pointe Dunes Condos", "Saltbush Key #13"
 *   (17 notes / 16 jobs name a property this way).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It does not identify equipment. There is NO equipment record in this dataset —
 * no model, no serial, no install date on fewer than 2% of jobs
 * (eda/01-notes-corpus.md §3, "The headline negative"). A caller asking "what
 * unit do I have" cannot be answered; a caller asking "the upstairs one, like
 * last time" can. That second question is what this extractor serves.
 *
 * Subject is the PROPERTY, because the identifier is stable across visits — that
 * is the entire point of extracting it.
 */
import { z } from "zod";
import type { Extractor } from "./_runner.js";

export const factType = "units";
export const version = "2";
export const subjectType = "property" as const;
export const expectedJobs = 1238;

export const schema = z.object({
  identifier: z
    .string()
    .describe(
      "The identifier as the note words it: '3rd floor system', 'Unit 8.4', 'Casa de Egret', " +
        "'pool house'. Keep the note's own words — this is what a caller will say back.",
    ),
  kind: z
    .enum([
      "floor",
      "unit_number",
      "named_property",
      "area_served",
      "location",
      "count",
      "other",
    ])
    .catch("other")
    .describe(
      "floor: identified by storey. unit_number: a condo/apartment number. " +
        "named_property: the house or complex has a name. area_served: identified by what it " +
        "cools ('the one that controls the main living area'). location: where the equipment " +
        "physically sits ('attic', 'air handler closet', 'pool house'). " +
        "count: the note states how many systems the property has.",
    ),
  system_count: z
    .number()
    .int()
    .nullable()
    .describe("How many systems the property has, when the note says so ('He has 4 AC units here'). Otherwise null."),
  is_subject_of_job: z
    .boolean()
    .default(true)
    .describe(
      "true when this is the system this visit is about; false when the note merely mentions " +
        "another system at the property.",
    ),
});

export const prompt = `Extract UNIT / SYSTEM IDENTIFIERS: which of the property's several HVAC systems the notes are
talking about, and any name the property itself is given.

A property here routinely has two, three or four systems. The office and the caller identify them
by floor, by unit number, by what room they cool, or by where the air handler sits. Nothing in the
structured data records this, so an agent that cannot say "the third-floor system" cannot hold a
conversation about a repeat visit.

Emit a row for:
  · a floor reference to a system: "3rd floor system", "2nd floor unit", "1st fl", "upstairs unit".
    "2nd and 3rd floor systems not cooling" is TWO rows, one per floor, each with its own snippet
    only if you can quote a distinct span; if the span is shared, emit one row for the phrase as
    written and put it in identifier verbatim.
  · a unit or condo number: "Unit 8.4", "Unit #903", "unit 1025", "Saltbush Key #13".
  · a named property: "Casa de Egret", "Saltgrass Pointe Dunes Condos", "Palmetto Hollow/ pool house".
  · a system identified by what it serves: "the one that controls the main living area",
    "the oldest unit", "the mini split in the garage".
  · a physical location that identifies the system: "attic unit", "air handler closet", "pool house",
    "roof unit".
  · a stated system count: "He has 4 AC units here" -> kind count, system_count 4.

DO NOT emit:
  · the street address — that is already structured data.
  · a part or component ("evap coil", "compressor", "capacitor"). Those are not systems.
  · a model or serial number.
  · a generic "the unit" / "the system" with nothing distinguishing it. If it does not tell you
    WHICH system, it is not an identifier.

Examples:
  "2nd and 3rd floor systems not cooling. / Standing by for door code"
     -> identifier "2nd and 3rd floor systems", kind floor, is_subject_of_job true.
  "He has 4 AC units here, the one not cooling is the one that controls the main living area and
   the oldest unit"
     -> count row (system_count 4) and area_served row ("the one that controls the main living area").
  "Mini split will not stay on in Palmetto Hollow/ pool house"
     -> identifier "Palmetto Hollow/ pool house", kind location, is_subject_of_job true.
  "coil will need to be Pulled and clean on the 3rd and 2nd floors due to all the drywall dust"
     -> identifier "the 3rd and 2nd floors", kind floor, is_subject_of_job true.`;

/**
 * "Keep the note's own words — this is what a caller will say back." That is the
 * schema's own description of `identifier`, and it is the entire value of the
 * field: the agent says "the third-floor system" back because the note said it.
 *
 * It was not being kept. Measured over the 5,038 rows version 2 wrote, 469
 * identifiers appear nowhere in their note, and 51 of them are the string "the
 * one that controls the main living area" — a phrase out of the example block in
 * the prompt above, not out of the corpus. The model was completing the prompt.
 *
 * `identifier` is NOT nullable, so a row that fails this is dropped rather than
 * emptied: nulling it would break this extractor's own schema, and a units row
 * with no identifier is a row that identifies nothing. That is the one place in
 * this directory where the copy-field gate discards a whole fact, and it is
 * discarding facts that were never about a real system.
 *
 * `kind`, `system_count` and `is_subject_of_job` are classifications the prompt
 * asks for and are correctly absent from this list.
 */
export const copyFields = ["identifier"] as const;

const extractor: Extractor = {
  factType,
  version,
  subjectType,
  schema,
  prompt,
  copyFields,
  expectedJobs,
};
export default extractor;
