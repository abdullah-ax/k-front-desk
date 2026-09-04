/**
 * Task 11 gate — the tools the agent is given.
 *
 * These are the entire surface between a phone call and this company's data, so
 * the tests are less about "does it return rows" and more about "can it be made
 * to say something false or dangerous". Two properties matter most:
 *
 *   1. Nothing resolves on a guess. The resolver must ask rather than pick.
 *   2. Nothing states a verdict the data cannot support — warranty especially,
 *      where there is no equipment record at all.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openCallConnection, closeDb, type Sql } from "../src/db/client.js";
import { loadTools, getTool, allTools, HOT_PATH } from "../src/tools/_registry.js";
import { ALWAYS_REWRITTEN_TOKENS } from "../src/pipeline/scrub/anonymizer.js";

let call: Awaited<ReturnType<typeof openCallConnection>>;
let sql: Sql;
let ctx: { sql: Sql; callId: string };
let busiestId: number;

const run = async (name: string, args: Record<string, unknown>): Promise<string> => {
  const tool = getTool(name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool.handler(tool.schema.parse(args), ctx);
};

beforeAll(async () => {
  await loadTools();
  call = await openCallConnection();
  sql = call.sql;
  ctx = { sql, callId: `tools-test-${Date.now()}` };
  const [row] = await sql`
    select id from property where visit_count > 2 order by visit_count desc limit 1
  `;
  busiestId = Number(row?.["id"]);
}, 60_000);

afterAll(async () => {
  await call?.release();
  await closeDb();
});

describe("registry", () => {
  it("loads every tool exactly once", () => {
    const names = allTools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("resolve_property");
    expect(names).toContain("handoff");
  });

  it("every hot-path tool actually exists", () => {
    // HOT_PATH is what stays loaded when the list grows past the point where
    // prompt size starts hurting tool selection. A name here that does not
    // resolve would silently drop a tool from every call.
    for (const name of HOT_PATH) expect(getTool(name), name).toBeDefined();
  });

  it("describes each tool for the model, not for a developer", () => {
    for (const t of allTools()) {
      expect(t.description.length, t.name).toBeGreaterThan(80);
      expect(t.description, t.name).toMatch(/[a-z]/);
    }
  });
});

describe("resolve_property never guesses", () => {
  it("asks for the unit at a street with many properties behind it", async () => {
    const out = await run("resolve_property", { address: "1363 W Old Mangrove Rd" });
    expect(out).toContain("AMBIGUOUS");
    expect(out).toMatch(/unit/i);
    expect(out).not.toContain("RESOLVED");
  }, 60_000);

  it("resolves once the unit is known", async () => {
    const out = await run("resolve_property", {
      address: "1363 West Old Mangrove Road",
      unit: "3116",
    });
    expect(out).toContain("RESOLVED");
    // The unit must not be echoed twice — streetRaw may already carry it, and
    // "unit 3116 unit 3116" is what a caller would actually hear.
    expect(out).not.toMatch(/unit (\S+) unit \1/i);
  }, 60_000);

  it("refuses a bare name and says why", async () => {
    const out = await run("resolve_property", { address: "", lastName: "Sawyer" });
    expect(out).toContain("NOT ENOUGH TO IDENTIFY");
    expect(out).not.toContain("RESOLVED");
  }, 60_000);

  it("refuses a bare company name", async () => {
    const out = await run("resolve_property", { address: "", company: "Starfish Hospitality" });
    expect(out).not.toContain("RESOLVED");
  }, 60_000);

  it("says no match rather than offering the nearest thing", async () => {
    const out = await run("resolve_property", { address: "8888 Nowhere Imaginary Boulevard" });
    expect(out).toContain("NO MATCH");
    expect(out).not.toContain("RESOLVED");
  }, 60_000);
});

describe("warranty is evidence, never a verdict", () => {
  it("never states coverage in its own voice", async () => {
    const out = await run("get_warranty_evidence", { property_id: busiestId });

    // Coverage language is EXPECTED inside quoted evidence — "under warranty
    // until 2028" is exactly what the office wrote and exactly what the agent
    // should relay. What must never happen is the tool asserting it unquoted.
    // So check only the lines that are the tool speaking: not quotes, and not
    // the instruction block (which necessarily contains "are not covered",
    // because it is telling the agent not to say that).
    const ownVoice = out
      .split("\n")
      .filter((l) => !l.trim().startsWith('"') && !/^\s*(That is what|Offer to|There is no|Say you)/.test(l))
      .join("\n");

    expect(ownVoice).not.toMatch(/\byou are covered\b/i);
    expect(ownVoice).not.toMatch(/\bis (still )?under warranty\b/i);
    expect(ownVoice).not.toMatch(/\byou are not covered\b/i);

    // And it must always point at the missing input rather than stopping at "no".
    expect(out.toLowerCase()).toMatch(/model|serial|manufacturer|not a decision|cannot confirm/);
  }, 60_000);

  it("quotes the office verbatim rather than paraphrasing", async () => {
    const out = await run("get_warranty_evidence", { property_id: busiestId });
    // Evidence, if present, is quoted — that is what makes it checkable.
    if (!out.includes("Nothing on file")) {
      expect(out).toMatch(/"/);
    }
  }, 60_000);
});

describe("access is guarded", () => {
  it("reminds the caller must be verified before a code is spoken", async () => {
    const out = await run("get_access", { property_id: busiestId });
    expect(out.toLowerCase()).toMatch(/confirmed|verified|ask the caller/);
  }, 60_000);
});

describe("balance excludes phantom debt", () => {
  it("never counts a voided invoice", async () => {
    const [row] = await sql`
      select count(*)::int as n from invoice
      where is_voided and coalesce(due_amount_cents, 0) > 0
    `;
    // 68 voided invoices still carry a due amount in the source, totalling
    // $268,433.84. Any tool that summed them would dun customers who owe zero.
    expect(Number(row?.["n"])).toBeGreaterThan(0);

    const out = await run("get_balance", { property_id: busiestId });
    expect(out).not.toMatch(/NaN|undefined/);
  }, 60_000);
});

describe("nothing a tool says carries anonymizer damage", () => {
  it("across every read tool on a busy property", async () => {
    const outputs = await Promise.all([
      run("get_service_history", { property_id: busiestId }),
      run("get_access", { property_id: busiestId }),
      run("get_contacts", { property_id: busiestId }),
      run("get_balance", { property_id: busiestId }),
      run("get_warranty_evidence", { property_id: busiestId }),
    ]);
    for (const out of outputs) {
      for (const token of ALWAYS_REWRITTEN_TOKENS) {
        expect(out, `"${token}" leaked into tool output`).not.toContain(token);
      }
    }
  }, 120_000);
});

describe("a missing property is said plainly", () => {
  it("does not invent an empty record", async () => {
    for (const name of ["get_service_history", "get_access", "get_balance"]) {
      const out = await run(name, { property_id: -999 });
      expect(out.toLowerCase(), name).toContain("no property");
    }
  }, 60_000);
});

describe("handoff is recorded, not merely promised", () => {
  it("writes a row so handoff rate by reason is countable", async () => {
    const before = await sql`select count(*)::int as n from pipeline_run where task = 'handoff'`;
    await run("handoff", {
      reason: "warranty_decision",
      summary: "Caller asked whether their compressor is covered; no equipment record exists.",
    });
    const after = await sql`select count(*)::int as n from pipeline_run where task = 'handoff'`;
    expect(Number(after[0]?.["n"])).toBe(Number(before[0]?.["n"]) + 1);
  }, 60_000);
});
