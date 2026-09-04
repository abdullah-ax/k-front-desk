/**
 * The write path gate (.claude/prds/front-desk-platform.prd.md, milestone 1).
 *
 * What has to be true before any screen is worth building:
 *
 *   every change records what caused it        100%, or it is a failed gate
 *   an agent change can be taken back          one call, restoring the old state
 *   undo appends, never deletes                the record of the mistake survives
 *   a started job cannot be rewritten          the window closes when work begins
 *
 * The last one is the safety property. Undo that reaches a job a technician is
 * already standing in front of is worse than no undo at all.
 *
 * Everything here operates on rows this test creates and then removes, so it
 * runs against the real database without changing the book.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openCallConnection, closeDb, type Sql } from "../src/db/client.js";
import {
  bookJob, moveJob, cancelJob, addNote, assignJob, markLate, undoChange,
  refreshPropertyRollup, UNDO_WINDOW_MS, isUndoable, type WriteContext,
} from "../src/write/jobs.js";
import { openCall, endCall } from "../src/calls/record.js";

let conn: Awaited<ReturnType<typeof openCallConnection>>;
let sql: Sql;
let ctx: WriteContext;
let callId: number;
let propertyId: number;
let employeeId: number;
const madeJobs: number[] = [];
const madeTickets: number[] = [];

beforeAll(async () => {
  conn = await openCallConnection();
  sql = conn.sql;

  const [p] = await sql`select id from property order by visit_count desc limit 1`;
  propertyId = Number((p as { id: number }).id);
  const [e] = await sql`select id from employee where role = 'field tech' limit 1`;
  employeeId = Number((e as { id: number }).id);

  callId = await openCall(sql, {
    providerCallId: `test_write_${Date.now()}`,
    channel: "web",
    callerLabel: "write-path gate",
  });
  ctx = { sql, actor: "agent", callId, actorLabel: "gate" };
}, 60_000);

afterAll(async () => {
  // Leave the book exactly as it was found.
  //
  // Including the property rollup. Booking a job increments visit_count, and
  // deleting the row afterwards does not put it back, because a raw delete
  // bypasses the write path that keeps those columns honest. Without this the
  // derived-column gate fails on a property this test has never heard of,
  // hours later, for no visible reason.
  for (const id of madeJobs) {
    await sql`delete from call_event where job_id = ${id}`;
    await sql`delete from job_change where job_id = ${id}`;
    await sql`delete from note where job_id = ${id}`;
    await sql`delete from job_employee where job_id = ${id}`;
    await sql`delete from job where id = ${id}`;
  }
  for (const id of madeTickets) await sql`delete from ticket where id = ${id}`;
  await refreshPropertyRollup(sql, propertyId);
  await endCall(sql, callId, "test");
  await sql`delete from call_event where call_id = ${callId}`;
  await sql`delete from "call" where id = ${callId}`;
  await conn?.release();
  await closeDb();
}, 60_000);

describe("every change carries its cause", () => {
  it("books a job and files the change against the call", async () => {
    const at = new Date(Date.now() + 24 * 3600_000);
    const r = await bookJob(ctx, {
      propertyId, startsAt: at, description: "No cooling, third floor", employeeId,
    });
    madeJobs.push(r.jobId);

    expect(r.jobRef).toMatch(/^\d+$/);
    const [row] = await sql`
      select call_id, actor, kind, summary from job_change where id = ${r.changeId}
    `;
    const change = row as { call_id: number; actor: string; kind: string };
    expect(Number(change.call_id)).toBe(callId);
    expect(change.actor).toBe("agent");
    expect(change.kind).toBe("book");
  }, 60_000);

  it("refuses to leave a change without a cause when the agent made it", async () => {
    // The metric is 100%: an agent change nobody can explain is a failed gate,
    // not a warning. Since 0005 there are two acceptable explanations — the
    // call that caused it, or the board ticket that did (low-risk tickets the
    // agent runs on its own have no call). Neither is still forbidden.
    //
    // This assertion used to read `call_id is null` alone, which was correct
    // when a call was the only possible cause and became a time bomb the
    // moment the first low-risk ticket ran: it would have gone red on the
    // deployment, not here, for a change that is entirely legitimate.
    const rows = await sql`
      select count(*)::int as n from job_change
      where actor = 'agent' and call_id is null and ticket_id is null
    `;
    expect(Number((rows[0] as { n: number }).n)).toBe(0);
  }, 60_000);

  it("throws rather than writing an agent change with neither a call nor a ticket", async () => {
    // The shape check above proves the table is clean; this proves the guard
    // is what keeps it that way. A check that cannot fail is not a check.
    const orphan = { sql, actor: "agent" as const, actorLabel: "no cause at all" };
    await expect(
      bookJob(orphan, { propertyId, startsAt: new Date(Date.now() + 36 * 3600_000), description: "Orphan" }),
    ).rejects.toThrow(/call or the ticket/i);
  }, 60_000);

  it("accepts an agent change carried by a ticket instead of a call", async () => {
    const [t] = await sql`
      insert into ticket (tenant_id, source, kind, goal, why, steps, facts, risks, gaps, close_condition, risk)
      values (current_setting('app.tenant_id', true), 'board', 'test_guard', 'Guard test',
              'Proves a ticket is an acceptable cause', ${sql.json([])}, ${sql.json([])},
              ${sql.json([])}, ${sql.json([])}, 'closes immediately', 'low')
      returning id
    `;
    const ticketId = Number((t as { id: number }).id);
    madeTickets.push(ticketId);

    const booked = await bookJob(
      { sql, actor: "agent", ticketId, actorLabel: `agent, low risk, ticket #${ticketId}` },
      { propertyId, startsAt: new Date(Date.now() + 30 * 3600_000), description: "Ticket-caused booking" },
    );
    madeJobs.push(booked.jobId);

    const [row] = await sql`select call_id, ticket_id, actor from job_change where id = ${booked.changeId}`;
    const change = row as { call_id: number | null; ticket_id: number; actor: string };
    expect(change.call_id).toBeNull();
    expect(Number(change.ticket_id)).toBe(ticketId);
    expect(change.actor).toBe("agent");
  }, 60_000);
});

describe("moving, cancelling, noting and assigning", () => {
  it("moves a job and keeps the old window in the change", async () => {
    const at = new Date(Date.now() + 48 * 3600_000);
    const booked = await bookJob(ctx, { propertyId, startsAt: at, description: "PM visit" });
    madeJobs.push(booked.jobId);

    const to = new Date(Date.now() + 72 * 3600_000);
    const moved = await moveJob(ctx, booked.jobId, to);
    const [row] = await sql`select before, after from job_change where id = ${moved.changeId}`;
    const c = row as { before: Record<string, string>; after: Record<string, string> };

    expect(new Date(c.before["scheduled_start"]!).getTime()).toBeCloseTo(at.getTime(), -4);
    expect(new Date(c.after["scheduled_start"]!).getTime()).toBeCloseTo(to.getTime(), -4);
  }, 60_000);

  it("appends a note rather than editing one", async () => {
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 3600_000), description: "Note test",
    });
    madeJobs.push(booked.jobId);

    const before = await sql`select count(*)::int as n from note where job_id = ${booked.jobId}`;
    await addNote(ctx, booked.jobId, "Caller says the tenant works nights.");
    await addNote(ctx, booked.jobId, "Correction: the tenant works mornings.");
    const after = await sql`select count(*)::int as n from note where job_id = ${booked.jobId}`;

    // Two notes, not one edited. The correction sits beside the mistake.
    expect(Number((after[0] as { n: number }).n) - Number((before[0] as { n: number }).n)).toBe(2);
  }, 60_000);

  it("marks an agent note so the history says who wrote it", async () => {
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 3600_000), description: "Attribution test",
    });
    madeJobs.push(booked.jobId);
    const { noteId } = await addNote(ctx, booked.jobId, "Moved at the caller's request.");
    const [n] = await sql`select content from note where id = ${noteId}`;
    expect((n as { content: string }).content.startsWith("[agent] ")).toBe(true);
  }, 60_000);

  it("reassigns, and records who held it before", async () => {
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 3600_000), description: "Assign test", employeeId,
    });
    madeJobs.push(booked.jobId);

    const [other] = await sql`
      select id from employee where role = 'field tech' and id <> ${employeeId} limit 1
    `;
    const otherId = Number((other as { id: number }).id);
    const r = await assignJob(ctx, booked.jobId, otherId);

    const [row] = await sql`select before, after from job_change where id = ${r.changeId}`;
    const c = row as { before: { assigned: number[] }; after: { assigned: number[] } };
    expect(c.before.assigned.map(Number)).toContain(employeeId);
    expect(c.after.assigned.map(Number)).toContain(otherId);
  }, 60_000);

  it("running late writes a note the office can read back to the customer", async () => {
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 3600_000), description: "Late test", employeeId,
    });
    madeJobs.push(booked.jobId);
    await markLate({ ...ctx, actor: "office", actorLabel: "Alina Farrell" }, booked.jobId, 45);
    const notes = await sql`select content from note where job_id = ${booked.jobId}`;
    expect(notes.map((n) => (n as { content: string }).content).join(" ")).toContain("45");
  }, 60_000);
});

describe("undo", () => {
  it("restores the state a move came from", async () => {
    const at = new Date(Date.now() + 24 * 3600_000);
    const booked = await bookJob(ctx, { propertyId, startsAt: at, description: "Undo test" });
    madeJobs.push(booked.jobId);

    const to = new Date(Date.now() + 96 * 3600_000);
    const moved = await moveJob(ctx, booked.jobId, to);
    await undoChange({ ...ctx, actor: "office", actorLabel: "Alina Farrell" }, moved.changeId);

    const [job] = await sql`select scheduled_start from job where id = ${booked.jobId}`;
    const restored = new Date((job as { scheduled_start: Date }).scheduled_start).getTime();
    expect(restored).toBeCloseTo(at.getTime(), -4);
  }, 60_000);

  it("appends rather than deleting, so the mistake stays countable", async () => {
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 24 * 3600_000), description: "Append test",
    });
    madeJobs.push(booked.jobId);
    const moved = await moveJob(ctx, booked.jobId, new Date(Date.now() + 48 * 3600_000));
    await undoChange(ctx, moved.changeId);

    const [original] = await sql`select undone_at, undone_by from job_change where id = ${moved.changeId}`;
    expect((original as { undone_at: Date | null }).undone_at).not.toBeNull();

    const undos = await sql`
      select count(*)::int as n from job_change where job_id = ${booked.jobId} and kind = 'undo'
    `;
    expect(Number((undos[0] as { n: number }).n)).toBe(1);
  }, 60_000);

  it("refuses a second undo of the same change", async () => {
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 24 * 3600_000), description: "Double undo",
    });
    madeJobs.push(booked.jobId);
    const moved = await moveJob(ctx, booked.jobId, new Date(Date.now() + 48 * 3600_000));
    await undoChange(ctx, moved.changeId);
    await expect(undoChange(ctx, moved.changeId)).rejects.toThrow(/already undone/i);
  }, 60_000);

  it("closes the window once the technician has started", async () => {
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 24 * 3600_000), description: "Started job",
    });
    madeJobs.push(booked.jobId);
    const moved = await moveJob(ctx, booked.jobId, new Date(Date.now() + 48 * 3600_000));

    await sql`update job set started_at = now() where id = ${booked.jobId}`;
    await expect(undoChange(ctx, moved.changeId)).rejects.toThrow(/already started/i);
  }, 60_000);

  it("closes the window once it has aged out", () => {
    const old = new Date(Date.now() - UNDO_WINDOW_MS - 1000);
    expect(isUndoable({ started_at: null }, old)).toBe(false);
    expect(isUndoable({ started_at: null }, new Date())).toBe(true);
    expect(isUndoable({ started_at: new Date() }, new Date())).toBe(false);
  });

  it("undoing a booking cancels it rather than erasing it", async () => {
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 24 * 3600_000), description: "Undo a booking",
    });
    madeJobs.push(booked.jobId);
    await undoChange(ctx, booked.changeId);
    const [job] = await sql`select is_canceled from job where id = ${booked.jobId}`;
    expect((job as { is_canceled: boolean }).is_canceled).toBe(true);
  }, 60_000);
});

describe("derived columns keep up with the writes", () => {
  it("a new booking moves the property's next visit", async () => {
    // These columns were only ever computed by the pipeline. The moment the
    // agent can book, they go stale, and they are exactly what the property
    // page and the agent's own dossier read for "when are you next out".
    const [before] = await sql`
      select next_visit_at, visit_count from property where id = ${propertyId}
    `;
    const soon = new Date(Date.now() + 2 * 3600_000);
    const booked = await bookJob(ctx, { propertyId, startsAt: soon, description: "Rollup test" });
    madeJobs.push(booked.jobId);

    const [after] = await sql`
      select next_visit_at, visit_count from property where id = ${propertyId}
    `;
    const b = before as { next_visit_at: Date | null; visit_count: number };
    const a = after as { next_visit_at: Date | null; visit_count: number };

    expect(Number(a.visit_count)).toBe(Number(b.visit_count) + 1);
    expect(a.next_visit_at).not.toBeNull();
    expect(new Date(a.next_visit_at!).getTime()).toBeLessThanOrEqual(soon.getTime() + 1000);
  }, 60_000);

  it("cancelling takes it back out of the count", async () => {
    const [before] = await sql`select visit_count from property where id = ${propertyId}`;
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 3 * 3600_000), description: "Rollup cancel",
    });
    madeJobs.push(booked.jobId);
    await cancelJob(ctx, booked.jobId, "no longer needed");
    const [after] = await sql`select visit_count from property where id = ${propertyId}`;
    expect(Number((after as { visit_count: number }).visit_count))
      .toBe(Number((before as { visit_count: number }).visit_count));
  }, 60_000);
});

describe("guards", () => {
  it("will not move a canceled job", async () => {
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 24 * 3600_000), description: "Cancel guard",
    });
    madeJobs.push(booked.jobId);
    await cancelJob(ctx, booked.jobId, "customer changed their mind");
    await expect(
      moveJob(ctx, booked.jobId, new Date(Date.now() + 48 * 3600_000)),
    ).rejects.toThrow(/canceled/i);
  }, 60_000);

  it("will not move a job the technician has already started, and leaves the time where it stood", async () => {
    // The scene the demo runs by name ("Will not move a visit already under
    // way") and the one the code was not actually keeping. The rule lived in
    // the agent's prompt, which is the wrong place for it: a dispatcher
    // dragging a block on the board reaches moveJob without ever having been
    // asked to be careful, and the move landed.
    //
    // Landing is the whole problem. isUndoable goes false the moment
    // started_at is set, so the change went through AND could not be taken
    // back — allowed and irreversible, the one combination this system exists
    // to make impossible.
    //
    // Hence the second assertion. A guard that throws after the update has
    // already run is not a guard, and only the row can tell the two apart.
    const at = new Date(Date.now() + 24 * 3600_000);
    const booked = await bookJob(ctx, {
      propertyId, startsAt: at, description: "Under way, move refused",
    });
    madeJobs.push(booked.jobId);
    await sql`update job set started_at = now() where id = ${booked.jobId}`;

    await expect(
      moveJob(ctx, booked.jobId, new Date(Date.now() + 48 * 3600_000)),
    ).rejects.toThrow(
      new RegExp(
        `Job ${booked.jobRef} is already under way — a technician is on site\\. It cannot be moved\\.`,
      ),
    );

    const [job] = await sql`select scheduled_start from job where id = ${booked.jobId}`;
    expect(new Date((job as { scheduled_start: Date }).scheduled_start).getTime())
      .toBeCloseTo(at.getTime(), -4);
  }, 60_000);

  it("will not move a finished job, and says finished rather than under way", async () => {
    // A finished visit fails the same rule for a different reason, and the
    // sentence has to say which one: "under way" tells a dispatcher to phone
    // the technician, "finished" tells them there is nothing left to move. The
    // completed check runs first for exactly that reason — a finished job has a
    // start time too, and would otherwise be described as still running to
    // someone deciding whether to interrupt.
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() - 4 * 3600_000),
      description: "Finished, move refused",
    });
    madeJobs.push(booked.jobId);
    await sql`
      update job set started_at = now() - interval '3 hours', completed_at = now() - interval '1 hour'
      where id = ${booked.jobId}
    `;

    await expect(
      moveJob(ctx, booked.jobId, new Date(Date.now() + 48 * 3600_000)),
    ).rejects.toThrow(/is already finished, so it cannot be moved\./);

    const [job] = await sql`select scheduled_start from job where id = ${booked.jobId}`;
    expect(new Date((job as { scheduled_start: Date }).scheduled_start).getTime())
      .toBeLessThan(Date.now());
  }, 60_000);

  it("will not reassign a started job, and leaves it with the technician who is on site", async () => {
    // Reassigning a visit in progress strands whoever is standing at the door:
    // the board stops showing it as theirs, and whoever picks it up inherits a
    // job someone else is halfway through.
    //
    // The throw alone proves nothing here either, and for a sharper reason than
    // on the move — assignJob deletes the existing job_employee row before it
    // inserts the new one, so a guard placed a few lines too late would
    // unassign the job on its way to refusing to reassign it.
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 24 * 3600_000),
      description: "Under way, reassign refused", employeeId,
    });
    madeJobs.push(booked.jobId);
    await sql`update job set started_at = now() where id = ${booked.jobId}`;

    const [other] = await sql`
      select id from employee where role = 'field tech' and id <> ${employeeId} limit 1
    `;
    await expect(
      assignJob(ctx, booked.jobId, Number((other as { id: number }).id)),
    ).rejects.toThrow(
      new RegExp(
        `Job ${booked.jobRef} is already under way — a technician is on site\\. It cannot be reassigned\\.`,
      ),
    );

    const held = await sql`select employee_id from job_employee where job_id = ${booked.jobId}`;
    expect(held.map((r) => Number((r as { employee_id: number }).employee_id))).toEqual([employeeId]);
  }, 60_000);

  it("cancels a job that is under way, because a customer can send a technician away", async () => {
    // The deliberate asymmetry, and the reason the guard takes a verb rather
    // than being one blanket rule. Moving or reassigning a visit in progress is
    // always a mistake. Cancelling one is a thing that genuinely happens: the
    // customer opens the door and says not today. Refusing it would leave the
    // office unable to record what everybody on the call can already see.
    //
    // Note what the shared rule costs here. started_at has closed the undo
    // window, so this cancellation stands — it is the one write the system
    // allows that cannot be taken back, which is the argument for a person
    // being the one to make it.
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 5 * 3600_000),
      description: "Under way, cancel allowed",
    });
    madeJobs.push(booked.jobId);
    await sql`update job set started_at = now() where id = ${booked.jobId}`;

    const r = await cancelJob(ctx, booked.jobId, "customer sent the technician away");
    expect(r.summary).toBe("Canceled: customer sent the technician away");
    expect(r.undoable).toBe(false);

    const [job] = await sql`select is_canceled from job where id = ${booked.jobId}`;
    expect((job as { is_canceled: boolean }).is_canceled).toBe(true);
  }, 60_000);

  it("will not cancel a finished job", async () => {
    // Where the asymmetry stops. Cancelling work that is already done does not
    // describe anything that happened to anybody; it only makes the invoice and
    // the history disagree, and the disagreement surfaces weeks later in front
    // of a customer.
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() - 4 * 3600_000),
      description: "Finished, cancel refused",
    });
    madeJobs.push(booked.jobId);
    await sql`
      update job set started_at = now() - interval '3 hours', completed_at = now() - interval '1 hour'
      where id = ${booked.jobId}
    `;

    await expect(
      cancelJob(ctx, booked.jobId, "caller changed their mind"),
    ).rejects.toThrow(/is already finished, so it cannot be canceled\./);

    const [job] = await sql`select is_canceled from job where id = ${booked.jobId}`;
    expect((job as { is_canceled: boolean }).is_canceled).toBe(false);
  }, 60_000);

  it("will not cancel an already canceled job, or file a second cancel against it", async () => {
    // Two cancellations of one visit read as two events on the timeline and two
    // offers of undo, for one thing that happened once. It is easy to hit for an
    // entirely ordinary reason: the caller phones back to check the
    // cancellation went through, and the agent obliges a second time.
    //
    // So the count matters as much as the throw. Refusing at the end, after the
    // change is filed, would leave the history saying it twice.
    const booked = await bookJob(ctx, {
      propertyId, startsAt: new Date(Date.now() + 6 * 3600_000), description: "Double cancel",
    });
    madeJobs.push(booked.jobId);
    await cancelJob(ctx, booked.jobId, "customer changed their mind");

    await expect(
      cancelJob(ctx, booked.jobId, "customer changed their mind again"),
    ).rejects.toThrow(/is already canceled\./);

    const cancels = await sql`
      select count(*)::int as n from job_change where job_id = ${booked.jobId} and kind = 'cancel'
    `;
    expect(Number((cancels[0] as { n: number }).n)).toBe(1);
  }, 60_000);

  it("still moves a job nobody has started, so the guard has not closed the board", async () => {
    // The failure mode of a safety rule is that it is too safe, and every test
    // above is a refusal — a guard that refused everything would pass all of
    // them. This is the ordinary Tuesday move the office makes all day, and it
    // has to still land, still be undoable, and still show up on the row.
    const at = new Date(Date.now() + 24 * 3600_000);
    const booked = await bookJob(ctx, {
      propertyId, startsAt: at, description: "Untouched, move allowed", employeeId,
    });
    madeJobs.push(booked.jobId);

    const to = new Date(Date.now() + 72 * 3600_000);
    const moved = await moveJob(ctx, booked.jobId, to);
    expect(moved.undoable).toBe(true);

    const [job] = await sql`select scheduled_start from job where id = ${booked.jobId}`;
    expect(new Date((job as { scheduled_start: Date }).scheduled_start).getTime())
      .toBeCloseTo(to.getTime(), -4);
  }, 60_000);

  it("will not touch a job that does not exist", async () => {
    await expect(moveJob(ctx, -1, new Date())).rejects.toThrow(/No job/);
  }, 30_000);
});
