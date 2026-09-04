/**
 * Stop and get a person.
 *
 * A handoff is a successful outcome. A confident wrong answer is the failure.
 * This is a real tool rather than an instruction so that handoffs are counted:
 * handoff rate BY REASON is the roadmap, written by actual callers.
 */
import { z } from "zod";
import { defineTool } from "./_registry.js";

const REASONS = [
  "ambiguous_identity",
  "install_or_replacement_quote",
  "warranty_decision",
  "discount_request",
  "repeat_visit_or_upset_caller",
  "safety",
  "access_code_unverified_caller",
  "repeated_failure_to_understand",
  "other",
] as const;

export default defineTool({
  name: "handoff",
  description:
    "Hand the call to a person. Use it whenever you are about to guess. Record what you already know so the caller does not repeat themselves, " +
    "then tell them specifically who will follow up and roughly when — 'someone will call you' is not good enough.",
  schema: z.object({
    reason: z.enum(REASONS).describe("Why you are stopping. Chosen from a fixed list so handoffs can be counted."),
    summary: z.string().describe("What you established: who is calling, which property, what they want. In one or two sentences."),
    property_id: z.number().nullish(),
  }),
  handler: async (args, ctx) => {
    await ctx.sql`
      insert into pipeline_run (tenant_id, task, status, detail)
      values (
        current_setting('app.tenant_id', true),
        'handoff',
        'ok',
        ${JSON.stringify({ callId: ctx.callId, ...args })}::jsonb
      )
    `;

    // A HANDOFF OPENS A TICKET.
    //
    // Until now it wrote one pipeline_run row and stopped, and the dispatcher's
    // rail derived a "call back" line from the reason stamped on the call. That
    // vanishes the moment the rail is cleared, and it carries none of the
    // context: who rang, about which building, what they wanted, what the agent
    // had already told them. Somebody picking it up an hour later had a phone
    // number and a word.
    //
    // The ticket is the durable version of the same promise. It names the job to
    // be done, quotes the reason, points at the call so the transcript is one
    // click away, and is HIGH risk by definition — a handoff exists precisely
    // because the agent decided it should not act alone.
    try {
      // THREE THINGS THAT MUST NOT FILE A CALLBACK.
      //
      // No call to point at: the ticket would read "Call the caller back" with
      // nothing behind it — no number, no transcript, no property. Five of those
      // reached the board.
      //
      // A rehearsal: the scripted demo hands off on purpose, several times a
      // run, and each one was filing real work for somebody to do. Eleven of
      // seventeen callbacks on the board came from the test line.
      //
      // A callback already open on this call: one conversation is one thing to
      // ring back about, however many times the agent decides to hand over.
      if (!ctx.callRowId) throw new Error("no call to attach");
      const [c] = await ctx.sql`
        select channel, caller_label from "call" where id = ${ctx.callRowId}
      `;
      const chan = (c as { channel?: string } | undefined)?.channel;
      const lbl = (c as { caller_label?: string | null } | undefined)?.caller_label ?? "";
      if (chan === "web" && (lbl === "Test line" || /^demo:/i.test(lbl))) {
        throw new Error("rehearsal, not a customer");
      }
      const [dupe] = await ctx.sql`
        select id from ticket
        where kind = 'callback' and call_id = ${ctx.callRowId} and status = 'open' limit 1
      `;
      if (dupe) throw new Error("already filed for this call");

      const [prop] = ctx.propertyId
        ? await ctx.sql`select street_raw, unit from property where id = ${ctx.propertyId}`
        : [undefined];
      const where = prop
        ? `${(prop as { street_raw: string }).street_raw}${(prop as { unit?: string | null }).unit ? ` unit ${(prop as { unit: string }).unit}` : ""}`
        : null;
      const [who] = ctx.callRowId
        ? await ctx.sql`select caller_label, from_number from "call" where id = ${ctx.callRowId}`
        : [undefined];
      // The console labels a typed rehearsal "Test line", and the scripted demo
      // labels its calls "demo: <scene name>". Neither is a person. Left in,
      // they produced tickets reading "Call demo: A gas leak escalates whether
      // or not the model decides to back", which is not a job anybody can do.
      const label = who ? (who as { caller_label?: string | null }).caller_label : null;
      const named = label && label !== "Test line" && !/^demo:/i.test(label) ? label : null;
      const caller = who
        ? (named || (who as { from_number?: string | null }).from_number || null)
        : null;
      const reason = String(args.reason).replace(/_/g, " ");

      await ctx.sql`
        insert into ticket (
          tenant_id, source, kind, call_id, goal, why,
          steps, facts, risks, gaps, close_condition, risk, status
        ) values (
          current_setting('app.tenant_id', true), 'call', 'callback',
          ${ctx.callRowId ?? null},
          ${`Call ${caller ?? "the caller"} back${where ? ` about ${where}` : ""}`},
          ${`The agent handed this over: ${reason}. ${args.summary}`.slice(0, 900)},
          ${ctx.sql.json([{ tool: "call_back", why: reason }] as never)},
          ${ctx.sql.json(
            [
              where ? { label: "Property", value: where } : null,
              caller ? { label: "Caller", value: caller } : null,
              { label: "Why it stopped", value: reason },
            ].filter(Boolean) as never,
          )},
          ${ctx.sql.json(["Nobody has spoken to this caller since the agent handed over."] as never)},
          ${ctx.sql.json([] as never)},
          ${"Somebody has called them back."},
          'high', 'open'
        )
      `;
    } catch {
      // A handoff must never fail because the follow-up could not be filed. The
      // caller is told a person is coming either way, and the call still carries
      // the reason.
    }
    return [
      "Handoff recorded.",
      "Tell the caller you are getting someone who can help, repeat back what you have already noted so they do not have to say it twice,",
      "and give them a specific expectation for the callback.",
    ].join(" ");
  },
});
