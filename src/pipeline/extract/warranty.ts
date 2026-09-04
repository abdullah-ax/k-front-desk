/**
 * Warranty ASSERTIONS — what the notes claim, never what is true.
 *
 * Serves caller question #3 of eda/01-notes-corpus.md §6 ("is this still under
 * warranty?").
 *
 * MEASURED (eda/01-notes-corpus.md §2.9): 375 notes across **282–298 jobs**
 * carry warranty language — 209 notes say "under warranty", 101 say explicitly
 * NOT / no longer under warranty, 70 say "labor warranty", 33 mention
 * registration, 17 name a manufacturer near the word. Distributors consulted:
 * Mingledorff's (83 notes), Air Engineers / "AE" (86), Johnstone (40),
 * Gemaire (34).
 *
 * THE RULE THAT MATTERS MORE THAN THE SCHEMA
 * **Extract the claim and its source sentence. Never compute a verdict.**
 * There is no equipment record in this dataset — no model, no serial, no install
 * date on 98% of jobs — so "is it covered?" is not answerable from data, and a
 * voice agent that asserts coverage is inventing a commercial commitment. What
 * the platform can honestly do is repeat, with a citation, what the company
 * itself wrote down: "on 3 April a tech wrote 'no longer under warranty, expired
 * in 2021'". That is why `assertion` records what the NOTE SAYS, dates are kept
 * as written rather than parsed, and there is no boolean called `covered`.
 *
 * A real answer also needs the job's tags (1 Yr Labor Warranty on 53 jobs,
 * Warranty Claim on 46, Registration Needed on 56) and the 53 invoices carrying
 * a WARRANTY line item. This extractor supplies one of those three sources.
 *
 * Subject is the JOB: a warranty claim is made at a moment, about the equipment
 * that visit touched, and two visits to the same property can carry opposite
 * claims. Rolling it up to the property would silently pick a winner.
 *
 * VERSION 3 — "VERBATIM ASSERTIONS ONLY", ENFORCED
 * Version 2 produced 573 facts against a corpus that contains 375 warranty
 * notes, and the human sample caught why: given a job the gate admitted, the
 * model would file ordinary findings as warranty facts under assertion
 * "checking" — "we found the coil temperature sensor also needs replacement"
 * became a warranty row. It also filed Mingledorff's, a DISTRIBUTOR, as the
 * manufacturer.
 *
 * The fix is a `validate` that requires the snippet itself to contain a warranty
 * word. This extractor's whole remit is verbatim assertions, so a citation with
 * no warranty word in it is not an assertion about warranty by definition — and
 * that makes the rule machine-checkable rather than a request. The distributor
 * list is now stated as an exclusion in the prompt as well as an inclusion.
 */
import { z } from "zod";
import type { Extractor } from "./_runner.js";

export const factType = "warranty";
export const version = "3";
export const subjectType = "job" as const;
export const expectedJobs = 282;

export const schema = z.object({
  claim: z
    .string()
    .describe(
      "The assertion in the note's own terms, e.g. 'no longer under warranty (expired in 2021)', " +
        "'never registered', 'should be under warranty'. A restatement, not an interpretation.",
    ),
  assertion: z
    .enum([
      "under_warranty",
      "not_under_warranty",
      "expired",
      "never_registered",
      "registration_needed",
      "registration_complete",
      "labor_warranty",
      "warranty_claim_filed",
      "checking",
      "unclear",
    ])
    .catch("unclear")
    .describe(
      "WHAT THE NOTE SAYS, not what is true. 'checking' when the note records that someone is " +
        "still finding out ('Still waiting on Trane to get back with information'). " +
        "'unclear' when warranty is discussed but no position is stated.",
    ),
  hedged: z
    .boolean()
    .default(false)
    .describe(
      "true when the note itself hedges — 'should be under warranty', 'believe it is covered', " +
        "'if it is under warranty'. A hedge in the source must survive into the record, because " +
        "the agent will be quoting it to someone who will hold us to it.",
    ),
  scope: z
    .string()
    .nullable()
    .describe(
      "What the claim covers, as written: 'compressor', 'the 2nd floor unit', 'parts', " +
        "'labor', 'both units'. null when the note does not say.",
    ),
  date_text: z
    .string()
    .nullable()
    .describe(
      "Any date or period exactly as written — '6/2026', 'expired in 2021', '1 year'. " +
        "Copy the characters. Do NOT convert, complete or reason about it.",
    ),
  manufacturer: z
    .string()
    .nullable()
    .describe(
      "Equipment MANUFACTURER named in connection with the claim: Trane, Daikin, Carrier, " +
        "Goodman, Rheem, Amana, Mitsubishi, Bosch, York. Mingledorffs, AE / Air Engineers, " +
        "Johnstone, Gemaire and Baker Bros are supply houses, NOT manufacturers — they go in " +
        "`distributor`. null when no manufacturer is named.",
    ),
  distributor: z
    .string()
    .nullable()
    .describe(
      "The supply house consulted about coverage, as written: Mingledorffs / Mingle, " +
        "AE / Air Engineers, Johnstone, Gemaire, Baker Bros.",
    ),
});

export const prompt = `Extract WARRANTY ASSERTIONS. You are recording what the company wrote down, not deciding anything.

THE ABSOLUTE RULE: never compute a verdict. Do not decide whether something is covered, do not
work out whether a date has passed, do not combine "installed 2019" with "10 year parts" to reach
a conclusion, do not resolve a contradiction between two notes. There is no equipment record in
this dataset at all, so any verdict you produce would be fabricated. Copy the claim, name its
source sentence in the snippet, and stop.

Emit a row for each assertion the notes make:
  · "under warranty", "still under warranty", "covered under the labor warranty"
  · an explicit denial: "not under warranty", "no longer under warranty", "out of warranty"
  · an expiry as written: "expired in 2021", "warranty until 6/2026"
  · registration status: "never registered", "needs to be registered", "registration complete"
  · a warranty claim being filed or a warranty part being ordered as warranty
  · someone still checking: "Still waiting on Trane to get back with information for compressor"

Set 'hedged' true whenever the note itself is tentative — "should be under warranty", "I believe",
"if it is covered", "he thinks". This distinction is the whole difference between a fact we can
repeat and a guess we must not.

'date_text' is copied characters, never a parsed date. "expired in 2021" stays "expired in 2021".

THE SNIPPET MUST CONTAIN A WARRANTY WORD. Your snippet has to be the span that actually makes the
warranty assertion, so it will contain one of: warranty, warranties, warrantied, registered,
registration, covered, coverage. A snippet without one of those words is not an assertion about
warranty, and the fact is discarded. This is checked, not requested.

Do NOT emit a row for:
  · a finding, a diagnosis or a needed repair that happens to appear on a job where warranty was
    discussed elsewhere. "we found the coil temperature sensor also needs replacement" is not a
    warranty assertion and must produce nothing.
  · a warranty on OUR work that is merely being offered in an estimate, unless the note asserts it
  · the word "warranty" appearing only in a line-item name with no claim attached
  · anything you had to infer.

Use assertion "checking" ONLY when the note says someone is actively finding out about warranty
("Still waiting on Trane to get back with information for compressor"). It is not a catch-all.

Examples:
  "Both units are not under warranty- never registered"
     -> two rows: not_under_warranty (scope "Both units") and never_registered.
  "2nd floor unit quote: Gemaire, 2 in stock, no longer under warranty (expired in 2021) $545.33"
     -> assertion expired, scope "2nd floor unit", date_text "expired in 2021", distributor "Gemaire".
  "Need to order replacement condenser fan motor should be under warranty."
     -> assertion under_warranty, hedged true, scope "replacement condenser fan motor".
  "Finally found the serial for the dehum - its Daikin brand and they said its no longer under warranty"
     -> assertion not_under_warranty, manufacturer "Daikin", scope "the dehum".
  "Ordered compressor with Mingledorffs on 3/9 (under warranty)"
     -> assertion under_warranty, scope "compressor", distributor "Mingledorffs".`;

/**
 * Warranty language is lexically distinctive, which makes a keyword gate safe
 * here in a way it would not be for, say, policy. The corpus target is ~282
 * jobs; this gate is tuned to admit comfortably more than that.
 */
export const gate = (text: string): boolean =>
  /warrant|registrat|register|mingle|johnstone|gemaire|air engineers|\bae\b|baker bros|covered under|out of warranty|labor warr/.test(
    text,
  );

/**
 * A warranty assertion cites words about warranty. Enforcing that on the SNIPPET
 * — the verbatim span, already proved to be real text — turns "verbatim
 * assertions only" from a prompt instruction into a condition the pipeline can
 * check, and it is what separates this extractor from a general note summariser.
 */
const WARRANTY_WORD = /warrant|registr|register|cover(ed|age)?\b/i;

export const validate = (
  _payload: Record<string, unknown>,
  ctx: { snippet: string; noteText: string },
): boolean => WARRANTY_WORD.test(ctx.snippet);

/**
 * The fields this extractor copies rather than concludes. `date_text` says
 * "Copy the characters. Do NOT convert, complete or reason about it" and a date
 * this pipeline invented is a warranty expiry the company never wrote down;
 * `manufacturer` and `distributor` are names, and version 3's own history is a
 * model filing Mingledorff's — a distributor — as the manufacturer.
 *
 * `claim` is excluded on purpose even though it is close to the text: the schema
 * calls it "a restatement, not an interpretation", and a restatement is by
 * definition not a substring. `assertion`, `hedged` and `scope` are readings of
 * the note, not quotes from it.
 *
 * Version 3 already proves this extractor's other machine-checkable rule (a
 * warranty word in the snippet) and stays version 3: like that fix, this changes
 * what happens to invalid output, not what valid output looks like.
 */
export const copyFields = ["date_text", "manufacturer", "distributor"] as const;

const extractor: Extractor = {
  factType,
  version,
  subjectType,
  schema,
  prompt,
  gate,
  validate,
  copyFields,
  expectedJobs,
};
export default extractor;
