/**
 * Secondary contacts — the human being served, who is usually not the customer
 * of record.
 *
 * Serves caller question #11 of eda/01-notes-corpus.md §6 ("who is the homeowner
 * at this rental?"), asked by techs and by billing.
 *
 * MEASURED (eda/01-notes-corpus.md §3): 845 jobs (42.4%) name a person who is
 * not the customer of record, and **360 jobs (18.1%) have a customer record with
 * no human name at all** — first_name and last_name both null, only a company:
 * Starfish Hospitality (159 jobs), Whitecap Hospitality (83), Tidewater
 * Hospitality (45), Palmetto Hospitality (18). For those the human being served
 * exists ONLY in a note, so this extractor is the only path to a name.
 *
 * WHY THIS IS THE RISKIEST EXTRACTOR
 * The export's anonymizer replaced phone numbers with plausible person names.
 * `Ruby Avery` is a phone number in 405 places; `Jasmine` is the modal verb
 * "will" in 239; `Tidewater Hospitality` is the word "work" or "test" in most of
 * its 914 occurrences (eda/01-notes-corpus.md §5.1). A contact extractor run over
 * raw text invents a customer named Ruby Avery with 311 jobs and the voice agent
 * reads it aloud. Everything here reads scrubbed text — the runner guarantees
 * that — and tests/extract-integrity.test.ts asserts that no stored contact name
 * matches ALWAYS_REWRITTEN_TOKENS.
 *
 * Subject is the PROPERTY: "who is the homeowner at 711 Amberjack Bluff" is a
 * question about the address, and 97 normalized addresses have more than one
 * customer over the window, so the customer record is the wrong key.
 */
import { z } from "zod";
import type { Extractor } from "./_runner.js";

export const factType = "contacts";
export const version = "2";
export const subjectType = "property" as const;
export const expectedJobs = 845;

export const schema = z.object({
  name: z
    .string()
    .nullable()
    .describe(
      "The person's name exactly as written. null when the note gives a role but no name " +
        "('the homeowner will be onsite'). Never a placeholder such as [phone] or [property-contact].",
    ),
  role: z
    .enum([
      "property_manager",
      "homeowner",
      "tenant",
      "guest",
      "bill_to",
      "our_staff",
      "other",
    ])
    .catch("other")
    .describe(
      "What this person is to the job. 'our_staff' is a Gulf Breeze Air employee named in the " +
        "note — record them so the agent does not mistake a dispatcher for the customer.",
    ),
  company: z
    .string()
    .nullable()
    .describe("The company they act for, when the note names one. null otherwise."),
  contact_instruction: z
    .string()
    .nullable()
    .describe(
      "A 'when calling, ask for X' / 'call N 15 minutes before arrival' / 'he has to meet you " +
        "there' instruction attached to this person. null when there is none.",
    ),
  has_phone: z
    .boolean()
    .default(false)
    .describe("true when the note gave a phone number for them (it will read as [phone])."),
  has_email: z
    .boolean()
    .default(false)
    .describe("true when the note gave an email for them (it will read as [email])."),
});

export const prompt = `Extract PEOPLE named or described in the notes who matter to this job, and what they are to it.

The customer on the record is very often a property-management company with no human name on it.
The person who actually owns the house, lets the tech in, or pays the bill is named only here.

Emit a row for:
  · a homeowner or owner named in the notes ("Owner is Lillian Cortez number: [phone]")
  · a property manager or their staff ("Followed up with Malcolm @ Tidewater Hospitality")
  · a tenant, renter or guest who will be on site
  · a bill-to party different from the customer ("Please put invoice in brothers name. Celeste Durham")
  · a Gulf Breeze Air employee named in the note — role our_staff
  · an unnamed party whose ROLE is stated and matters ("Homeowner will be onsite to let you in"):
    name null, role homeowner.

Attach any calling instruction to the person it is about: "Ask for Marie when calling [phone]",
"Please give Ellen a call 15 minutes before you arrive", "have to call PM on the way - he has to
meet you there since it is a Private rental".

HARD RULES:
  · NEVER emit a placeholder as a name. [phone], [email], [property-contact], [code],
    [unclear-term] and [redacted-identifier] are redactions, not people. If a note reads
    "PN: [phone]" there is no name there — set has_phone true on the person the phone belongs to,
    or emit nothing if no person is identified.
  · [property-contact] appears where the export conflated homeowner / owner / property manager.
    When you see it, do NOT pick one: emit role "other" with name null, or skip the row.
  · Do not invent a role. If the note says "Marisol" and nothing else, role is other.
  · Do not emit the same person twice from the same note.
  · A company name alone is not a contact. Only emit a row when there is a person, or a stated
    human role, involved in this job.

Examples:
  "Owner is Lillian Cortez number: [phone] email: [email] ** This is the owner of 711 Amberjack Bluff"
     -> name "Lillian Cortez", role homeowner, has_phone true, has_email true.
  "Getting the homeowner information / Eli Chavez / email: [email] / phone number: [phone]"
     -> name "Eli Chavez", role homeowner, has_phone true, has_email true.
  "Ask for Marie when calling [phone]"
     -> name "Marie", role other, contact_instruction "Ask for Marie when calling", has_phone true.
  "He has 4 AC units here... / Homeowner will be onsite to let you in"
     -> name null, role homeowner, contact_instruction "Homeowner will be onsite to let you in".
  "Sending invoices directly to the owner"
     -> name null, role bill_to, contact_instruction "Sending invoices directly to the owner".`;

/**
 * A name is a quote or it is nothing. The schema already says "exactly as
 * written", and the runner already refuses a name that is an anonymizer
 * artifact; this closes the other half — a name that is in no note at all.
 *
 * Measured over the 3,580 rows version 2 wrote: 40 names and 5 companies are
 * absent from their note, and 27 of the 40 are the four characters `null`, the
 * model typing the word instead of omitting the field. A voice agent asking for
 * "null" is the failure this stops.
 *
 * `role` is an inference the prompt explicitly asks for and is not declared.
 * `contact_instruction` is left out too: the examples show it both quoted
 * ("Ask for Marie when calling") and re-worded, so it is not reliably a copy and
 * declaring it would delete good instructions.
 */
export const copyFields = ["name", "company"] as const;

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
