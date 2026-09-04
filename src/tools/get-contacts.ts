/**
 * Who is actually involved at a property.
 *
 * 42.4% of jobs name a person who is not the customer of record, and 360 jobs
 * have a customer with no human name at all — only a company. The person on the
 * phone frequently exists nowhere in the customer table.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";
import { getPropertyDossier } from "../read/property-dossier.js";

export default defineTool({
  name: "get_contacts",
  description:
    "Everyone associated with a property: the billing account, the management company, the homeowner, and anyone named in the notes as the person to call. " +
    "Use when a caller says a name you do not recognise, or when you need to know who to contact rather than who pays.",
  schema: z.object({ property_id: z.number() }),
  handler: async (args, ctx) => {
    const d = await getPropertyDossier(args.property_id, ctx.sql);
    if (!d) return "No property with that id. Re-run resolve_property.";

    const lines = [`Parties at ${d.property.street}${d.property.unit ? ` unit ${d.property.unit}` : ""}:`];
    for (const c of d.customers) {
      lines.push(`  billing account: ${c.displayName} (${c.derivedKind.replace("_", " ")})${c.isPrimary ? " — primary" : ""}`);
    }
    for (const f of d.facts["contact"] ?? []) {
      const p = f.payload as Record<string, unknown>;
      lines.push(`  ${String(p["role"] ?? "contact")}: ${String(p["name"] ?? "unnamed")}   [from: "${f.snippet.trim()}"]`);
    }
    if (d.customers.length === 0 && !(d.facts["contact"] ?? []).length) {
      lines.push("  nobody on record — ask the caller who they are and their relationship to the property.");
    }
    return lines.join("\n");
  },
});
