/**
 * The tool webhook, as a framework-free function.
 *
 * Deliberately no HTTP framework and no serverless adapter. Two adapters were
 * tried and both failed in ways that only appear once deployed — a Web-standard
 * handler returned from a Node-runtime function never responds, and the request
 * times out with no error anywhere. That is an unacceptable failure mode for
 * the one endpoint a live phone call depends on, so this takes a plain request
 * description and returns a plain response, and the host adapter is four lines
 * that cannot be subtly wrong.
 *
 * SECURITY, BEFORE ANYTHING ELSE:
 *
 *   This endpoint can read entry codes for 869 properties, customer balances,
 *   and every note this company has written. It sits on a public URL because
 *   Vapi has to reach it. The shared secret is therefore the only thing between
 *   a stranger with the URL and those door codes — so it is checked before the
 *   body is parsed, before the database is touched, and before anything is
 *   logged. There is no path to a query that skips it.
 */
import { timingSafeEqual } from "node:crypto";
import { EMERGENCY } from "../agent/emergency.js";
import { requireEnv, TENANT_ID } from "../config.js";
import { openCallConnection, type CallConnection } from "../db/client.js";
import { handleApi } from "./api.js";
import { instrument } from "../calls/trace.js";
import { startSession, attachDossier, finishSession } from "../calls/session.js";
import { record } from "../calls/record.js";

export interface HandlerRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  /** Parsed query string. The platform reads its passphrase and filters from it. */
  query?: URLSearchParams;
}

export interface HandlerResponse {
  status: number;
  body: unknown;
  /** Set when the response is not JSON, e.g. the platform HTML. */
  contentType?: string;
  /** Pre-serialised body, used with `contentType`. */
  raw?: string;
}

function header(req: HandlerRequest, name: string): string | undefined {
  const v = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** Constant-time compare: `===` on a secret leaks its length and prefix. */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * One connection per call, scoped once, reused for every tool call in that
 * conversation. A fresh transaction per tool would cost four network round
 * trips (~560ms) before reading a row, which a phone call cannot afford.
 */
const callConnections = new Map<string, CallConnection>();

/**
 * How long a call may hold its own database connection without saying anything.
 *
 * A live call keeps a reserved connection so its scoping and its trace stay on
 * one session. It is handed back at `end-of-call-report`. Calls that never send
 * one — a dropped line, a crashed instance, a probe — kept theirs until the
 * instance died, and this pooler allows FIFTEEN clients in total. The platform
 * started answering "max clients reached" on every read, which reaches a
 * dispatcher as a screen that will not load.
 *
 * Three minutes is well past the gap between turns on a real call, and a call
 * that speaks again after being swept simply opens a new connection — the
 * record lives in the database, not in the socket. `closeStaleCalls` already
 * does the same tidying for the call rows; this is the missing half.
 */
const CALL_CONN_IDLE_MS = 3 * 60_000;
const callLastUsed = new Map<string, number>();

async function sweepIdleCallConnections(): Promise<void> {
  const cutoff = Date.now() - CALL_CONN_IDLE_MS;
  for (const [id, at] of [...callLastUsed]) {
    if (at < cutoff) {
      callLastUsed.delete(id);
      await releaseCall(id);
    }
  }
}

async function connectionFor(callId: string): Promise<CallConnection> {
  await sweepIdleCallConnections();
  callLastUsed.set(callId, Date.now());
  const existing = callConnections.get(callId);
  if (existing) return existing;
  const fresh = await openCallConnection();
  callConnections.set(callId, fresh);
  return fresh;
}

export async function releaseCall(callId: string): Promise<void> {
  callLastUsed.delete(callId);
  const conn = callConnections.get(callId);
  if (!conn) return;
  callConnections.delete(callId);
  await conn.release().catch(() => {});
}

interface VapiToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
  name?: string;
  arguments?: unknown;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (raw as Record<string, unknown>) ?? {};
}

export async function handleRequest(req: HandlerRequest): Promise<HandlerResponse> {
  // Vercel's rewrite may present the path with or without an /api prefix, and
  // a trailing slash is common. Normalise rather than depend on host routing.
  const path = req.path.replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";

  // Unauthenticated on purpose: it reveals nothing and it is how you find out
  // the deployment is alive without holding the secret.
  if (path === "/health") {
    return { status: 200, body: { ok: true, service: "front-desk", tenant: TENANT_ID } };
  }

  // The platform screens and their API. Gated by their own passphrase, never by
  // the Vapi secret: the voice provider's shared secret must not be the thing
  // that also opens a browser window onto customer balances.
  const segments = path === "/" ? ["app"] : path.split("/").filter(Boolean);
  if (segments[0] === "app" || segments[0] === "data") {
    const platform = await handleApi({
      method: req.method,
      segments,
      query: req.query ?? new URLSearchParams(),
      body: (req.body ?? {}) as Record<string, unknown>,
      key:
        header(req, "x-app-key") ??
        req.query?.get("k") ??
        undefined,
    });
    if (platform) return platform;
  }

  if (path !== "/vapi/tools") {
    return { status: 404, body: { error: "not found", path } };
  }

  const expected = requireEnv("VAPI_WEBHOOK_SECRET", "A6");
  const provided =
    header(req, "x-vapi-secret") ??
    header(req, "authorization")?.replace(/^Bearer\s+/i, "");

  if (!secretMatches(provided, expected)) {
    // Deliberately uninformative — a 401 that explains itself is a hint.
    return { status: 401, body: { error: "unauthorized" } };
  }

  if (req.method !== "POST") {
    return { status: 405, body: { error: "method not allowed" } };
  }

  const body = (req.body ?? {}) as {
    message?: {
      type?: string;
      role?: string;
      transcriptType?: string;
      transcript?: string;
      endedReason?: string;
      call?: { id?: string; customer?: { number?: string } };
      toolCalls?: VapiToolCall[];
      toolCallList?: VapiToolCall[];
    };
  };

  const message = body.message ?? {};
  const callId = message.call?.id ?? "unknown";
  const conn = await connectionFor(callId);

  // Every message type on a call opens or finds the same record, so the trace
  // exists from the first event rather than from the first tool call. A call
  // that asked nothing still has to be openable afterwards.
  const session = await startSession(conn.sql, {
    providerCallId: callId,
    channel: "phone",
    fromNumber: message.call?.customer?.number ?? null,
  });

  // Layer 1 on the phone path. Vapi sends partial transcripts as the caller is
  // still speaking; only the final one is a turn, and recording partials would
  // fill the record with half-sentences nobody can read back to a customer.
  if (message.type === "transcript" && message.transcriptType === "final" && message.transcript) {
    const fromCaller = message.role !== "assistant";
    await record(conn.sql, session.callId, {
      kind: "turn",
      role: fromCaller ? "caller" : "agent",
      body: message.transcript,
    });

    // THE SAFETY BACKSTOP, ON THE PHONE.
    //
    // It used to live only in src/agent/loop.ts, which drives the TEST LINE. On
    // a real call Vapi drives the model and only calls this webhook for tools,
    // so the backstop never ran where it matters most. A caller said a unit
    // "just caught on fire yesterday"; the agent promised a callback, called no
    // tool, and nothing appeared on the dispatcher's screen.
    //
    // The decision is taken away from the model here too: if the caller says
    // one of these words and nobody has handed this call over yet, we hand it
    // over. Once per call — the reason is stamped on the call row, so a second
    // mention does not raise a second alarm.
    if (fromCaller && EMERGENCY.test(message.transcript)) {
      const [row] = await conn.sql`
        select handoff_reason from "call" where id = ${session.callId}
      `;
      const already = (row as { handoff_reason?: string | null } | undefined)?.handoff_reason;
      if (!already) {
        const { loadTools, getTool } = await import("../tools/_registry.js");
        await loadTools();
        const handoff = getTool("handoff");
        if (handoff) {
          const summary =
            `AUTOMATIC ESCALATION — caller reported a possible safety emergency. ` +
            `Their words: "${message.transcript}"`;
          const result = await handoff.handler({ reason: "safety", summary }, {
            sql: conn.sql,
            callId,
            callRowId: session.callId,
            ...(session.propertyId !== null ? { propertyId: session.propertyId } : {}),
          });
          await record(conn.sql, session.callId, {
            kind: "tool", role: "agent", toolName: "handoff",
            args: { reason: "safety", auto: true },
            result: typeof result === "string" ? result : JSON.stringify(result),
            durationMs: 0,
            meta: { automatic: true },
          });
          // The tool event is the trace; THIS is what stamps handoff_reason on
          // the call row, and the reason is what the rail reads to show the
          // case file instead of an ordinary live call. Recording only the tool
          // left the escalation invisible on the dispatcher's screen — which is
          // the whole point of escalating.
          await record(conn.sql, session.callId, {
            kind: "handoff", role: "agent", body: "safety",
            meta: { automatic: true },
          });
        }
      }
    }
    return { status: 200, body: { ok: true } };
  }

  // End of call: close the record, then let the connection go or the pool
  // leaks one per call.
  if (message.type === "end-of-call-report" || message.type === "hang") {
    await finishSession(conn.sql, callId, message.endedReason ?? "hangup");
    await releaseCall(callId);
    return { status: 200, body: { ok: true } };
  }

  const toolCalls = message.toolCalls ?? message.toolCallList ?? [];
  if (!toolCalls.length) return { status: 200, body: { results: [] } };

  const { loadTools, getTool } = await import("../tools/_registry.js");
  await loadTools();

  // Vapi may send several tool calls in one turn. Running them together is the
  // difference between one round trip and four while a caller waits.
  const results = await Promise.all(
    toolCalls.map(async (call) => {
      const name = call.function?.name ?? call.name ?? "";
      const args = parseArgs(call.function?.arguments ?? call.arguments);
      const tool = getTool(name);

      if (!tool) return { toolCallId: call.id, result: `No such tool: ${name}` };

      // Layer 4. Its own buffer per invocation, so parallel tools cannot be
      // credited with each other's queries.
      const queries: { statement: string; durationMs: number; rowCount: number }[] = [];
      const scoped = instrument(conn.sql, (q) => queries.push(q));
      const started = Date.now();

      try {
        const parsed = tool.schema.parse(args);
        const output = await tool.handler(parsed, {
          sql: scoped,
          callId,
          callRowId: session.callId,
          ...(session.propertyId !== null ? { propertyId: session.propertyId } : {}),
        });
        const result = typeof output === "string" ? output : JSON.stringify(output);

        // Layer 3, then layer 4 underneath it.
        await record(conn.sql, session.callId, {
          kind: "tool", role: "agent", toolName: name, args,
          result, durationMs: Date.now() - started,
        });
        for (const q of queries) {
          await record(conn.sql, session.callId, {
            kind: "query", role: "system", toolName: name,
            statement: q.statement, durationMs: q.durationMs, rowCount: q.rowCount,
          });
        }

        // A resolved property is the answer to "did it ever give one customer's
        // information to another", so it is attached the moment it is known and
        // the dossier's codes are handed to the redactor at the same time.
        const resolved = /RESOLVED property_id=(\d+)/.exec(result);
        if (resolved && !session.propertyId) {
          await attachDossier(conn.sql, session, Number(resolved[1]), "address given by the caller");
        }
        if (name === "handoff") {
          await record(conn.sql, session.callId, {
            kind: "handoff", role: "agent",
            body: String((args as { reason?: string }).reason ?? "unspecified"),
          });
        }
        if (["move_job", "book_job", "cancel_job", "add_note"].includes(name)) {
          await record(conn.sql, session.callId, {
            kind: "change", role: "agent", toolName: name,
            body: result.split("\n")[0] ?? result,
          });
        }

        return { toolCallId: call.id, result };
      } catch (err) {
        // Never leak an internal error into a caller's ear. Return something
        // the model can act on — which is to hand off, not to guess.
        console.error(`tool ${name} failed for call ${callId}:`, err);
        await record(conn.sql, session.callId, {
          kind: "system", role: "system",
          body: `Tool ${name} failed`, toolName: name,
          meta: { error: String((err as Error)?.message ?? err) },
        });
        return {
          toolCallId: call.id,
          result:
            "That lookup did not work. Tell the caller you will get someone to help, and offer to take a message.",
        };
      }
    }),
  );

  return { status: 200, body: { results } };
}
