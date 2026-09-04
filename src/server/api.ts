/**
 * The platform API (.claude/prds/front-desk-platform.prd.md).
 *
 * Plain JSON over the same framework-free handler the tool webhook uses, for
 * the same reason: two adapters were tried on this deployment and both failed
 * in ways that only appear once shipped, one of them by never responding at
 * all. A screen that cannot load is a demo that does not happen.
 *
 * ROUTES. The screens live at /app and their data at /data/*, deliberately not
 * under /api: the host rewrites every non-/api path onto the single function
 * and the handler strips a leading /api to compensate, so an API mounted there
 * loses its first path segment and every route 404s. Found the fast way.
 *
 * ACCESS. One shared link behind a passphrase. Real accounts are a day of work
 * that proves nothing about the thesis, and the PRD says so out loud rather
 * than pretending the trade was not made. What that passphrase protects is not
 * nothing: customer balances, and which properties have an entry code on file.
 * So it is compared in constant time, it is required on every route including
 * the HTML, and the deployment refuses to serve the app at all if it is unset.
 */
import { timingSafeEqual } from "node:crypto";
import { env, TZ, TENANT_ID } from "../config.js";
import { slugFor } from "../models/index.js";
import { openCallConnection, type CallConnection } from "../db/client.js";
import { getBoard, getSchedule, getTechnicians } from "../read/board.js";
import { listCalls, getCall, getCallByProvider, handoffsByReason } from "../read/calls.js";
import { getJob, searchProperties } from "../read/job.js";
import { getPropertyDossier } from "../read/property-dossier.js";
import { briefProperty } from "../read/property-brief.js";
import { listProperties, type PropertySort } from "../read/properties.js";
import {
  QUEUE_NAMES, getQueueSummaries, getQueue, assignQueueItem, dismissQueueItem, type QueueName,
} from "../read/queues.js";
import {
  listTickets, getTicket, approveTicket, dismissTicket, counterTicket,
} from "../read/tickets.js";
import { getPressing } from "../read/pressing.js";
import { askQuestion } from "../read/ask.js";
import {
  bookJob, moveJob, cancelJob, addNote, assignJob, markLate, undoChange, type WriteContext,
} from "../write/jobs.js";
import { startSession, say, finishSession } from "../calls/session.js";
import { APP_HTML } from "./app-html.js";

export interface ApiResponse {
  status: number;
  body: unknown;
  contentType?: string;
  raw?: string;
}

function ok(body: unknown): ApiResponse {
  return { status: 200, body };
}
function bad(status: number, message: string): ApiResponse {
  return { status, body: { error: message } };
}

/**
 * A connection for the platform screens.
 *
 * One reserved connection, shared by the UI's requests, rather than a
 * transaction each. `withTenant` costs four round trips before a row is read,
 * which at ~140ms each is most of a second on a board that refreshes while a
 * call is running.
 */
let uiConn: CallConnection | null = null;
async function ui(): Promise<CallConnection> {
  if (uiConn) return uiConn;
  uiConn = await openCallConnection();
  return uiConn;
}

/** Re-open once if the pooler dropped the reserved connection under us. */
async function withUi<T>(fn: (sql: CallConnection["sql"]) => Promise<T>): Promise<T> {
  try {
    return await fn((await ui()).sql);
  } catch (err) {
    const message = String((err as Error)?.message ?? "");
    if (!/CONNECTION|ECONNRESET|ETIMEDOUT|closed|ended/i.test(message)) throw err;
    uiConn = null;
    return fn((await ui()).sql);
  }
}

function constantTimeEqual(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export function authorised(key: string | undefined): boolean {
  const expected = env("APP_PASSPHRASE");
  if (!expected) return false;
  return constantTimeEqual(key, expected);
}

/** Today in the company's timezone, which is the only "today" that matters. */
export function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

interface Ctx {
  method: string;
  segments: string[];
  query: URLSearchParams;
  body: Record<string, unknown>;
  key: string | undefined;
}

const officeCtx = (sql: CallConnection["sql"], who?: unknown): WriteContext => ({
  sql,
  actor: "office",
  actorLabel: typeof who === "string" && who ? who : "office",
});

export async function handleApi(ctx: Ctx): Promise<ApiResponse | null> {
  const [head, ...rest] = ctx.segments;

  // The app itself. Served from here rather than as a static file so the
  // passphrase gate cannot be routed around by the host's static handling.
  if (head === "app") {
    if (!env("APP_PASSPHRASE")) {
      return {
        status: 503,
        body: null,
        contentType: "text/plain; charset=utf-8",
        raw: "APP_PASSPHRASE is not set on this deployment, so the platform will not serve. Set it and redeploy.",
      };
    }
    // The shared key is written into the page here rather than typed by a
    // person. There is one office and one link; a form that only ever accepts
    // one word was a doorstep in front of an unlocked door. Note what this
    // means: anyone who can reach /app can now read the records, because the
    // page carries the key. The /data routes still check it on every request.
    return {
      status: 200, body: null, contentType: "text/html; charset=utf-8",
      raw: APP_HTML.replace("__APP_KEY__", (env("APP_PASSPHRASE") ?? "").replace(/["\\<>]/g, "")),
    };
  }

  if (head !== "data") return null;
  if (!authorised(ctx.key)) return bad(401, "unauthorized");

  const [resource, id, sub] = rest;

  // --- reads ---------------------------------------------------------------

  if (ctx.method === "GET") {
    // The POST branch has always been wrapped; this one was not, so anything
    // that threw before reaching a query — Number("abc") => NaN handed to a
    // bigint column, an unparseable date, a missing id — escaped as a bare
    // platform 500 in text/plain. The client calls r.json() on that, so the
    // person saw a JSON parser error instead of a sentence. Fifteen routes
    // shared the one hole.
    try {
      switch (resource) {
        case "config":
          // What this deployment is actually running.
          //
          // Added because production silently ran a different agent model from
          // the one every gate was measured against, and the symptom was not an
          // error: it was the agent quietly not calling handoff on a refusal.
          // A gate result only transfers to production if production runs the
          // same model, so the deployment says which one out loud.
          return ok({
            models: {
              agent: slugFor("MODEL_AGENT"),
              extract: slugFor("MODEL_EXTRACT"),
              judge: slugFor("MODEL_JUDGE"),
            },
            tenant: TENANT_ID,
            today: localToday(),
            // Browser voice against the REAL stack: Deepgram hearing, the Vapi
            // voice speaking, Vapi driving the loop, our webhook serving the
            // tools. The PUBLIC key is safe in a page — it can start a call with
            // an assistant and nothing else. The private key never leaves here.
            voice: {
              publicKey: env("VAPI_PUBLIC_KEY") ?? null,
              assistantId: env("VAPI_ASSISTANT_ID") ?? null,
            },
          });
        case "board": {
          // One day for the board; a range for the list. `from` alone means
          // that one day as a list, so a caller never has to send both.
          //
          // Every date is checked for being a real day. Postgres rolls
          // 2026-02-30 forward to March 2nd, so the board answered 200 with
          // March's jobs under a February heading — the screen said one day and
          // showed another, which is worse than an error.
          const realDay = (s: string): boolean => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
            const d = new Date(`${s}T00:00:00Z`);
            return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
          };
          const from = ctx.query.get("from") || null;
          if (from) {
            const to = ctx.query.get("to") ?? from;
            if (!realDay(from) || !realDay(to)) return bad(400, "That is not a real date.");
            return ok(await withUi((sql) => getSchedule(sql, from, to)));
          }
          // An empty date is a cleared field, which means today — `?? localToday()`
          // never fired for it, because "" is not null.
          const date = ctx.query.get("date") || localToday();
          if (!realDay(date)) return bad(400, "That is not a real date.");
          return ok(await withUi((sql) => getBoard(sql, date)));
        }
        case "tickets": {
          if (id) {
            const t = await withUi((sql) => getTicket(sql, Number(id)));
            return t ? ok(t) : bad(404, "no such ticket");
          }
          return ok(await withUi((sql) => listTickets(sql, { status: ctx.query.get("status") ?? "open" })));
        }
        case "pressing":
          return ok(await withUi((sql) => getPressing(sql)));
        case "technicians":
          return ok(await withUi((sql) => getTechnicians(sql)));
        case "calls":
          // The Test line knows the provider's id, never ours.
          if (!id && ctx.query.get("provider")) {
            const found = await withUi((sql) =>
              getCallByProvider(sql, ctx.query.get("provider")!));
            return found ? ok(found) : bad(404, "not recorded yet");
          }
          if (id) {
            const call = await withUi((sql) => getCall(sql, Number(id)));
            return call ? ok(call) : bad(404, "no such call");
          }
          return ok(
            await withUi((sql) =>
              listCalls(sql, {
                ...(ctx.query.get("search") ? { search: ctx.query.get("search")! } : {}),
                limit: Number(ctx.query.get("limit") ?? 40),
              }),
            ),
          );
        case "handoffs":
          return ok(await withUi((sql) => handoffsByReason(sql)));
        case "job": {
          const job = await withUi((sql) => getJob(sql, Number(id)));
          return job ? ok(job) : bad(404, "no such job");
        }
        case "property": {
          // `?brief=1` — the three-sentence version, written from the same
          // dossier the agent reads, so the screen and the phone cannot tell
          // two different stories about one building.
          if (ctx.query.get("brief")) {
            return ok(await withUi((sql) => briefProperty(sql, Number(id))));
          }
          const d = await withUi((sql) => getPropertyDossier(Number(id), sql));
          return d ? ok(d) : bad(404, "no such property");
        }
        case "properties": {
          // Two shapes on one route. The agent's lookup wants the eight best
          // matches for a spoken address; the Property screen wants a page of
          // the whole book with filters. `?list=1` asks for the second.
          if (ctx.query.get("list")) {
            const qs = ctx.query;
            return ok(await withUi((sql) => listProperties(sql, {
              q: qs.get("q") ?? "",
              city: qs.get("city") ?? "",
              only: qs.get("only") ?? "",
              sort: (qs.get("sort") ?? "address") as PropertySort,
              dir: qs.get("dir") === "desc" ? "desc" : "asc",
              limit: Number(qs.get("limit") ?? 50),
              offset: Number(qs.get("offset") ?? 0),
            })));
          }
          return ok(await withUi((sql) => searchProperties(sql, ctx.query.get("q") ?? "")));
        }
        case "queues": {
          if (id) {
            if (!(QUEUE_NAMES as readonly string[]).includes(id)) return bad(404, `no such list: ${id}`);
            return ok(await withUi((sql) => getQueue(sql, id as QueueName)));
          }
          return ok(await withUi((sql) => getQueueSummaries(sql)));
        }
        default:
          return bad(404, `no such resource: ${resource}`);
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? "";
      // A bad id or a bad date is the caller's mistake, not a server fault, and
      // it must read as a sentence rather than a Postgres string.
      if (/invalid input syntax|out of range|Invalid time value|NaN/i.test(msg)) {
        return bad(400, "That is not something we can look up. Check the address or the number and try again.");
      }
      console.error(`GET /data/${resource} failed:`, msg);
      return bad(500, "Something went wrong reading that. Try again.");
    }
  }

  if (ctx.method !== "POST") return bad(405, "method not allowed");

  const b = ctx.body;
  const num = (k: string): number => Number(b[k]);

  /**
   * A visit is between 15 minutes and a 12-hour day.
   *
   * Unbounded, `durationMinutes: -500` produced a job that ended an hour before
   * it started, and `999999999` set the end of a visit to the year 3928. Both
   * were accepted, written, and drawn on the board.
   */
  function minutes(k: string, fallback: number, lo: number, hi: number): number | null {
    if (b[k] === undefined || b[k] === null) return fallback;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < lo || n > hi) return null;
    return n;
  }
  const str = (k: string): string => String(b[k] ?? "");

  // --- the write path, from the buttons ------------------------------------
  //
  // Identical to what the agent calls. One path to test, one to audit; the only
  // difference is the actor column, which is what makes the correction rate a
  // real number rather than two half-numbers.

  if (resource === "actions") {
    try {
      switch (id) {
        case "move": {
          const mins = minutes("durationMinutes", 120, 15, 720);
          if (mins === null) return bad(400, "A visit has to be between 15 minutes and 12 hours.");
          return ok(await withUi((sql) =>
            moveJob(officeCtx(sql, b["by"]), num("jobId"), new Date(str("startsAt")), mins)));
        }
        case "assign": {
          // Only an explicit null means "take everybody off". A MISSING or
          // non-numeric employeeId used to reach Number(undefined) => NaN,
          // which is falsy, which took the unassign path — so a malformed
          // request silently stripped every technician off the job and
          // reported success. On a job already under way that was also
          // irreversible, because two technicians cannot be put back through
          // an endpoint that accepts one id.
          const raw = b["employeeId"];
          if (raw === undefined) return bad(400, "Say which technician, or send employeeId: null to take everybody off.");
          const employeeId = raw === null ? null : Number(raw);
          if (employeeId !== null && !Number.isInteger(employeeId)) {
            return bad(400, "That technician id is not a number.");
          }
          return ok(await withUi((sql) => assignJob(officeCtx(sql, b["by"]), num("jobId"), employeeId)));
        }
        case "cancel":
          return ok(await withUi((sql) =>
            cancelJob(officeCtx(sql, b["by"]), num("jobId"), str("reason") || "no reason given")));
        case "note":
          return ok(await withUi((sql) =>
            addNote(officeCtx(sql, b["by"]), num("jobId"), str("note"))));
        case "late": {
          // A note is permanent and cannot be edited. "Running -9999 minutes
          // late. Customer to be told." was accepted and written.
          const late = minutes("minutes", 30, 5, 480);
          if (late === null) return bad(400, "Say how late, between 5 minutes and 8 hours.");
          return ok(await withUi((sql) => markLate(officeCtx(sql, b["by"]), num("jobId"), late)));
        }
        case "book": {
          const bookMinutes = minutes("durationMinutes", 120, 15, 720);
          if (bookMinutes === null) return bad(400, "A visit has to be between 15 minutes and 12 hours.");
          return ok(await withUi((sql) =>
            bookJob(officeCtx(sql, b["by"]), {
              propertyId: num("propertyId"),
              startsAt: new Date(str("startsAt")),
              durationMinutes: bookMinutes,
              description: str("description") || "Service call",
              employeeId: b["employeeId"] ? num("employeeId") : null,
            })));
        }
        case "undo":
          return ok(await withUi((sql) => undoChange(officeCtx(sql, b["by"]), num("changeId"))));
        default:
          return bad(404, `no such action: ${id}`);
      }
    } catch (err) {
      // A refused write is a normal outcome, not a server fault: "the
      // technician has already started this job" is an answer the screen shows.
      //
      // But the driver's own errors were going out verbatim too, so a dispatcher
      // could be shown `invalid input syntax for type bigint: "NaN"` or a
      // foreign-key constraint name. Those are our bugs leaking as their error
      // message. Our own sentences pass through; the driver's do not.
      const msg = (err as Error).message ?? "";
      if (/violates foreign key constraint .*employee/i.test(msg)) {
        return bad(400, "That technician is not on the list.");
      }
      if (/invalid input syntax|out of range|time zone displacement/i.test(msg)) {
        return bad(400, "Some of those details are not usable. Check the job and the date, then try again.");
      }
      return bad(409, msg);
    }
  }

  if (resource === "queues") {
    try {
      if (sub === "assign") {
        await withUi((sql) =>
          assignQueueItem(sql, id as QueueName, str("subjectType"), num("subjectId"),
            b["ownerId"] ? num("ownerId") : null, (b["dueOn"] as string) ?? null));
        return ok({ ok: true });
      }
      if (sub === "dismiss") {
        // One subject, or several at once: the test line and the demo leave
        // dozens of rehearsal handoffs behind, and clearing them one click at
        // a time is not something an office would put up with.
        const ids = Array.isArray(b["subjectIds"])
          ? (b["subjectIds"] as unknown[]).map(Number).filter((n) => Number.isFinite(n)).slice(0, 200)
          : [num("subjectId")];
        await withUi(async (sql) => {
          for (const subjectId of ids) {
            await dismissQueueItem(sql, id as QueueName, str("subjectType"), subjectId,
              str("reason") || "no reason given");
          }
        });
        return ok({ ok: true, dismissed: ids.length });
      }
      return bad(404, "no such queue action");
    } catch (err) {
      return bad(409, (err as Error).message);
    }
  }

  // --- tickets: the agent proposes, a person decides -----------------------
  //
  // Approval runs the ticket's steps through the write path above, as the
  // office, with the person's name and the ticket number on every change.
  // The other two outcomes write nothing but the decision.

  if (resource === "tickets") {
    try {
      const by = str("by") || "office";
      switch (sub) {
        case "approve":
          return ok(await withUi((sql) => approveTicket(officeCtx(sql, by), Number(id), by)));
        case "dismiss":
          return ok(await withUi((sql) =>
            dismissTicket(sql, Number(id), by, str("reason") || "no reason given")));
        case "counter":
          return ok(await withUi((sql) => counterTicket(sql, Number(id), by, str("note"))));
        default:
          return bad(404, "no such ticket action");
      }
    } catch (err) {
      return bad(409, (err as Error).message);
    }
  }

  // --- ask -----------------------------------------------------------------
  //
  // One model call, one read-only SELECT, every question on the record. The
  // failure modes (a query the model got wrong, a timeout) come back as the
  // result's `error` so the screen can show them where the person is looking.

  if (resource === "ask") {
    try {
      return ok(await withUi((sql) => askQuestion(sql, str("question"))));
    } catch (err) {
      return bad(500, (err as Error).message);
    }
  }

  // --- the test line -------------------------------------------------------
  //
  // The same agent, the same tools, the same write path, reached from a browser
  // tab. It exists because the last thing to fail is always the live call, and
  // because a saved script replayed before every deploy is the cheapest
  // regression harness there is. The published number is untouched by any of it.

  if (resource === "testline") {
    try {
      if (id === "start") {
        const providerCallId = `web_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const session = await withUi((sql) =>
          startSession(sql, {
            providerCallId,
            channel: "web",
            callerLabel: (b["label"] as string) ?? "Test line",
          }));
        return ok({ providerCallId, callId: session.callId });
      }
      if (id === "say") {
        // The call has to already exist. startSession resumes from the record
        // rather than from local memory — correct, because on a serverless host
        // consecutive turns of one conversation land on different instances —
        // but it also happily opened a brand new call for an id nobody had ever
        // started. A typo, or a stale tab posting after a redeploy, created a
        // real call row, burned a model turn, and left a phantom sitting "live"
        // on the dispatcher's screen for fifteen minutes.
        const pcid = str("providerCallId");
        const [known] = await withUi((sql) =>
          sql`select id from "call" where provider_call_id = ${pcid} limit 1`);
        if (!known) return bad(404, "That call is not open. Start the test line again.");
        const session = await withUi((sql) =>
          startSession(sql, { providerCallId: pcid, channel: "web" }));
        const turn = await withUi((sql) => say(sql, session, str("text")));
        return ok({
          callId: turn.callId,
          text: turn.text,
          reasoning: turn.reasoning,
          steps: turn.steps,
          autoEscalated: turn.autoEscalated,
          toolCalls: turn.toolCalls.map((c) => ({
            name: c.name, args: c.args, result: c.result,
            durationMs: c.durationMs, queries: c.queries,
          })),
          proofs: turn.proofs,
        });
      }
      if (id === "end") {
        // Saying "ok" about a call that never existed is a lie the screen then
        // repeats to the person who clicked the button.
        const pcid = str("providerCallId");
        const [known] = await withUi((sql) =>
          sql`select id from "call" where provider_call_id = ${pcid} limit 1`);
        if (!known) return bad(404, "There is no call with that id to end.");
        await withUi((sql) => finishSession(sql, pcid, "test line closed"));
        return ok({ ok: true });
      }
      return bad(404, "no such test line action");
    } catch (err) {
      return bad(500, (err as Error).message);
    }
  }

  return bad(404, `no such resource: ${resource}`);
}
