/**
 * Query capture: the layer below the tool boundary
 * (.claude/prds/call-observability.prd.md, milestone 3).
 *
 * Before this, a call trace could say `get_service_history({property_id: 7844})`
 * was called and nothing more. It could not say what that ran, how long it took
 * or how many rows came back, so a slow turn or an empty answer had nowhere to
 * be traced to. That gap cost real time on this build once already: a reasoning
 * model returned an empty string because its token budget went on thinking, and
 * no log surface showed it.
 *
 * How it works: postgres.js exposes `sql` as a tagged-template FUNCTION that
 * also carries methods. A Proxy with an `apply` trap therefore sees every
 * query without any call site changing, which matters because the alternative
 * is threading a recorder through seven tools and the dossier.
 *
 * WHAT IS STORED, AND WHAT DELIBERATELY IS NOT:
 *
 *   stored      the statement text with $1, $2 placeholders intact
 *   not stored  the parameter values
 *
 * That answers the open question the PRD raises. A bound parameter can carry a
 * resolved address, and in the wrong tool a code-shaped value, so the safe
 * default is to keep the shape of the query and drop its arguments. The shape
 * is what explains a slow or empty answer; the values are already visible one
 * layer up, in the tool arguments, where they have been redacted.
 */
import type { Sql } from "../db/client.js";

export interface QueryRecord {
  statement: string;
  durationMs: number;
  rowCount: number;
}

/** Collapses whitespace so a template-literal query reads as one line. */
function normalise(strings: readonly string[]): string {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < strings.length - 1) out += `$${i + 1}`;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 2000);
}

/**
 * Wraps a connection so every query it runs is handed to `sink`.
 *
 * The returned value is a drop-in replacement: methods (`begin`, `reserve`,
 * `unsafe`, and the helper form `sql(values)`) pass straight through, and only
 * the tagged-template form is timed. A helper call like `sql(rows)` builds a
 * fragment rather than executing, so timing it would record a query that never
 * ran.
 */
export function instrument(sql: Sql, sink: (q: QueryRecord) => void): Sql {
  return new Proxy(sql as unknown as object, {
    apply(target, thisArg, args: unknown[]) {
      const [first] = args;
      const isTemplate =
        Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, "raw");

      const result = Reflect.apply(target as () => unknown, thisArg, args) as unknown;
      if (!isTemplate) return result;

      const statement = normalise(first as unknown as string[]);
      const started = Date.now();

      // postgres.js returns a thenable query object. Attaching here rather than
      // awaiting keeps this transparent: the caller still gets the same object
      // with `.values()`, `.forEach()` and the rest intact.
      const query = result as PromiseLike<unknown[]> & { then?: unknown };
      if (query && typeof query.then === "function") {
        void Promise.resolve(query).then(
          (rows) => {
            sink({
              statement,
              durationMs: Date.now() - started,
              rowCount: Array.isArray(rows) ? rows.length : 0,
            });
          },
          () => {
            sink({ statement, durationMs: Date.now() - started, rowCount: -1 });
          },
        );
      }
      return result;
    },
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as Sql;
}
