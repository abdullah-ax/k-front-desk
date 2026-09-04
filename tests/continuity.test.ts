/**
 * Cross-call memory gate (src/calls/continuity.ts).
 *
 * The owner's ask: "if I close the call and call again... we can resume where
 * we left off given it's the same number." Two properties have to be true
 * before that is real rather than a demo trick:
 *
 *   a second call from the same number sees the first     persistence
 *   a call from a DIFFERENT number never sees it           isolation
 *
 * The second one is not a nice-to-have. Getting it wrong would mean one
 * caller's business quietly leaking into a stranger's conversation because
 * they happened to call around the same time — worse than building nothing.
 *
 * No live model call anywhere in this file. Everything here is the plumbing —
 * the DB read, the redaction, the session wiring — and all of it is provably
 * correct without spending anything. Whether the model USES the context well
 * is a judgment call for a real or scripted call, not a thing to gate on here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openCallConnection, closeDb, type Sql } from "../src/db/client.js";
import { openCall, endCall, rememberSecrets, getKnownSecrets } from "../src/calls/record.js";
import { lastCallFrom, buildSummary } from "../src/calls/continuity.js";
import { startSession, finishSession, attachDossier } from "../src/calls/session.js";
import { priorCallContext } from "../src/agent/prompt.js";

let conn: Awaited<ReturnType<typeof openCallConnection>>;
let sql: Sql;
let propertyX: number;
let propertyY: number;
const madeCallIds: number[] = [];

const NUM_A = `+1305555${Date.now() % 10000}`;
const NUM_B = `+1305556${Date.now() % 10000}`;

beforeAll(async () => {
  conn = await openCallConnection();
  sql = conn.sql;

  // Two REAL, different properties — a property-manager number's history has
  // to span two genuinely distinct addresses for the address-first behaviour
  // to be provable, not just a null-vs-non-null check.
  const rows = await sql`select id from property order by visit_count desc limit 2`;
  const ids = (rows as unknown as { id: number }[]).map((r) => Number(r.id));
  propertyX = ids[0]!;
  propertyY = ids[1]!;
}, 60_000);

afterAll(async () => {
  for (const id of madeCallIds) {
    await sql`delete from call_event where call_id = ${id}`;
    await sql`delete from "call" where id = ${id}`;
  }
  await conn?.release();
  await closeDb();
});

/** Opens and immediately finishes a call from a number, with a summary. */
async function makeFinishedCall(
  fromNumber: string,
  summary: string,
  handoffReason: string | null = null,
  propertyId: number | null = null,
): Promise<number> {
  const id = await openCall(sql, {
    providerCallId: `test_cont_${fromNumber}_${Date.now()}_${Math.random()}`,
    channel: "phone",
    fromNumber,
  });
  madeCallIds.push(id);
  if (handoffReason) {
    await sql`update "call" set handoff_reason = ${handoffReason} where id = ${id}`;
  }
  if (propertyId) {
    await sql`update "call" set property_id = ${propertyId} where id = ${id}`;
  }
  await endCall(sql, id, "hangup", summary);
  return id;
}

describe("persistence: a second call from the same number sees the first", () => {
  it("returns null when the number has never called before", async () => {
    const fresh = `+1305999${Date.now() % 10000}`;
    expect(await lastCallFrom(sql, fresh)).toBeNull();
  });

  it("finds the prior call's summary, property and handoff reason", async () => {
    await makeFinishedCall(NUM_A, "About 7 Grouper Shores Cir. MOVED job 5409.", "install quote");
    const prior = await lastCallFrom(sql, NUM_A);
    expect(prior).not.toBeNull();
    expect(prior?.summary).toContain("Grouper Shores");
    expect(prior?.handoffReason).toBe("install quote");
  });

  it("picks the MOST RECENT call when several exist", async () => {
    await makeFinishedCall(NUM_A, "First call, oldest.");
    await new Promise((r) => setTimeout(r, 1100)); // started_at has 1s resolution pressure under load
    await makeFinishedCall(NUM_A, "Second call, newest.");
    const prior = await lastCallFrom(sql, NUM_A);
    expect(prior?.summary).toBe("Second call, newest.");
  }, 15_000);

  it("a LIVE call is not its own predecessor", async () => {
    const numC = `+1305557${Date.now() % 10000}`;
    await makeFinishedCall(numC, "The one real finished call for this number.");

    const liveId = await openCall(sql, {
      providerCallId: `test_cont_live_${Date.now()}`,
      channel: "phone",
      fromNumber: numC,
    });
    madeCallIds.push(liveId);

    // Only one candidate exists (`status = 'done'`) — the live call, still
    // `status = 'live'`, must not be returned as if it were its own history.
    const prior = await lastCallFrom(sql, numC);
    expect(prior?.summary).toBe("The one real finished call for this number.");
  });

  it("startSession populates session.priorCall on a brand new call", async () => {
    await makeFinishedCall(NUM_B, "About 8504 East Old Mangrove Road.");
    const session = await startSession(sql, {
      providerCallId: `test_cont_start_${Date.now()}`,
      channel: "web",
      fromNumber: NUM_B,
    });
    madeCallIds.push(session.callId);
    expect(session.priorCall).not.toBeNull();
    expect(session.priorCall?.summary).toContain("Old Mangrove");
    await finishSession(sql, session.providerCallId, "test");
  });
});

describe("address first, then number: the actual ask", () => {
  it("with no propertyId, falls back to the most recent call regardless of property — matchedBy 'number'", async () => {
    const numPM = `+1305558${Date.now() % 10000}`;
    await makeFinishedCall(numPM, "Called about property X.", null, propertyX);
    const prior = await lastCallFrom(sql, numPM); // no propertyId given
    expect(prior?.matchedBy).toBe("number");
  });

  it("a property-manager number with history at TWO properties: the address-scoped call wins, not the most recent", async () => {
    const numPM = `+1305559${Date.now() % 10000}`;
    // Property X first, then a MORE RECENT call about property Y — the naive
    // "most recent from this number" would wrongly surface Y's summary to a
    // caller who is actually asking about X.
    await makeFinishedCall(numPM, "About property X, the older call.", null, propertyX);
    await new Promise((r) => setTimeout(r, 1100));
    await makeFinishedCall(numPM, "About property Y, the newer call.", null, propertyY);

    const scopedToX = await lastCallFrom(sql, numPM, propertyX);
    expect(scopedToX?.matchedBy).toBe("property");
    expect(scopedToX?.summary).toBe("About property X, the older call.");

    const scopedToY = await lastCallFrom(sql, numPM, propertyY);
    expect(scopedToY?.matchedBy).toBe("property");
    expect(scopedToY?.summary).toBe("About property Y, the newer call.");
  }, 15_000);

  it("asking about a THIRD property this number never called about: falls back to number-only, honestly labelled", async () => {
    const numPM = `+1305560${Date.now() % 10000}`;
    await makeFinishedCall(numPM, "About property X only.", null, propertyX);

    const neverCalledAboutY = await lastCallFrom(sql, numPM, propertyY);
    expect(neverCalledAboutY?.matchedBy).toBe("number"); // no property-scoped row exists
    expect(neverCalledAboutY?.summary).toBe("About property X only."); // still the real fallback fact
  });

  it("attachDossier REFINES session.priorCall once the property resolves mid-call", async () => {
    const numPM = `+1305561${Date.now() % 10000}`;
    await makeFinishedCall(numPM, "About property X, from before.", null, propertyX);

    // Call opens before any address is known — number-only match, same as any
    // fresh call from a number with history.
    const session = await startSession(sql, {
      providerCallId: `test_cont_refine_${Date.now()}`,
      channel: "web",
      fromNumber: numPM,
    });
    madeCallIds.push(session.callId);
    expect(session.priorCall?.matchedBy).toBe("number");

    // The caller states an address that resolves to property X — the exact
    // property this number has real history with. Refinement must upgrade
    // the match, not leave it at the weaker number-only reading.
    await attachDossier(sql, session, propertyX, "test: caller gave the address");
    expect(session.priorCall?.matchedBy).toBe("property");
    expect(session.priorCall?.summary).toBe("About property X, from before.");

    await finishSession(sql, session.providerCallId, "test");
  });
});

describe("isolation: a different number never sees another caller's history", () => {
  it("NUM_A's history is invisible to NUM_B and vice versa", async () => {
    await makeFinishedCall(NUM_A, "Only NUM_A should ever see this sentence.");
    await makeFinishedCall(NUM_B, "Only NUM_B should ever see this sentence.");

    const seenByA = await lastCallFrom(sql, NUM_A);
    const seenByB = await lastCallFrom(sql, NUM_B);

    // Not just "doesn't mention the other" — the exact row for the exact
    // number, so a query bug that dropped the WHERE clause would fail this.
    expect(seenByA?.summary).toBe("Only NUM_A should ever see this sentence.");
    expect(seenByB?.summary).toBe("Only NUM_B should ever see this sentence.");
  });

  it("a null or blank number matches nothing, ever — the web test line sends null", async () => {
    expect(await lastCallFrom(sql, null)).toBeNull();
    expect(await lastCallFrom(sql, undefined)).toBeNull();
    expect(await lastCallFrom(sql, "")).toBeNull();
    expect(await lastCallFrom(sql, "   ")).toBeNull();
  });
});

describe("buildSummary: mechanical, not narrative", () => {
  it("is null when there is nothing to say", () => {
    expect(buildSummary(null, [], [])).toBeNull();
  });

  it("states the property plainly", () => {
    const s = buildSummary({ street: "7 Grouper Shores Cir", unit: null }, [], []);
    expect(s).toBe("About 7 Grouper Shores Cir.");
  });

  it("includes the unit when there is one", () => {
    const s = buildSummary({ street: "585 Moonraker Reef Blvd", unit: "201" }, [], []);
    expect(s).toContain("unit 201");
  });

  it("appends real outcomes verbatim", () => {
    const s = buildSummary(null, ["Handed off: gas leak.", "MOVED job 5409 to Friday."], []);
    expect(s).toContain("Handed off: gas leak.");
    expect(s).toContain("MOVED job 5409");
  });

  it("redacts a known secret the same way the rest of the trace does", () => {
    const s = buildSummary(null, ["Gate code is 4471 as discussed."], ["4471"]);
    expect(s).not.toContain("4471");
  });

  it("caps length rather than growing without bound", () => {
    const long = Array.from({ length: 50 }, (_, i) => `Outcome number ${i}, a full sentence about it.`);
    const s = buildSummary(null, long, []);
    expect(s!.length).toBeLessThanOrEqual(400);
  });
});

describe("getKnownSecrets: readable before endCall clears it", () => {
  it("returns what was remembered, and nothing after forgetCall runs", async () => {
    const id = await openCall(sql, {
      providerCallId: `test_cont_secrets_${Date.now()}`,
      channel: "web",
    });
    madeCallIds.push(id);
    rememberSecrets(id, ["9182"]);
    expect(getKnownSecrets(id).has("9182")).toBe(true);

    await endCall(sql, id, "test"); // finally clause calls forgetCall
    expect(getKnownSecrets(id).size).toBe(0);
  });
});

describe("priorCallContext: property match and number-only match read differently", () => {
  it("is the empty string when there is no prior call — splices in cleanly", () => {
    expect(priorCallContext(null)).toBe("");
  });

  it("a PROPERTY match: names the date, tells the model this is almost certainly it", () => {
    const text = priorCallContext({
      callId: 1, callerLabel: null,
      startedAt: "2026-08-19T14:00:00Z",
      summary: "About the third-floor duct leak.",
      street: "7 Grouper Shores Cir",
      unit: null,
      handoffReason: null,
      matchedBy: "property",
    });
    expect(text).toContain("SAME PROPERTY BEFORE");
    expect(text).toContain("duct leak");
    expect(text).toContain("almost certainly it");
    expect(text.toLowerCase()).toContain("confirm");
  });

  it("a NUMBER-only match: explicitly says it is a DIFFERENT property, never 'almost certainly it'", () => {
    const text = priorCallContext({
      callId: 2, callerLabel: null,
      startedAt: "2026-08-19T14:00:00Z",
      summary: "About a different unit entirely.",
      street: "545 Buttonwood Key St",
      unit: null,
      handoffReason: null,
      matchedBy: "number",
    });
    expect(text).toContain("DIFFERENT property");
    expect(text.toLowerCase()).toContain("background");
    expect(text).not.toContain("almost certainly it");
  });

  it("surfaces an open handoff as still open", () => {
    const text = priorCallContext({
      callId: 3, callerLabel: null,
      startedAt: "2026-08-19T14:00:00Z",
      summary: null,
      street: null,
      unit: null,
      matchedBy: "number",
      handoffReason: "gas leak",
    });
    expect(text).toContain("handed to a person");
    expect(text).toContain("gas leak");
    expect(text.toLowerCase()).toContain("still be open");
  });
});
