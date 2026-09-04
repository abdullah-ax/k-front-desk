/**
 * The tool registry (.claude/plans/front-desk.plan.md, task 11).
 *
 * One file per tool, auto-discovered from this directory. Adding a capability
 * is adding a file; removing one is deleting it. That is the whole test of
 * whether a design is modular, and it is why the agent never sees SQL.
 *
 * The same registry feeds two adapters — in-process for the live call, MCP for
 * development and operations — so a tool is written once and exposed twice.
 */
import type { z } from "zod";
import type { Sql } from "../db/client.js";

export interface ToolContext {
  /** A call-scoped connection. Single round trip per query; already tenant-scoped. */
  sql: Sql;
  /** The voice provider's id for this conversation. */
  callId: string;
  /**
   * Our own `call` row id, when there is one.
   *
   * Every write tool needs it: a change with no call attached is a change
   * nobody can explain, and `.claude/prds/front-desk-platform.prd.md` makes
   * that a failed gate rather than a warning. Optional only because the
   * read-only tools predate the call record and do not need it.
   */
  callRowId?: number;
  /** Property the caller has been resolved to, if resolve_property has run. */
  propertyId?: number;
}

export interface ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /**
   * Written for the model, not for a developer. It should say what the tool is
   * FOR and, where it matters, what it refuses to do.
   */
  description: string;
  schema: S;
  handler: (args: z.infer<S>, ctx: ToolContext) => Promise<string>;
}

const registry = new Map<string, ToolDefinition>();

export function defineTool<S extends z.ZodTypeAny>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}

let loaded = false;

/**
 * Loads every tool module in this directory. Explicit imports rather than a
 * filesystem walk, because the deploy target bundles and a dynamic glob would
 * silently ship zero tools.
 */
export async function loadTools(): Promise<Map<string, ToolDefinition>> {
  if (loaded) return registry;

  const modules = await Promise.all([
    import("./resolve-property.js"),
    import("./get-service-history.js"),
    import("./get-access.js"),
    import("./get-contacts.js"),
    import("./get-balance.js"),
    import("./get-warranty-evidence.js"),
    import("./handoff.js"),
    import("./book-job.js"),
    import("./move-job.js"),
    import("./cancel-job.js"),
    import("./add-note.js"),
    import("./remember-caller.js"),
  ]);

  for (const mod of modules) {
    const tool = (mod as unknown as { default: ToolDefinition }).default;
    if (registry.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    registry.set(tool.name, tool);
  }

  loaded = true;
  return registry;
}

export function getTool(name: string): ToolDefinition | undefined {
  if (!loaded) {
    throw new Error("loadTools() must be awaited before getTool()");
  }
  return registry.get(name);
}

export function allTools(): ToolDefinition[] {
  if (!loaded) {
    throw new Error("loadTools() must be awaited before allTools()");
  }
  return [...registry.values()];
}

/**
 * The tools loaded on every call.
 *
 * Kept deliberately short. Each definition costs 150-300 tokens of prompt on
 * every single turn, and beyond roughly 25 tools the model also gets worse at
 * choosing between them. When this list needs to grow past the hot path, the
 * answer is deferred loading plus a tool-search tool — not a longer list, and
 * not sub-agents, which add a round trip the call cannot afford.
 */
export const HOT_PATH = [
  "resolve_property",
  "get_service_history",
  "get_access",
  "move_job",
  "handoff",
] as const;
