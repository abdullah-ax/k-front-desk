/**
 * Write down who is on the phone.
 *
 * A caller rang the live number, said "My name is Josie", and the agent used
 * the name for the rest of the call and then forgot it the moment she hung up.
 * The next call from that number starts as a stranger again — which is exactly
 * what the office it replaced did badly.
 *
 * The name goes on the CALL, not on the property. 53.8% of this book's work
 * comes from property managers, so the person who rings is very often not the
 * account: writing "Josie" onto a building would be claiming something the
 * record does not know. What we do know is who rang this number, and that is
 * worth knowing next time.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";

const schema = z.object({
  name: z.string().describe('What the caller said their name is, e.g. "Josie". Their words, nothing added.'),
  company: z.string().optional().describe("The company they said they are with, if they gave one."),
});

export default defineTool({
  name: "remember_caller",
  description:
    "Write down who you are speaking to, the first time they say their name. " +
    "Next time this number rings you will already know them. " +
    "Call it once, as soon as you have a name — do not ask for one just to fill this in, " +
    "and never guess a name from the number or from a note.",
  schema,
  handler: async (args, ctx) => {
    const name = args.name.trim();
    if (!name) return "NOTHING TO RECORD — no name was given.";
    if (!ctx.callRowId) return "NOT RECORDED — this call has no record to write to.";
    const label = args.company?.trim() ? `${name} (${args.company.trim()})` : name;
    await ctx.sql`
      update "call" set caller_label = ${label} where id = ${ctx.callRowId}
    `;
    return `NOTED — this call is with ${label}. Do not thank them for the name; carry on.`;
  },
});
