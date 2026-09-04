/**
 * Write something the caller said onto the job.
 *
 * The incumbent bot wrote 89 notes and every one of them stops at the words
 * "Call transcript:" with nothing after. This is the opposite: what the caller
 * actually said, on the record, attributed to the agent so a person reading the
 * history a week later knows where it came from.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";
import { addNote } from "../write/jobs.js";

const schema = z.object({
  jobRef: z.string().describe('The job number from the service history, e.g. "4510".'),
  note: z.string().describe("What to record, in the caller's words. Keep it short and factual."),
});

export default defineTool({
  name: "add_note",
  description:
    "Record something the caller told you against a job, so the technician sees it. " +
    "Use it for access details, who to ask for, and what changed since the visit was booked. " +
    "Never record a price, a promise about warranty, or an entry code.",
  schema,
  handler: async (args, ctx) => {
    const [row] = await ctx.sql`
      select id, job_ref from job where job_ref = ${args.jobRef}
      order by scheduled_start desc nulls last limit 1
    `;
    if (!row) return `NO SUCH JOB — nothing on file with number ${args.jobRef}.`;
    await addNote(
      { sql: ctx.sql, actor: "agent", callId: ctx.callRowId ?? null, actorLabel: "front desk agent" },
      Number((row as { id: number }).id),
      args.note,
    );
    return `NOTED on job ${args.jobRef}. Tell the caller it is on the job for the technician.`;
  },
});
