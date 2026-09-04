/**
 * Ask: a question in plain English, answered from the record.
 *
 * The owner: "I should be able to query the database … with an AI helper to
 * get anything with suggested changes." An office worker does not write SQL,
 * and a raw-SQL tab in the first prototype was rejected out loud for exactly
 * that reason. So the question goes to the same model that answers the phone,
 * which writes one SELECT against the schema it is shown; the statement runs
 * here inside a read-only transaction with a timeout; and the person sees the
 * rows, one sentence saying what they are, the statement itself one click
 * away for whoever audits it later, and a suggested next step when the
 * numbers make one obvious.
 *
 * WHAT IT WILL NOT DO. One SELECT (or WITH … SELECT) runs, checked by string
 * before it reaches the database and by `begin read only` once it does. Two
 * tables are not offered at all: extracted_fact carries the entry codes for
 * 869 properties in its payload, and raw_record carries the whole unredacted
 * export. Every other surface in this platform withholds those, and a question
 * box must not become the way round that. call_event is offered because it is
 * redacted before it is written (src/security/redact.ts).
 *
 * COST. One model call per question, roughly one turn of the phone agent,
 * off the same capped key. Small, but real, and every question is logged to
 * pipeline_run so the spend has a record.
 */
import { generateText } from "ai";
import type { Sql } from "../db/client.js";
import { TZ } from "../config.js";
import { agentModel } from "../models/index.js";

const TABLES = [
  "job", "property", "customer", "employee", "job_employee", "note",
  "invoice", "invoice_item", "call", "call_event", "job_change", "queue_item", "ticket",
];

/**
 * Words that have no business in a question. The transaction is read-only
 * regardless; this is the cheaper, earlier refusal, and it also keeps the two
 * withheld tables out even inside a SELECT.
 */
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|extracted_fact|raw_record|pipeline_run|_migration|pg_catalog|pg_read_file|pg_ls_dir|pg_stat|information_schema|current_setting|set_config|dblink)\b/i;

const ROW_CAP = 100;

export interface AskResult {
  question: string;
  sql: string | null;
  explanation: string;
  suggestion: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  /** What a dispatcher reads when it did not work. Never a Postgres string. */
  error: string | null;
  /** The database's own words, kept for whoever is auditing. */
  detail?: string | null;
  /** True when the first statement failed and a corrected one ran. */
  retried?: boolean;
  /** The tables the statement actually read, parsed from it. */
  source?: string[];
  /** One plain sentence about what came back. Not a restatement of the question. */
  insight?: string | null;
  /** Two or three questions worth asking next, in the reader's own words. */
  nextQuestions?: string[];
}

/**
 * Turns a database complaint into a sentence.
 *
 * A question asked in English that fails should not answer in Postgres. The
 * technical text is still on the result as `detail` and still on the record;
 * this is only what the screen says.
 */
function plainFailure(raw: string): string {
  const s = raw.toLowerCase();
  if (/statement timeout|canceling statement/.test(s)) {
    return "That question took too long to answer. Try narrowing it to a shorter date range.";
  }
  if (/column .* does not exist|relation .* does not exist|missing from-clause/.test(s)) {
    return "That question asked for something the records do not keep. Try naming the fields you want.";
  }
  if (/select distinct|group by|aggregate|order by expressions/.test(s)) {
    return "That question did not come out as a workable search. Try asking it a simpler way.";
  }
  if (/did not produce a query/.test(s)) {
    return "That could not be turned into a search. Try asking it a different way.";
  }
  if (/only a single read|not allowed|forbidden|read only/.test(s)) {
    return "Only questions that read the records are allowed here. Nothing can be changed from this box.";
  }
  if (/^ask something\.?$/.test(s)) return "Ask something.";
  return "That question did not work. Try asking it a different way.";
}

/** The schema as the model sees it: real column names, read from the catalog. */
async function schemaText(sql: Sql): Promise<string> {
  const cols = await sql`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = any(${TABLES})
    order by table_name, ordinal_position
  `;
  const byTable = new Map<string, string[]>();
  for (const c of cols as unknown as { table_name: string; column_name: string; data_type: string }[]) {
    const list = byTable.get(c.table_name) ?? [];
    list.push(`${c.column_name} ${c.data_type.replace("timestamp with time zone", "timestamptz").replace("character varying", "text")}`);
    byTable.set(c.table_name, list);
  }
  return [...byTable.entries()].map(([t, cs]) => `${t === "call" ? '"call"' : t}(${cs.join(", ")})`).join("\n");
}

function systemPrompt(schema: string, today: string): string {
  return [
    "You write one PostgreSQL SELECT for the office of an HVAC company. Reply with JSON only, no prose, no code fence:",
    '{"sql": "<one SELECT>", "explanation": "<one plain-English sentence saying what the rows are>", "suggestion": "<one short sentence proposing an obvious next step for the office, or null>"}',
    "",
    "Rules:",
    "- One SELECT statement. WITH is fine. No writes, no semicolons, no comments, no functions that touch the system.",
    "- LIMIT 50 unless the question is a count or a total.",
    "- Use only the tables and columns listed. Never invent a column.",
    '- The table named call must be written as "call" (quoted).',
    "- Money columns are integer cents: divide by 100.0 and round to 2 places for dollars.",
    `- Timestamps are UTC. The office is in ${TZ}: use (col at time zone '${TZ}')::date for a calendar day. Today is ${today}.`,
    "- 'Today', 'tomorrow', 'this week' refer to job.scheduled_start unless the question says otherwise.",
    "- Exclude canceled jobs (job.is_canceled) and voided invoices (invoice.is_voided) unless asked.",
    "- Prefer readable columns: job.job_ref is the number the office quotes, property.street_raw is the address, a customer's name is coalesce(company, first_name || ' ' || last_name), an employee's name is first_name || ' ' || last_name.",
    "- Do not select jsonb or tags columns unless asked.",
    "",
    "Known values:",
    "- job.work_status: 'scheduled', 'in progress', 'complete rated', 'complete unrated', 'needs scheduling', 'user canceled', 'pro canceled'",
    "- employee.role: 'field tech', 'office staff', 'admin'",
    "- call.handoff_reason: 'safety', 'access_code_unverified_caller', 'install_or_replacement_quote', 'warranty_decision', 'discount_request', 'ambiguous_identity', 'repeat_visit_or_upset_caller', 'repeated_failure_to_understand', 'empty reply', 'other'; null when the agent handled the call",
    "- call.status: 'live' or 'done'. call.channel: 'phone' or 'web' (the test line)",
    "- job_change.actor: 'agent' or 'office'. job_change.kind: 'book', 'move', 'cancel', 'assign', 'note', 'late', 'undo'",
    "- ticket.status: 'open', 'approved', 'dismissed', 'countered'",
    "- job_employee links a job to the technicians on it. invoice.job_id links an invoice to its job.",
    "",
    "Schema:",
    schema,
  ].join("\n");
}

function parseReply(text: string): { sql: string | null; explanation: string; suggestion: string | null } {
  const body = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json|sql)?/gi, "").trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
      return {
        sql: typeof j["sql"] === "string" ? j["sql"] : null,
        explanation: typeof j["explanation"] === "string" ? j["explanation"] : "",
        suggestion: typeof j["suggestion"] === "string" && j["suggestion"].trim() ? j["suggestion"] : null,
      };
    } catch {
      // fall through to the plain-statement case
    }
  }
  return { sql: /^\s*(select|with)\b/i.test(body) ? body : null, explanation: "", suggestion: null };
}

/**
 * The tables a statement actually reads, taken from the statement.
 *
 * No model call: "where did this come from" is answerable by looking, and an
 * answer that costs a second round trip and might be wrong is worse than one
 * that is free and cannot be.
 */
export function tablesIn(sql: string): string[] {
  const found = new Set<string>();
  const re = /\b(?:from|join)\s+"?([a-z_][a-z0-9_]*)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    // `q` is the wrapper this module puts around every statement.
    if (name && name !== "q" && !/^(select|lateral|unnest|generate_series)$/.test(name)) found.add(name);
  }
  return [...found];
}

/** Refuses anything that is not a single SELECT, before the database sees it. */
export function checkStatement(raw: string): { ok: true; sql: string } | { ok: false; reason: string } {
  const s = raw.trim().replace(/;\s*$/, "").trim();
  if (!s) return { ok: false, reason: "The model did not produce a query." };
  if (!/^(select|with)\b/i.test(s)) return { ok: false, reason: "Only a SELECT can run here." };
  if (s.includes(";")) return { ok: false, reason: "One statement at a time." };
  if (s.includes("--") || s.includes("/*")) return { ok: false, reason: "Comments are not allowed in a query." };
  const hit = FORBIDDEN.exec(s);
  if (hit) return { ok: false, reason: `"${hit[1]}" is not something a question can touch.` };
  return { ok: true, sql: s };
}

function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (v && typeof v === "object") return JSON.stringify(v);
  return v;
}

export async function askQuestion(sql: Sql, question: string): Promise<AskResult> {
  const q = question.trim().slice(0, 600);
  const started = Date.now();
  const out: AskResult = {
    question: q, sql: null, explanation: "", suggestion: null,
    columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 0, error: null, detail: null, retried: false, source: [], insight: null, nextQuestions: [],
  };
  if (!q) {
    out.error = "Ask something.";
    return out;
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  try {
    const schema = await schemaText(sql);
    // Thinking OFF, unlike the phone agent. The phone keeps it on because a
    // commitment has to survive three turns (see agentModelOptions); a
    // question is one turn, one SELECT, and with thinking on the same model
    // spent its whole token budget reasoning and returned no statement at
    // all — measured on the first question ever asked through this box.
    const { text } = await generateText({
      model: agentModel(),
      providerOptions: { openrouter: { reasoning: { enabled: false } } } as never,
      system: systemPrompt(schema, today),
      prompt: q,
      temperature: 0,
      maxTokens: 1200,
    });
    const reply = parseReply(text);
    out.explanation = reply.explanation;
    out.suggestion = reply.suggestion;
    if (!reply.sql) {
      throw new Error(
        "The model did not produce a query for that. " +
          (text.trim() ? `It said: ${text.trim().replace(/\s+/g, " ").slice(0, 240)}` : "It returned nothing; try asking it differently."),
      );
    }

    const checked = checkStatement(reply.sql);
    if (!checked.ok) throw new Error(checked.reason);
    out.sql = checked.sql;

    // ONE RETRY, WITH THE DATABASE'S COMPLAINT IN HAND.
    //
    // Most failures here are small, mechanical SQL mistakes the model can fix
    // when it is shown what Postgres objected to — a missing GROUP BY column,
    // an ORDER BY that a SELECT DISTINCT will not accept. Asking again blind
    // reproduces the same mistake; asking again WITH the error usually does
    // not. The retry runs the same read-only, bounded path, so a second
    // statement is no more privileged than the first.
    const run = async (statement: string): Promise<void> => {
      await sql.unsafe("begin read only");
      try {
        await sql.unsafe("set local statement_timeout = '8000'");
        const rows = (await sql.unsafe(`select * from (${statement}) as q limit ${ROW_CAP + 1}`)) as unknown as Record<string, unknown>[];
        out.truncated = rows.length > ROW_CAP;
        const kept = rows.slice(0, ROW_CAP);
        out.columns = kept[0] ? Object.keys(kept[0]) : [];
        out.rows = kept.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
        out.rowCount = kept.length;
      } finally {
        await sql.unsafe("rollback");
      }
    };

    try {
      await run(checked.sql);
    } catch (first) {
      const complaint = String((first as Error)?.message ?? first).replace(/\s+/g, " ").slice(0, 300);
      const retry = await generateText({
        model: agentModel(),
        providerOptions: { openrouter: { reasoning: { enabled: false } } } as never,
        system: systemPrompt(schema, today),
        prompt:
          `${q}\n\nYour last statement did not run. The database said:\n${complaint}\n\n` +
          `Here is the statement that failed:\n${checked.sql}\n\n` +
          `Fix it and return the corrected statement in the same format. Change only what the error requires.`,
        temperature: 0,
        maxTokens: 1200,
      });
      const second = parseReply(retry.text);
      if (!second.sql) throw first;
      const rechecked = checkStatement(second.sql);
      if (!rechecked.ok) throw first;
      out.sql = rechecked.sql;
      out.retried = true;
      await run(rechecked.sql);
    }
    // --- what it means, and what to ask next ------------------------------
    //
    // A table answers the question that was asked. It does not say whether the
    // number is big, or what the obvious follow-up is, and the person reading
    // it asked in English and would like an answer in English. One extra call,
    // with at most fifteen rows, because the point is a sentence — not a
    // second pass over data the reader already has in front of them.
    out.source = tablesIn(out.sql ?? "");
    if (out.rowCount > 0) {
      try {
        const sample = JSON.stringify(out.rows.slice(0, 15));
        const { text: read } = await generateText({
          model: agentModel(),
          providerOptions: { openrouter: { reasoning: { enabled: false } } } as never,
          system:
            "You read a small table and say what it means to someone at a front desk. " +
            "They left school after high school; write the way you would say it out loud. " +
            "Short words, short sentences, no jargon — say 'look up' not 'query', 'money owed' not 'receivable'. " +
            "Never repeat the question back. Never describe the table ('this shows...'). " +
            "Say the thing that matters: the number, the name, the outlier, the total. " +
            "WRITE NUMBERS AS DIGITS, the way they look on a screen: $563,524.05 and 38 and 12%. " +
            "Never spell an amount out in words — this is read with the eyes, not heard on a phone, " +
            "and 'five hundred sixty-three thousand five hundred twenty-four dollars and five cents' " +
            "is unreadable where $563,524.05 is not. " +
            'Reply as JSON only: {"insight":"one or two short sentences","next":["question","question","question"]}. ' +
            "Each `next` is a question a person would type into the same box, in plain English, under twelve words. " +
            "They must be answerable from a field service database of jobs, properties, customers, invoices and technicians.",
          prompt: `They asked: ${q}\n\nColumns: ${out.columns.join(", ")}\nRows (up to 15 of ${out.rowCount}): ${sample}`,
          temperature: 0,
          maxTokens: 400,
        });
        const body = read.replace(/```(?:json)?/gi, "").trim();
        const s = body.indexOf("{"), e2 = body.lastIndexOf("}");
        if (s >= 0 && e2 > s) {
          const j = JSON.parse(body.slice(s, e2 + 1)) as Record<string, unknown>;
          if (typeof j["insight"] === "string" && j["insight"].trim()) out.insight = j["insight"].trim();
          if (Array.isArray(j["next"])) {
            out.nextQuestions = (j["next"] as unknown[])
              .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
              .slice(0, 3)
              .map((x) => x.trim());
          }
        }
      } catch {
        // A missing sentence is not a failed answer. The table still stands.
      }
    }
  } catch (err) {
    const raw = String((err as Error)?.message ?? err).replace(/\s+/g, " ").slice(0, 400);
    out.detail = raw;
    // What a dispatcher reads. The Postgres text stays on the result as
    // `detail` for whoever is auditing, and on the record either way, but
    // "for SELECT DISTINCT, ORDER BY expressions must appear in select list"
    // is not an answer to give someone who asked a question in English.
    out.error = plainFailure(raw);
  }
  out.durationMs = Date.now() - started;

  // On the record. A question that cost money and a statement that ran
  // against customer data are both things the owner can ask about later.
  try {
    await sql`
      insert into pipeline_run (tenant_id, task, status, finished_at, rows_out, detail, error)
      values (
        current_setting('app.tenant_id', true), 'ask', ${out.error ? "failed" : "ok"}, now(),
        ${out.rowCount},
        ${sql.json({ question: q, sql: out.sql, explanation: out.explanation, suggestion: out.suggestion, durationMs: out.durationMs })},
        ${out.error}
      )
    `;
  } catch (err) {
    console.error("ask: could not record the question:", (err as Error)?.message ?? err);
  }
  return out;
}
