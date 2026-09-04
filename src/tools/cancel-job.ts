/**
 * Cancel a visit.
 *
 * Kept separate from move_job because they are different promises to a caller,
 * and because the previous bot's 77.5% cancellation rate is the reason anybody
 * is watching this system at all. A cancellation that nobody can explain later
 * is the exact failure being replaced.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";
import { cancelJob } from "../write/jobs.js";

const schema = z.object({
  jobRef: z.string().describe('The job number from the service history, e.g. "4510".'),
  reason: z.string().describe("Why, in the caller's own words. This is written into the record."),
});

export default defineTool({
  name: "cancel_job",
  description:
    "Cancel a scheduled visit at the caller's request. Always read the date and address back and get a clear yes before calling this. " +
    "Refuses on a job that is already under way.",
  schema,
  handler: async (args, ctx) => {
    const [row] = await ctx.sql`
      select j.id, j.job_ref, j.is_canceled, j.started_at, p.street_raw
      from job j left join property p on p.id = j.property_id
      where j.job_ref = ${args.jobRef}
      order by j.scheduled_start desc nulls last limit 1
    `;
    if (!row) return `NO SUCH JOB — nothing on file with number ${args.jobRef}.`;
    const job = row as { id: number; is_canceled: boolean; started_at: Date | null; street_raw: string };
    if (job.is_canceled) return `ALREADY CANCELED — job ${args.jobRef} was already canceled. Tell the caller it is off the schedule.`;
    if (job.started_at) return `CANNOT CANCEL — the technician has already started job ${args.jobRef}. Hand off to a person.`;

    const result = await cancelJob(
      { sql: ctx.sql, actor: "agent", callId: ctx.callRowId ?? null, actorLabel: "front desk agent" },
      Number(job.id),
      args.reason,
    );
    return `CANCELED job ${result.jobRef} at ${job.street_raw}. Confirm to the caller that it is off the schedule.`;
  },
});
