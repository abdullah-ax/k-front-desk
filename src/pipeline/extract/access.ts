/**
 * Access & entry — how a technician actually gets in.
 *
 * Serves caller question #2 of eda/01-notes-corpus.md §6 ("what's the door code
 * / how does the tech get in?"), which is asked by the tech en route and by the
 * dispatcher, and is the single highest-volume prose-only fact in the corpus.
 *
 * MEASURED (eda/01-notes-corpus.md §2.5): 913 of 1,878 noted jobs carry access
 * information, 1,159 notes contain entry instructions, and the `[code]` token
 * appears in 1,072 notes across **869 jobs**. There is no access field anywhere
 * in the source schema — job keys are id, invoice_number, description,
 * work_status, work_timestamps, schedule, tags, lead_source, total_amount,
 * outstanding_balance, created_at, updated_at, canceled_at, customer, address,
 * assigned_employees, notes. Every one of these facts exists only as prose.
 *
 * TWO THINGS THIS EXTRACTOR MUST GET RIGHT
 *
 * 1. `[code]` means a code EXISTS and its digits were redacted from the export.
 *    It does not mean "unknown". value_known stays true.
 * 2. Nine notes read `Door code:` with a BLANK value, and one reads "Standing by
 *    for door code". Those are real operational gaps, not redactions. They must
 *    land as a row with value_known = false, so the agent knows to ASK rather
 *    than finding no row and assuming there is nothing to say.
 *
 * SHAPE: one row per fact, discriminated by `kind`. A door code, a lockbox
 * location, a vacancy and "guests are present" are four different rows, not one
 * object with eleven nullable fields — the agent reads them one at a time and a
 * flat row keeps each one's snippet pointing at its own words.
 *
 * Subject is the PROPERTY: a door code belongs to the place, not to the visit.
 * The job stays reachable through source_note_id -> note.job_id and payload.job_id.
 */
import { z } from "zod";
import type { CopyField, Extractor } from "./_runner.js";

export const factType = "access";
export const version = "2";
export const subjectType = "property" as const;
export const expectedJobs = 913;

export const schema = z.object({
  kind: z
    .enum([
      "door_code",
      "gate_code",
      "building_code",
      "elevator_code",
      "lockbox_code",
      "master_code",
      "alarm_code",
      "garage_code",
      "other_code",
      "lockbox_location",
      "key_handling",
      "vacancy",
      "guest_presence",
      "entry_instruction",
    ])
    // Every invented kind observed in this corpus was a code of some sort —
    // access_code, side_code, front_door_code, roof_access_code — so other_code
    // is the honest landing place, and `label` still carries what it opens.
    .catch("other_code")
    .describe("What kind of access fact this is. One row per fact."),
  value: z
    .string()
    .nullable()
    .describe(
      "For a *_code kind: the code exactly as written, which is normally the literal " +
        "string [code] because the export redacted the digits, and occasionally a plain " +
        "value the redactor missed such as NEN01. null for every non-code kind.",
    ),
  value_known: z
    .boolean()
    .nullable()
    .describe(
      "For a *_code kind ONLY. true when the note supplies a code (including the redacted " +
        "[code]). false when the note names a code but gives no value at all — a bare " +
        "'Door code:' with nothing after it, or 'Standing by for door code'. This is the " +
        "difference between 'we have it' and 'we must ask for it'. " +
        "null for every non-code kind, where it has no meaning.",
    ),
  label: z
    .string()
    .nullable()
    .describe(
      "Which door, gate or system this opens, as written: '1st fl bedroom closet', " +
        "'Community gate', 'air handler closet'. null when the note does not say.",
    ),
  detail: z
    .string()
    .nullable()
    .describe(
      "For non-code kinds, the instruction in plain words: where the lockbox is, who " +
        "holds the key, until when the unit is vacant, what to do on arrival. null otherwise.",
    ),
});

export const prompt = `Extract ACCESS AND ENTRY facts: everything a technician needs to physically get in.

Emit one row for each of these that the notes state:
  door_code, gate_code, building_code, elevator_code, lockbox_code, master_code, alarm_code,
  garage_code, other_code  — a code of any kind. Set value to the code exactly as written, and
                       always set value_known. Use other_code for anything that does not fit;
                       never invent a kind that is not in the list.
  lockbox_location   — where the lockbox physically is ("on the trim to the left of front door").
  key_handling       — who holds a key, where a key is left, keys to be collected or returned.
  vacancy            — the unit is vacant / empty / nobody there, with any stated end ("vacant until 4").
  guest_presence     — guests, tenants or the owner are in the home, or will be, or check in at a time.
  entry_instruction  — anything else needed to get in: who will meet the tech, "turn handle to right",
                       security to be notified, "if the door code does not work, reach out to X".

THE REDACTION RULE, which decides value_known:
  The export replaced real codes with the literal token [code]. Seeing "Door code: [code]" means
  WE HAVE THE CODE — set value to "[code]" and value_known to true.
  Seeing "Door code:" with nothing after it, or "Standing by for door code", or "we were unable to
  obtain the code" means WE DO NOT HAVE IT — set value to null and value_known to false. There are
  only about nine of these in the whole corpus and every one of them matters, because it is the
  difference between the agent reading a code back and the agent knowing it has to ask.
  For a kind that is not a code at all — lockbox_location, key_handling, vacancy, guest_presence,
  entry_instruction — leave value_known out entirely. It has no meaning there.

Do not emit a row for a code that a note merely mentions in the abstract ("codes are in HCP").
Do not merge two codes into one row: "Gate code: [code] / Door code: [code]" is two rows with two
different snippets.

Examples of real notes and what they yield:
  "Unit is not cooling / Unit is vacant until 4 / Gate code: [code] / Door code: [code]"
     -> vacancy (detail "vacant until 4"), gate_code "[code]", door_code "[code]" — three rows.
  "Lock box code [code]. Guests are in house but are aware you will be coming! / Lock box is
   located on the trim to the left of front door on the side of the house."
     -> lockbox_code, guest_presence, lockbox_location — three rows.
  "Door code is [code], turn handle to right. I'll let Security know Pace will be there."
     -> door_code, entry_instruction ("turn handle to right"), entry_instruction (security notified).
  "1st fl bedroom closet code: NEN01"
     -> other_code, value "NEN01", label "1st fl bedroom closet".
  "Office info: if door code does not [unclear-term], we have to reach out to Mariah or Cheyenne"
     -> entry_instruction.`;

/**
 * Loose on purpose. Access language is formulaic ("code", "key", "gate",
 * "lockbox", "vacant", "guests") and this gate only has to be wrong in the safe
 * direction. It skips roughly the third of jobs whose notes are pure diagnosis
 * and billing, at a cost of one keyword's worth of recall.
 */
export const gate = (text: string): boolean =>
  /\bcode\b|lock ?box|\bkeys?\b|\bgate\b|vacant|guest|tenant|\bentry\b|access|\bdoor\b|garage|alarm|combo|elevator|let (you|them|him|her) in|on ?site|meet (the )?tech/.test(
    text,
  );

/**
 * THE ONE FIELD THAT CAN LOCK A TECHNICIAN OUT.
 *
 * `value` is checked against the SNIPPET, not against the whole note, and it is
 * the only copy-field in this directory that is. The note scope is too weak
 * here: note 40224 reads `Door code:` with nothing after it and carries a
 * `[code]` token further down for a DIFFERENT door, so a note-scoped check
 * passes a row that answers "what is the code for this door" with a code that
 * is not the code for this door. The snippet is the span that makes the claim,
 * so the code has to be in the span.
 *
 * When it is not, `value_known` goes to false along with it. That is the whole
 * point of the exception: an agent that says "I do not have the code, let me get
 * it for you" is safe, and an agent that reads back a code that does not exist
 * sends a technician to a door that will not open. Measured over the 2,775 rows
 * version 2 wrote, twelve rows claimed a code their own citation does not
 * contain — including note 38416, whose entire text is "-Security will let you
 * in the gate", filed as gate_code with value "[code]", value_known true.
 *
 * `label` and `detail` are NOT declared. `label` is close to a quote and could
 * be argued in, but `detail` is explicitly a paraphrase ("the instruction in
 * plain words") and neither can send anyone to a door: a wrong label is a
 * confusing answer, a wrong code is a locked-out technician. Left out until
 * there is a measurement that says otherwise.
 */
export const copyFields: readonly CopyField[] = [
  {
    field: "value",
    in: "snippet",
    when: (p) => p.value_known === true,
    alsoSet: { value_known: false },
  },
];

const extractor: Extractor = {
  factType,
  version,
  subjectType,
  schema,
  prompt,
  gate,
  copyFields,
  expectedJobs,
};
export default extractor;
