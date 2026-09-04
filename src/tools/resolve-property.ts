/**
 * Turn what a caller said into a property — or into the next question.
 *
 * This tool is the safety boundary of the whole system. It never returns "the"
 * property; it returns what it found and how sure it is, so the model is
 * structurally unable to act on a guess.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";
import { resolveProperty } from "../domain/resolve-property.js";

/**
 * How many times one call may fail to find an address before a person takes over.
 *
 * WHY THIS EXISTS, from a real call. A caller gave an address that is not in the
 * book. The agent tried "11 Sigma Drive", "2411 Sigma Drive", "24 Sigma Drive",
 * "11 Sigma", "24 11 Sigma", "Sigma Drive", "1 Sigma Drive", "10 Sigma Drive",
 * "12 Sigma Drive", "Sigma", "11 Sigman Drive", "11 Sygma Drive",
 * "11 Sigmund Drive", "24-11 Sigma Drive" — seventeen lookups across two
 * minutes, saying "just a sec" between each one. The caller heard a machine
 * stuck.
 *
 * The loop cap in src/agent/loop.ts did not help, because it only governs OUR
 * loop. On a phone call Vapi owns the loop and there is no step limit at all,
 * so the only place a stop can live is inside the tool itself. Same reasoning
 * as the emergency backstop: when the consequence is bad enough, the decision
 * is taken away from the model rather than asked of it.
 *
 * Three is deliberate. One miss is a mishearing worth a second try. Two is
 * worth confirming the street. By the third, the address is not in the book and
 * more guesses are just noise on the line.
 */
const MAX_MISSES = 3;

const schema = z.object({
  address: z.string().describe('The street as spoken, e.g. "550 Cormorant Reef" or "five fifty Cormorant Reef".'),
  unit: z.string().nullish().describe("Unit or apartment number, if the caller gave one."),
  lastName: z.string().nullish().describe("Caller's last name, if offered. Never enough on its own."),
  company: z.string().nullish().describe("Management company, if offered. Never enough on its own."),
});

export default defineTool({
  name: "resolve_property",
  description:
    "Find which property the caller means from the address they said. Use this before answering anything about visits, access, or money. " +
    "Returns either one confirmed property, or a request for the one more detail needed to be sure. " +
    "Never guesses between candidates — if it asks for the unit number, ask the caller for the unit number.",
  schema,
  handler: async (args, ctx) => {
    // Counted from the call record, not from memory: a phone call's webhooks
    // land on whatever serverless instance answers, so an in-process counter
    // would reset mid-loop and never fire.
    let misses = 0;
    if (ctx.callRowId) {
      const [row] = await ctx.sql`
        select count(*)::int as n from call_event
        where call_id = ${ctx.callRowId} and kind = 'tool' and tool_name = 'resolve_property'
          and result like 'NO MATCH%'
      `;
      misses = Number((row as { n: number } | undefined)?.n ?? 0);
    }

    if (misses >= MAX_MISSES) {
      // Do the handoff rather than ask for one. By this point the model has
      // demonstrated it will keep trying, so telling it to stop is not enough.
      const { getTool } = await import("./_registry.js");
      const handoff = getTool("handoff");
      const summary =
        `AUTOMATIC ESCALATION — ${misses} failed address lookups on this call. ` +
        `Last tried: "${args.address}". The address is not in the book.`;
      if (handoff) {
        await handoff.handler({ reason: "address not found", summary }, ctx);
      }

      // Put it on the call record too.
      //
      // An escalation the model did not choose is invisible otherwise: the
      // session only records a handoff when it sees the model call the tool,
      // and this one happened underneath. Handoff rate BY REASON is what says
      // what to fix next, so a backstop that fires silently would hide the
      // single most useful signal it produces.
      if (ctx.callRowId) {
        const { record } = await import("../calls/record.js");
        await record(ctx.sql, ctx.callRowId, {
          kind: "handoff",
          role: "agent",
          body: "address not found",
          meta: { automatic: true, misses, lastTried: args.address },
        });
      }
      return [
        `STOP SEARCHING. ${misses} lookups on this call have already failed, and a person is now taking over.`,
        `Do not call this tool again on this call. Do not try another spelling.`,
        `Tell the caller, in your own words: you cannot find that address in the records, you have asked`,
        `a colleague to pick it up, and ask for a callback number and the best time to reach them.`,
      ].join("\n");
    }

    const r = await resolveProperty(
      { rawStreet: args.address, unit: args.unit ?? null, lastName: args.lastName ?? null, company: args.company ?? null },
      // The call's own connection: one round trip instead of four, and the
      // query lands in the trace where the office can see it.
      { limit: 8, sql: ctx.sql },
    );

    if (r.decision === "resolved") {
      const c = r.candidates[0]!;
      const last = c.lastVisitAt
        ? new Date(c.lastVisitAt).toLocaleDateString("en-US", { timeZone: "America/New_York" })
        : "no completed visit on record";
      // streetRaw sometimes already carries the unit ("… Rd unit 3116"), so
      // appending it again reads back as "unit 3116 unit 3116" on the phone.
      const hasUnitInline =
        !!c.unit && c.streetRaw.toLowerCase().includes(c.unit.toLowerCase());
      return [
        `RESOLVED property_id=${c.id}`,
        `${c.streetRaw}${c.unit && !hasUnitInline ? ` unit ${c.unit}` : ""}${c.city ? `, ${c.city}` : ""}`,
        `${c.visitCount} visit(s) on record. Last visit: ${last}.`,
        // Say when there is no unit to ask about.
        //
        // Without this the agent asks "is there a unit number I should note?"
        // at a single-property address that has never had one, which is
        // friction the caller cannot resolve and which burns a turn. The
        // resolver knows the answer; it should not make the model guess.
        c.unit
          ? `Unit ${c.unit} is on file for this property.`
          : `This is a single property at that address with no unit on file. Do not ask the caller for a unit number.`,
        `Confirm with the caller by stating the address and the last visit date before reading anything else back.`,
      ].join("\n");
    }

    if (r.decision === "needs_unit") {
      return [
        `AMBIGUOUS — ${r.totalCandidates} properties share that street address.`,
        `Ask the caller for the unit or apartment number. Do not read back any history yet.`,
        r.candidates.length <= 6
          ? `Units on file: ${r.candidates.map((c) => c.unit ?? "(no unit)").join(", ")}`
          : `There are too many units to list aloud.`,
      ].join("\n");
    }

    if (r.decision === "needs_more") {
      const ask =
        r.askFor === "street_number"
          ? "the house or building number"
          : r.askFor === "last_service_date"
            ? "roughly when someone was last out there"
            : "the street address";
      return `NOT ENOUGH TO IDENTIFY — ${r.reason}. Ask the caller for ${ask}. A name or company alone is never enough.`;
    }

    // Say how many tries are left, so the model can see the wall coming rather
    // than hit it. The instruction gets firmer as the count rises.
    const left = MAX_MISSES - misses - 1;
    const next =
      left <= 0
        ? `This was the last attempt. Stop searching, take a callback number, and call the handoff tool now.`
        : left === 1
          ? `One more attempt before this has to go to a person. Ask the caller to confirm the STREET NAME, spelled out, and the house number. Do not guess variations yourself.`
          : `Ask the caller to repeat the house number and street name. Do not invent spellings of your own.`;
    return [
      `NO MATCH — no property on file matches that. ${r.reason}`,
      `Records begin March 2026.`,
      next,
    ].join("\n");
  },
});
