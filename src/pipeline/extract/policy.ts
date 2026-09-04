/**
 * Standing rules for a property or a customer.
 *
 * Serves caller question #12 of eda/01-notes-corpus.md §6 ("don't tell the
 * tenant what's wrong — call me"), and the commercial half of #13.
 *
 * THESE ARE RARE AND DECISIVE. There are only a handful in 6,954 notes, they
 * carry no tag, no field and no flag, and each one changes what the agent is
 * allowed to say or promise. Three real examples from the corpus:
 *
 *   "please make sure we are not speaking with the tenants about the issues,
 *    please let me know what you find and just let the tenants know it is being
 *    taken care of"                                                    — inv 4936
 *   "let him know that the last few calls have been free but the next step was a
 *    condensate pump if it happens again/ that we will not continue to clear
 *    the..."                                                           — inv 4660
 *   "(Caller said unit 1020; gate/door codes match [code] unit 1025 already in
 *    HCP. Guest phone does not override PMC record.)"                  — inv 5298
 *
 * The second one is a standing commercial commitment for one address: the last
 * few drain-clears were free and the next will not be. An agent that books a
 * fourth free drain-clearing there is not merely wrong, it is giving away money
 * and setting up an argument. Nothing in the structured data encodes any of this.
 *
 * NO GATE. Every other extractor with rare output gets a keyword pre-filter;
 * this one does not, because a policy can be phrased any way a frustrated
 * property manager types it and the whole value of the fact type is catching the
 * one that nobody would have thought to grep for. It is the cheapest extractor
 * to run wide and the most expensive one to miss.
 *
 * Subject is the PROPERTY, because that is what the agent resolves an inbound
 * call to. `scope` records whether the rule really belongs to the customer or
 * the whole account, so a later pass can widen it without re-extracting.
 *
 * VERSION 2 — PRECISION, NOT RECALL
 * Version 1 fired on 24 of the first 25 jobs. It was classifying door codes as
 * "access policy", estimate approvals as "commercial commitment", and "CALL when
 * there so he knows" as "communication policy" — ordinary one-visit facts that
 * three other extractors already own. Three real policies drowning in fifty
 * false ones is worse than none, because the agent is shown these before it
 * speaks and it cannot tell which is which.
 *
 * Three changes. The `access` kind was REMOVED — its existence invited the model
 * to file every door code here. `standing_evidence` was added: the model must
 * quote the words in the note that make the rule outlive this visit. And,
 * because asking politely was not enough — version 2 still fired on 48 of 60
 * jobs, once pairing a real disclosure rule with a snippet from a different
 * sentence — the quote is now VERIFIED (see `validate` below) and a keyword
 * gate was added.
 *
 * THE GATE IS A RELUCTANT COMPROMISE, AND IT COSTS RECALL
 * This extractor was designed with no gate, on the argument that a policy can be
 * phrased any way a frustrated property manager types it and the value is
 * catching the one nobody would grep for. That argument is still true. It lost
 * to a measurement: ungated, the model returned 104 rules over 60 jobs, and
 * three real policies buried under a hundred false ones is worse than none —
 * these are shown to the agent BEFORE it speaks, and it cannot tell them apart.
 * The gate admits 210 of 1,878 jobs on durability markers. A policy phrased
 * without any of those words is missed, and that is a known, recorded gap rather
 * than a hidden one.
 */
import { z } from "zod";
import type { Extractor } from "./_runner.js";

export const factType = "policy";
export const version = "4";
export const subjectType = "property" as const;

export const schema = z.object({
  rule: z
    .string()
    .describe("The standing rule stated plainly, in one sentence, in the note's own terms."),
  directive: z
    .string()
    .describe(
      "The rule as an instruction the voice agent can act on, imperative and unambiguous: " +
        "'Do not discuss the diagnosis with tenants; report to the property manager instead.'",
    ),
  kind: z
    .enum([
      "disclosure",
      "billing",
      "commercial_commitment",
      "identity_verification",
      "communication",
      "scheduling",
      "other",
    ])
    .catch("other")
    .describe(
      "disclosure: who may be told what. billing: who pays / who is invoiced. " +
        "commercial_commitment: a promise about charging or not charging. " +
        "identity_verification: whose word overrides whose on the record. " +
        "There is deliberately no 'access' kind — door codes and entry instructions " +
        "belong to the access extractor, not here.",
    ),
  standing_evidence: z
    .string()
    .nullable()
    .describe(
      "Copied VERBATIM from the note: the words that make this rule outlive today's " +
        "visit — 'always', 'going forward', 'from now on', 'we will not continue', " +
        "'does not override', 'make sure we are not', 'never', 'no charge'. This quote is " +
        "checked against the note and against that list, and the fact is discarded if it " +
        "does not appear or does not contain one of those words. If you cannot find such " +
        "words in the note, this is a one-off instruction and you must not emit it at all.",
    ),
  scope: z
    .enum(["property", "customer", "job"])
    .catch("property")
    .default("property")
    .describe(
      "How far the rule reaches. 'job' only when the note plainly limits it to this one visit; " +
        "if in doubt say property.",
    ),
  applies_to: z
    .string()
    .nullable()
    .describe("Who or what it constrains: 'tenants', 'the guest', 'this address'. null if general."),
});

export const prompt = `Extract STANDING RULES: instructions that govern how this customer or this property is handled
beyond the single visit being described.

THE DURABILITY TEST — apply it to every candidate before you emit anything:

    Would this still be true and still binding on a DIFFERENT visit, months from now,
    for a caller we have not met yet?

If the answer is no, it is not a policy. A door code is not a policy. An approved estimate is not
a policy. "Call when you get there" is not a policy. "Guests check out at 10 so go after" is not a
policy. Those are facts about one visit and three other extractors already collect them.

These are RARE. Fewer than one job in fifty has one. If you find yourself emitting a policy for
most jobs you are reading ordinary job notes as rules, and every false one you add buries a real
one — the agent is shown these before it opens its mouth and cannot tell them apart. An empty list
is the correct answer for the overwhelming majority of jobs, and it is the answer you should
expect to give.

A standing rule is any of:
  · DISCLOSURE — who may be told what. "please make sure we are not speaking with the tenants
    about the issues", "just let the tenants know it is being taken care of", "call me, not the guest".
  · BILLING — who is invoiced and in whose name. "Sending invoices directly to the owner",
    "Please put invoice in brothers name", "no card on file, do not run a card".
  · COMMERCIAL COMMITMENT — a promise about money that outlives this visit. "the last few calls
    have been free but the next step was a condensate pump if it happens again / we will not
    continue to clear the drain", "no dispatch fee for this account".
  · IDENTITY VERIFICATION — whose word counts. "Guest phone does not override PMC record."
  · ACCESS or SCHEDULING policy that recurs rather than describing today. "Always call the PM on
    the way — he has to meet you there since it is a Private rental", "never schedule before 10".
  · COMMUNICATION channel rules. "Only reach this owner through Breezeway", "text, do not call".

NOT a standing rule. Do not emit any of these, no matter how they are phrased:
  · a door code, gate code, lockbox location or entry instruction — the access extractor owns those.
  · a one-off instruction for today's visit: "call 15 min before you arrive", "CALL when there so
    he knows", "have to call to let him know you are there".
  · a scheduling constraint for this visit: "cannot go until after 10 when the guests check out".
  · an estimate being sent, approved, declined or thought about. "Homeowner approved the 2 system
    estimate" is a job status, not a policy.
  · a warranty claim being approved.
  · a diagnosis, a repair, a part order.
  · anything about what the equipment needs.
  · a rule you inferred from a pattern of behaviour. It must be STATED, in words you can quote
    into standing_evidence.

The 'directive' field is what a voice agent will be shown before it opens its mouth. Write it as a
plain imperative, and do not soften or generalise the source. If the note says the next drain clear
will be charged, the directive says exactly that and no more.

Examples:
  "please make sure we are not speaking with the tenants about the issues, please let me know what
   you find and just let the tenants know it is being taken care of"
     -> kind disclosure, scope property, applies_to "tenants",
        directive "Do not discuss findings with the tenants; report to the property manager and tell
        the tenants only that it is being taken care of."
  "let him know that the last few calls have been free but the next step was a condensate pump if it
   happens again/ that we will not continue to clear the"
     -> kind commercial_commitment, scope property,
        directive "Previous drain clears at this address were free; do not promise another free
        drain clear — the next step is a condensate pump."
  "Guest phone does not override PMC record."
     -> kind identity_verification, scope property,
        directive "A guest's phone number does not override the property-management record."`;

/**
 * Durability markers. A standing rule reaches past today's visit, and in this
 * corpus it does so with recognisable words: a prohibition, a promise about
 * money, a precedence rule, a routing instruction. Measured over the corpus:
 * 210 of 1,878 noted jobs pass.
 */
export const gate = (text: string): boolean =>
  /going forward|from now on|moving forward|will not continue|we do not|we don't|do not (speak|tell|discuss|contact|call|give|mention|share|schedule|book|run)|don't (speak|tell|discuss|contact|call|give|mention|share)|not speaking with|does not override|do not override|(have|has|were|was) been free|been free|no charge|free of charge|at no cost|always (call|contact|use|go|check)|never (call|contact|schedule|tell|give|use)|make sure (we|you) are not|make sure not to|standing|policy|per the owner|owner requests|owner asks that|only (speak|deal|communicate|contact|through)|directly to the owner|in .{0,12}name|do not want|does not want|doesn't want|prefers|preference|instead of the|not the (guest|tenant|renter)|bill to|bill-to/.test(
    text,
  );

/**
 * The prompt asks the model to quote the words that make the rule standing.
 * This checks that it did — the quote must actually appear in the note, and it
 * must carry a durability marker rather than being any old fragment.
 *
 * A soft prompt rule the model ignores costs precision invisibly. The same rule
 * here costs a rejection that gets counted and printed, which is the difference
 * between a quiet quality problem and a number in the run report.
 */
const DURABILITY =
  /going forward|from now on|moving forward|will not|won't|do not|don't|does not|never|always|no charge|free|override|make sure|policy|standing|prefer|only|directly|instead/i;

export const validate = (
  payload: Record<string, unknown>,
  ctx: { snippet: string; noteText: string },
): boolean => {
  const quote = payload["standing_evidence"];
  if (typeof quote !== "string" || quote.trim().length < 4) return false;
  const q = quote.trim();
  // Same tolerance the runner allows a snippet: the words must be there, the
  // whitespace between them need not be identical.
  const loose = q.split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  if (!new RegExp(loose, "i").test(ctx.noteText)) return false;
  return DURABILITY.test(q);
};

const extractor: Extractor = {
  factType,
  version,
  subjectType,
  schema,
  prompt,
  gate,
  validate,
};
export default extractor;
