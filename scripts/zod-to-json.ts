/**
 * Minimal Zod → JSON Schema conversion for Vapi tool definitions.
 *
 * Deliberately not a dependency: the tool schemas here are flat objects of
 * strings, numbers and enums, and a general-purpose converter would be several
 * hundred kilobytes to handle recursion and unions this codebase does not use.
 * Anything it cannot express throws loudly rather than emitting a schema that
 * silently accepts the wrong shape — a tool that takes the wrong arguments on a
 * live call fails in the worst possible place.
 */
import { z } from "zod";

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema & { description?: string }>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  description?: string;
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  // Unwrap optional/nullable/default so the inner type is what we describe.
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return convert(schema.unwrap() as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodDefault) {
    return convert(schema._def.innerType as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };

  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema._def.values as string[] };
  }

  if (schema instanceof z.ZodArray) {
    return { type: "array", items: convert(schema._def.type as z.ZodTypeAny) };
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema & { description?: string }> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const inner = convert(value);
      const description = value.description;
      properties[key] = description ? { ...inner, description } : inner;
      if (!value.isOptional()) required.push(key);
    }

    return { type: "object", properties, ...(required.length ? { required } : {}) };
  }

  throw new Error(
    `zod-to-json: unsupported schema type "${schema.constructor.name}". ` +
      `Keep tool arguments to flat objects of strings, numbers, booleans and enums, ` +
      `or extend this converter deliberately.`,
  );
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convert(schema);
}
