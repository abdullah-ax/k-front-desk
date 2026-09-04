/**
 * Book a visit.
 *
 * Only ever at a property that resolve_property has already confirmed. The
 * property id is not something a caller can supply and not something the model
 * should carry from memory: the one failure that ends a pilot is work landing
 * on somebody else's address.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";
import { bookJob } from "../write/jobs.js";
import { resolveWhen } from "./_when.js";

const schema = z.object({
  propertyId: z.number().describe("The property_id that resolve_property returned. Never invent one."),
  problem: z.string().describe('What the caller says is wrong, in their words: "no cooling upstairs".'),
  day: z.string().nullish().describe('"today", "tomorrow", "Friday", "next Tuesday".'),
  timeOfDay: z.string().nullish().describe('"morning", "afternoon", "evening", or "first thing".'),
  hour24: z.number().nullish().describe("Only if the caller named an exact hour, in 24-hour form."),
});

export default defineTool({
  name: "book_job",
  description:
    "Book a new visit at a property that resolve_property has already confirmed. " +
    "Do not use it until you have a property_id from that tool, and never guess one. " +
    "Books the visit unassigned; the office picks the technician.",
  schema,
  handler: async (args, ctx) => {
    const [prop] = await ctx.sql`
      select id, street_raw, unit from property where id = ${args.propertyId}
    `;
    if (!prop) return `NO SUCH PROPERTY — resolve the address with resolve_property first and use the id it gives you.`;

    const when = resolveWhen(args);
    const result = await bookJob(
      { sql: ctx.sql, actor: "agent", callId: ctx.callRowId ?? null, actorLabel: "front desk agent" },
      {
        propertyId: args.propertyId,
        startsAt: when.startsAt,
        durationMinutes: when.durationMinutes,
        description: args.problem,
      },
    );

    const p = prop as { street_raw: string };
    return [
      `BOOKED job ${result.jobRef} at ${p.street_raw}.`,
      `Window: ${when.spoken}.`,
      `Nobody is assigned yet, so do not name a technician. Say the day and the window back to the caller.`,
    ].join("\n");
  },
});
