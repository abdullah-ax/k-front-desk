/**
 * Part orders — supplier, part, quoted cost, ETA, warranty status.
 *
 * Serves caller question #6 of eda/01-notes-corpus.md §6 ("where is my part /
 * when is it coming in?"), which is what a homeowner rings about in the days
 * after a diagnosis.
 *
 * MEASURED (eda/01-notes-corpus.md §2.7): 247 notes across **187 jobs** mention
 * ordering. Supplier names are load-bearing and survived the anonymizer because
 * they are real companies: Mingledorffs / "Mingle" (83 notes), Air Engineers /
 * "AE" (86), Johnstone (40), Gemaire (34), Baker Bros.
 *
 * **Part ETAs live only here. There is no parts table in this dataset at all** —
 * no PO, no order status, no expected date. Which means an agent that cannot
 * read this back has literally nothing to say to the most predictable follow-up
 * call the company gets.
 *
 * COSTS AND DATES ARE COPIED, NEVER COMPUTED. "$2543 and 2-3 business days out"
 * is stored as the characters "$2543" and "2-3 business days out". The company
 * quotes out-the-door prices with tax handled differently by supplier, and a
 * date arithmetic error here becomes a promise on the phone.
 *
 * Subject is the JOB: a part is ordered for one visit's diagnosis, and the same
 * property may have three different parts in flight on three different jobs.
 */
import { z } from "zod";
import type { CopyField, Extractor } from "./_runner.js";

export const factType = "parts";
export const version = "2";
export const subjectType = "job" as const;
export const expectedJobs = 187;

export const schema = z.object({
  part: z
    .string()
    .nullable()
    .describe(
      "The part as named in the note: 'compressor', 'Evap coil and TXV', 'condenser fan motor'. " +
        "null when the note records an order or a quote without naming what it is for " +
        "('In stock with AE | Our cost 302.96').",
    ),
  supplier: z
    .string()
    .nullable()
    .describe(
      "The supply house, as written — Mingledorffs, Mingle, AE, Air Engineers, Johnstone, " +
        "Gemaire, Baker Bros — or the manufacturer when they are the source (Trane). null if unnamed.",
    ),
  status: z
    .enum([
      "quoted",
      "ordered",
      "in_stock",
      "backordered",
      "received",
      "installed",
      "wrong_part",
      "unknown",
    ])
    .catch("unknown")
    .describe("Where the part is in its life, according to this note only."),
  cost_text: z
    .string()
    .nullable()
    .describe(
      "The price EXACTLY as written, including any qualifier: '$2543', 'Our cost 302.96', " +
        "'$909 + tax and in stock'. Never a number you computed, never tax you added.",
    ),
  eta_text: z
    .string()
    .nullable()
    .describe(
      "The arrival estimate EXACTLY as written: 'should be here on 3/10', '2-3 business days out', " +
        "'next week'. Copy the characters; do not resolve a date.",
    ),
  order_date_text: z
    .string()
    .nullable()
    .describe("When it was ordered, as written ('on 3/9'). null when not stated."),
  is_warranty_part: z
    .boolean()
    .nullable()
    .describe(
      "true when the note says the part is coming under warranty, false when it says explicitly " +
        "that it is not, null when the note does not say. Do not guess.",
    ),
});

export const prompt = `Extract PART ORDERS: what was ordered or quoted, from whom, for how much, and when it is expected.

This is the only place in the company's records where a part ETA exists. Get the supplier and the
ETA right and the agent can answer "where is my part"; get them wrong and it invents a delivery date.

Emit one row per part. A note quoting three parts from two suppliers is three rows.

Copy costs and dates as CHARACTERS. "$909 + tax" stays "$909 + tax" — do not add the tax, do not
drop the qualifier, do not convert "2-3 business days out" into a date. "should be here on 3/10"
stays exactly that; the year is not stated and you must not supply one.

Supplier names in this corpus, as they are actually written:
  Mingledorffs, Mingledorff's, Mingle  ·  AE, Air Engineers  ·  Johnstone  ·  Gemaire  ·  Baker Bros
Manufacturers sometimes act as the source: Trane, Carrier, Daikin, Goodman, Rheem.

is_warranty_part: true only when the note says so ("(under warranty)", "they are warranty"),
false only when it says the opposite ("no longer under warranty, price out the door is $909"),
null otherwise. This field feeds a question the company gets asked constantly and must not be guessed.

Do NOT emit a row for:
  · a part that was diagnosed as needed but not ordered or quoted from anyone
  · a part fitted from the van with no order behind it, unless the note records the order
  · a whole-system replacement estimate — that is an estimate, not a part order.

Examples:
  "Ordered compressor with Mingledorffs on 3/9 (under warranty) should be here on 3/10 / [Will]
   schedule when part arrives"
     -> part "compressor", supplier "Mingledorffs", status ordered, order_date_text "on 3/9",
        eta_text "should be here on 3/10", is_warranty_part true.
  "Mingledorffs: Evap coil and TXV - $2543 and 2-3 business days out"
     -> part "Evap coil and TXV", supplier "Mingledorffs", status quoted, cost_text "$2543",
        eta_text "2-3 business days out".
  "Mingledorffs: compressor is no longer under warranty, price out the door is $909 + tax and in stock"
     -> part "compressor", supplier "Mingledorffs", status in_stock, cost_text "$909 + tax",
        is_warranty_part false.
  "Sent estimate- In stock with AE | Our cost 302.96"
     -> supplier "AE", status in_stock, cost_text "Our cost 302.96".
  "Parts were ordered and we have them since they are warranty, but they need to approve the
   estimate first."
     -> status received, is_warranty_part true.`;

/**
 * Ordering language is narrow and the target is only ~187 jobs, so a gate saves
 * roughly 78% of this extractor's cost. Supplier names are included so a bare
 * "Mingledorffs: Evap coil and TXV - $2543" with no verb still qualifies, and
 * "waiting on" / "coming in" are included because that is how the office writes
 * about a part it has not named.
 *
 * Measured over the corpus: 411 of 1,878 noted jobs pass, against a target of
 * ~187 jobs that actually mention ordering — comfortable headroom. A bare
 * `\bpart\b` was rejected: it dragged in 964 jobs, mostly "replaced the part"
 * with no order behind it. `arriv` was rejected for matching "Arrived for no
 * cool", the single most common tech phrase in the corpus (165 notes).
 */
export const gate = (text: string): boolean =>
  /order|backorder|mingle|johnstone|gemaire|air engineers|baker bros|in stock|out of stock|\beta\b|lead time|business days|shipped|will call|waiting on|com(e|es|ing) in|came in|\bpart[s]? (is|are|was|were|will|should|has|have|came|arriv)/.test(
    text,
  );

/**
 * Every field on this row except `status` and `is_warranty_part` is a QUOTE, and
 * the header above says so in capitals: costs and dates are copied, never
 * computed. The runner proves it — but NOT all at the same scope.
 *
 * SCOPE IS PER FIELD, AND THE SPLIT IS THE POINT.
 *
 * `part` is checked against the WHOLE JOB — every note on it, not just the one
 * the snippet came from. A job's notes are one narrative about one piece of
 * work: note 1 reads "Mingledorffs: Evap coil and TXV - $2543", note 2 reads
 * "OTD for both is $706", and a row citing the second while naming the part
 * from the first is reading this company's own record correctly. Note-scope
 * called that a fabrication. Naming the part ANYWHERE on the job is the
 * evidence, because there is one job and one part order in it.
 *
 * Everything else stays NOTE-scoped, and must. A price, an ETA, a supplier and
 * an order date are all claims about a specific transaction, and the note is
 * the unit that keeps them attached to it. Widening them is precisely how a
 * $1,394.67 quote covering a TXV *and* a defrost board gets stamped onto both
 * rows — the number is quotable from the job, so a job-scoped check waves it
 * through, and an agent reading both parts back to a caller quotes $2,789 for
 * work that costs $1,394.67. A part name repeated across notes is the same
 * part; a number repeated across notes is usually a different number.
 *
 * (`access.value` is tighter still — the snippet itself — and stays there.)
 *
 * MEASURED, on the 860 rows version 2 wrote before any of this: 166 suppliers,
 * 32 order dates, 25 ETAs and 14 costs are not in their note anywhere. The
 * supplier failures are the prompt talking back — 38 rows say "AE" and 33 say
 * "Mingledorffs", the two most prominent names in the supplier list the prompt
 * hands the model, on notes that name no supplier at all — and 31 more say the
 * literal word "unknown". A quoted supplier the agent reads out is a phone call
 * to the wrong supply house.
 *
 * `status` and `is_warranty_part` are deliberately absent: the prompt asks the
 * model to CLASSIFY those from what the note says, so they are not quotes and
 * proving them as quotes would delete correct values.
 */
export const copyFields: readonly CopyField[] = [
  { field: "part", in: "job" },
  { field: "supplier" },
  { field: "cost_text" },
  { field: "eta_text" },
  { field: "order_date_text" },
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
