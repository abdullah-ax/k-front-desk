/**
 * What is genuinely owed.
 *
 * Excludes voided and canceled invoices. 68 of those still carry a due amount
 * totalling $268,433.84 of phantom debt — a naive sum would dun 33 customers
 * who owe nothing.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";
import { getPropertyDossier } from "../read/property-dossier.js";

export default defineTool({
  name: "get_balance",
  description:
    "The outstanding balance for a property, counting only live invoices. Use when a caller asks what they owe. " +
    "Never quote a price for future work from this — it is what has been billed, not what something will cost.",
  schema: z.object({ property_id: z.number() }),
  handler: async (args, ctx) => {
    const d = await getPropertyDossier(args.property_id, ctx.sql);
    if (!d) return "No property with that id. Re-run resolve_property.";

    if (d.balance.openCents <= 0) {
      return `Nothing outstanding for ${d.property.street}. All invoices on record are settled or voided.`;
    }
    const sent = d.balance.oldestSentAt
      ? new Date(d.balance.oldestSentAt).toLocaleDateString("en-US", { timeZone: "America/New_York" })
      : "not recorded";
    return [
      `${d.property.street} owes $${(d.balance.openCents / 100).toFixed(2)} across ${d.balance.openInvoices} open invoice(s).`,
      `Oldest sent: ${sent}. Voided invoices are excluded.`,
      `If the caller disputes it, hand off rather than negotiating.`,
    ].join("\n");
  },
});
