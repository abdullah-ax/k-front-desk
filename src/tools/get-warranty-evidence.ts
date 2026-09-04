/**
 * What the office has SAID about warranty — never a verdict.
 *
 * There is no equipment record in this business: no model, no serial, no
 * install date. 91% of warranty conversations concern equipment with no install
 * job on file. So this tool returns evidence and gaps, and the agent's job is to
 * relay and to capture what is missing, not to decide.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";
import { getPropertyDossier } from "../read/property-dossier.js";

export default defineTool({
  name: "get_warranty_evidence",
  description:
    "What this company has previously written about warranty coverage at a property, quoted verbatim, plus what is missing from the record. " +
    "This never returns a yes or no — there is no equipment database. Relay what was written, then offer to take the brand, model and serial from the label so it can be checked properly.",
  schema: z.object({ property_id: z.number() }),
  handler: async (args, ctx) => {
    const d = await getPropertyDossier(args.property_id, ctx.sql);
    if (!d) return "No property with that id. Re-run resolve_property.";

    const claims = d.facts["warranty"] ?? [];
    const header = `Warranty record for ${d.property.street}${d.property.unit ? ` unit ${d.property.unit}` : ""}:`;

    if (!claims.length) {
      return [
        header,
        "  Nothing on file about warranty at this property.",
        "  There is no equipment record in this system — no model, serial or install date.",
        "  Say you cannot confirm coverage on the phone, and offer to take the brand, model and serial off the data plate so it can be checked with the manufacturer.",
      ].join("\n");
    }

    return [
      header,
      ...claims.map((f) => `  "${f.snippet.trim()}"${f.jobRef ? `  (job #${f.jobRef})` : ""}`),
      "",
      "  That is what the office wrote — it is not a decision. Do not tell the caller they are or are not covered.",
      "  Offer to take the model and serial so it can be verified with the manufacturer.",
    ].join("\n");
  },
});
