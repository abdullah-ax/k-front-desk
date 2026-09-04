/**
 * Task 2 gate — the model adapter.
 *
 * Two things are checked, and the second matters more than the first:
 *   1. All three roles actually resolve and return a completion.
 *   2. No file outside src/models imports a provider SDK. That is what keeps
 *      "switch MODEL_AGENT to a direct provider" a one-line change instead of
 *      a refactor.
 *
 * Kept deliberately cheap — a handful of tokens per role. This runs on every
 * overnight start, before anything expensive.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { generateText } from "ai";
import { ROOT } from "../src/config.js";
import { extractModel, agentModel, judgeModel, slugFor, readBudget } from "../src/models/index.js";

const ROLES = [
  { name: "MODEL_EXTRACT", model: extractModel },
  { name: "MODEL_AGENT", model: agentModel },
  { name: "MODEL_JUDGE", model: judgeModel },
] as const;

describe("model roles resolve", () => {
  for (const role of ROLES) {
    it(`${role.name} returns a completion`, async () => {
      const { text } = await generateText({
        model: role.model(),
        // Minimal prompt with a deterministic answer, so a wrong response is
        // obviously wrong rather than plausibly wrong.
        prompt: "Reply with exactly one word: ready",
        // Not 8. Several of these are REASONING models, and a tight cap gets
        // spent on thinking tokens before a single visible character is
        // emitted — the call succeeds and returns an empty string. Observed
        // intermittently on deepseek-v4-flash while the same model passed as
        // MODEL_EXTRACT moments earlier, which is what made it look like a
        // provider fault rather than a starved budget.
        maxTokens: 256,
      });
      expect(text.toLowerCase(), `${role.name} returned empty text`).toContain("ready");
    }, 60_000);
  }

  it("reports which slug each role uses", () => {
    for (const role of ROLES) {
      const slug = slugFor(role.name);
      expect(slug.length).toBeGreaterThan(0);
      console.log(`    ${role.name} → ${slug}`);
    }
  });
});

describe("budget is readable and bounded", () => {
  it("the key reports a spend limit", async () => {
    const b = await readBudget();
    console.log(`    limit $${b.limit ?? "none"}, used $${b.usage.toFixed(4)}`);
    // An unattended run against an unlimited key is the one failure that costs
    // real money while nobody is watching.
    expect(b.limit, "set a hard spend limit on the OpenRouter key (setup A2)").not.toBeNull();
  }, 30_000);
});

describe("provider SDKs stay behind the adapter", () => {
  const PROVIDER_IMPORTS = [
    "@openrouter/ai-sdk-provider",
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
    "@anthropic-ai/sdk",
    "openai",
  ];

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  it("only src/models imports a provider SDK", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      if (rel.startsWith(join("src", "models"))) continue;
      const source = readFileSync(file, "utf8");
      for (const pkg of PROVIDER_IMPORTS) {
        if (source.includes(`from "${pkg}"`) || source.includes(`from '${pkg}'`)) {
          offenders.push(`${rel} imports ${pkg}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
