/**
 * The gate that lets the call trace exist at all
 * (.claude/prds/call-observability.prd.md, milestone 2).
 *
 * Every other milestone in that PRD writes something down. This one proves that
 * what gets written down cannot contain an entry code, because the system holds
 * codes for 869 properties and a log persists in a way a prompt does not.
 *
 * It checks BOTH directions, and the second is the one that has actually gone
 * wrong on this build:
 *
 *   under-redaction  a code survives into the trace
 *   over-redaction   a house number, job reference, price or unit number is
 *                    destroyed because it happened to be digits
 *
 * The corpus supplies the cases. Nothing here is invented.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openCallConnection, closeDb, type Sql } from "../src/db/client.js";
import {
  redactText,
  redactDeep,
  redactSecrets,
  containsSecret,
  collectSecrets,
  WITHHELD,
} from "../src/security/redact.js";

let call: Awaited<ReturnType<typeof openCallConnection>>;
let sql: Sql;

beforeAll(async () => {
  call = await openCallConnection();
  sql = call.sql;
}, 60_000);

afterAll(async () => {
  await call?.release();
  await closeDb();
});

describe("a code never survives into the trace", () => {
  it("removes a labelled code from free text", () => {
    const out = redactText("3rd floor system needs an estimate. Door Code: 812898. Unit Vacant.");
    expect(out).not.toContain("812898");
    expect(out).toContain("Door Code");
    expect(out).toContain("Unit Vacant");
  });

  it("catches the label spellings the corpus actually uses", () => {
    const cases = [
      "door code 4455",
      "Gate Code: 1234#",
      "lockbox code is 0000",
      "entry code = 9 8 7 6",
      "Building Code - 55221",
      "access code: *2580",
    ];
    for (const c of cases) {
      expect(containsSecret(redactText(c)), `"${c}" leaked`).toBeNull();
    }
  });

  it("removes an unlabelled code when the value is already known", () => {
    // The awkward real case: "Access info: 20396 check Carmen". No label, so
    // only the known-value rule can catch it. This is why the dossier passes
    // the codes it just read down to the redactor.
    const raw = "Access info: 20396 check Carmen before entering";
    expect(redactText(raw)).toContain("20396");
    expect(redactText(raw, ["20396"])).not.toContain("20396");
  });

  it("replaces a secret fact's value with a statement that one exists", () => {
    const out = redactSecrets({ kind: "door_code", value: "812898", scope: "property" });
    expect(out["value"]).toBe(WITHHELD);
    expect(JSON.stringify(out)).not.toContain("812898");
    // It still says a code EXISTS. The agent needs that to offer a handoff and
    // the office needs it to know somebody has to read it out.
    expect(out["kind"]).toBe("door_code");
  });

  it("strips audit metadata that names what the anonymizer repaired", () => {
    const out = redactDeep({
      kind: "access",
      value: "gate on the north side",
      _scrub: { verbatim_in: "raw", was: "Ruby Avery" },
      _provenance: { value: "not_found" },
      job_id: 9984,
      confidence: 0.9,
    });
    const text = JSON.stringify(out);
    expect(text).not.toContain("Ruby Avery");
    expect(text).not.toContain("_scrub");
    expect(text).not.toContain("_provenance");
    expect(out["value"]).toBe("gate on the north side");
  });

  it("reaches a code nested anywhere a reader of the log could reach", () => {
    const payload = {
      property: { street: "8504 E Old Mangrove Rd" },
      facts: [
        { kind: "units", value: "3rd floor" },
        { kind: "door_code", value: "812898" },
      ],
      notes: [{ id: 21883, content: "Door Code: 812898. Condenser leaking." }],
    };
    expect(JSON.stringify(redactDeep(payload, ["812898"]))).not.toContain("812898");
  });
});

describe("redaction does not destroy the answers the agent exists to give", () => {
  it("leaves house numbers, job references, units and money alone", () => {
    // Every one of these has been read as a leaked code by a check written too
    // eagerly at some point in this build.
    const kept = [
      "We were last at 8504 E Old Mangrove Rd on 14 Aug 2026.",
      "Job 4510 moved from Thursday 3:00p to Friday 9:00a.",
      "585 Moonraker Reef Blvd Suite 201",
      "The open balance is $55,207.19 across 38 invoices.",
      "Call them on 305-555-0142 before eight.",
      "property 7844 has 8 visits on record",
    ];
    for (const line of kept) {
      expect(redactText(line), `redactor damaged: ${line}`).toBe(line);
    }
  });

  it("keeps a fact that is not a secret exactly as it was", () => {
    const payload = { kind: "access", value: "Gate on the north side, visitor bay" };
    expect(redactSecrets(payload)).toEqual(payload);
  });
});

describe("against the real corpus, not a fixture", () => {
  it("removes every real code this database holds from its own note text", async () => {
    const rows = await sql`
      select payload, source_note_id from extracted_fact
      where fact_type = 'access' limit 4000
    `;
    const payloads = (rows as unknown as { payload: Record<string, unknown> }[]).map(
      (r) => r.payload,
    );
    const secrets = collectSecrets(payloads);
    console.log(`    ${secrets.size} real code-shaped value(s) in the access facts`);
    expect(secrets.size).toBeGreaterThan(0);

    // Every one of them must vanish from the note it came from.
    const noteRows = await sql`
      select id, coalesce(content_scrubbed, content) as body from note
      where id in ${sql(
        (rows as unknown as { source_note_id: number }[])
          .map((r) => Number(r.source_note_id))
          .filter(Boolean)
          .slice(0, 400),
      )}
    `;
    let checked = 0;
    for (const n of noteRows as unknown as { id: number; body: string }[]) {
      const clean = redactText(n.body, secrets);
      const leak = containsSecret(clean, secrets);
      expect(leak, `note ${n.id} still carries ${leak}`).toBeNull();
      checked += 1;
    }
    console.log(`    ${checked} note(s) redacted with no leak`);
    expect(checked).toBeGreaterThan(0);
  }, 90_000);

  it("a redacted dossier is safe to write to the trace", async () => {
    const { getPropertyDossier, renderDossier } = await import(
      "../src/read/property-dossier.js"
    );
    const props = await sql`
      select id from property where visit_count > 0 order by visit_count desc limit 12
    `;
    const allSecrets = collectSecrets(
      (
        await sql`select payload from extracted_fact where fact_type = 'access' limit 4000`
      ).map((r) => (r as { payload: Record<string, unknown> }).payload),
    );

    for (const p of props as unknown as { id: number }[]) {
      const d = await getPropertyDossier(Number(p.id), sql);
      if (!d) continue;
      // What the agent reads, and what the trace would store, both clean.
      for (const surface of [renderDossier(d), JSON.stringify(redactDeep(d, allSecrets))]) {
        const leak = containsSecret(surface, allSecrets);
        expect(leak, `property ${p.id} leaked ${leak}`).toBeNull();
      }
    }
  }, 120_000);
});
