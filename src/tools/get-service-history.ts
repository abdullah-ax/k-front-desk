/**
 * What happened at this property, and when.
 *
 * The modal question this business receives: nearly two thirds of jobs are at
 * an address already visited, with a median gap of 16 days.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";
import { getPropertyDossier, renderDossier } from "../read/property-dossier.js";

export default defineTool({
  name: "get_service_history",
  description:
    "Everything on record for one property: past visits with dates and what was done, who attended, and any standing instructions. " +
    "Use after resolve_property confirms which property. Quote what the office wrote rather than summarising it into something more confident.",
  schema: z.object({
    property_id: z.number().describe("The property_id returned by resolve_property."),
  }),
  handler: async (args, ctx) => {
    const d = await getPropertyDossier(args.property_id, ctx.sql);
    if (!d) return "No property with that id. Re-run resolve_property.";
    if (!d.jobs.length) {
      return `${d.property.street} is on file but has no visits on record since March 2026. Say that plainly rather than implying there is no history at all.`;
    }
    return renderDossier(d);
  },
});
