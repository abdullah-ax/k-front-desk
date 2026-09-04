/**
 * Move a visit.
 *
 * "It can't move an appointment" is one of the five things the owner said out
 * loud. This is that, and it is the tool the demo turns on: a block moves on
 * the board while the caller is still talking.
 *
 * It does not write straight into the record. It files a change with the call
 * attached, which the office can take back in one click until the technician
 * starts the job.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";
import { moveJob } from "../write/jobs.js";
import { resolveWhen } from "./_when.js";
import { TZ } from "../config.js";

const schema = z.object({
  jobRef: z.string().describe('The job number, e.g. "4510". Get it from the service history first.'),
  day: z.string().nullish().describe('What the caller said: "Friday", "tomorrow", "next Tuesday".'),
  timeOfDay: z.string().nullish().describe('"morning", "afternoon", "evening", or "first thing".'),
  hour24: z.number().nullish().describe("Only if the caller named an exact hour, in 24-hour form."),
});

export default defineTool({
  name: "move_job",
  description:
    "Move an existing visit to a different day or time. Use the job number from the service history, never a guess. " +
    "Say the new window back to the caller in full after this succeeds. " +
    "Refuses on a canceled job and on a job that is already under way.",
  schema,
  handler: async (args, ctx) => {
    const [row] = await ctx.sql`
      select j.id, j.job_ref, j.is_canceled, j.started_at, j.property_id, p.street_raw
      from job j left join property p on p.id = j.property_id
      where j.job_ref = ${args.jobRef}
      order by j.scheduled_start desc nulls last limit 1
    `;
    if (!row) return `NO SUCH JOB — nothing on file with number ${args.jobRef}. Read the service history again and use a number from it.`;

    const job = row as {
      id: number; is_canceled: boolean; started_at: Date | null;
      street_raw: string; property_id: number | null;
    };

    // When the named visit cannot move, say which ones can.
    //
    // Without this the agent hits a dead end and hands off, which on the
    // busiest properties is the common case: a caller says "move the visit"
    // meaning the one that has not happened yet, while the most recent job at
    // that address is today's, already under way. Naming the movable visits
    // turns a refusal into the next question.
    const movable = async (): Promise<string> => {
      if (!job.property_id) return "";
      const rows = await ctx.sql`
        select job_ref, scheduled_start from job
        where property_id = ${job.property_id} and started_at is null
          and not is_canceled and scheduled_start > now()
        order by scheduled_start limit 4
      `;
      const list = (rows as unknown as { job_ref: string; scheduled_start: Date }[]).map(
        (r) => `${r.job_ref} on ${r.scheduled_start.toLocaleDateString("en-US", {
          timeZone: TZ, weekday: "long", month: "long", day: "numeric",
        })}`,
      );
      return list.length
        ? `\nVisits at this address that CAN still be moved: ${list.join("; ")}. Ask the caller which one they mean.`
        : `\nThere is no upcoming visit at this address to move. Offer to book a new one.`;
    };

    if (job.is_canceled) {
      return `CANNOT MOVE — job ${args.jobRef} is canceled.${await movable()}`;
    }
    if (job.started_at) {
      return `CANNOT MOVE — the technician has already started job ${args.jobRef}.${await movable()}`;
    }

    const when = resolveWhen(args);
    const result = await moveJob(
      { sql: ctx.sql, actor: "agent", callId: ctx.callRowId ?? null, actorLabel: "front desk agent" },
      Number(job.id),
      when.startsAt,
      when.durationMinutes,
    );

    const end = new Date(when.startsAt.getTime() + when.durationMinutes * 60_000)
      .toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
    if (result.changeId === -1) {
      return `ALREADY THERE — job ${result.jobRef} is already set for ${when.spoken}. Confirm that to the caller rather than moving it again.`;
    }

    return [
      `MOVED job ${result.jobRef} at ${job.street_raw}.`,
      `New window: ${when.spoken} to ${end}.`,
      `Say that window back to the caller in full, including the day.`,
    ].join("\n");
  },
});
