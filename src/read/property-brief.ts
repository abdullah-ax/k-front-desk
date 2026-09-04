/**
 * Three sentences about a building, for somebody about to pick up the phone.
 *
 * The Property screen already shows everything on file — every fact, every
 * visit, every note, each with its source. That is the right thing for an
 * auditor and too much for a dispatcher with a caller waiting. This is the
 * version you read while the phone is ringing: what this place is, what is
 * outstanding, and the one thing that would catch you out.
 *
 * It reads the SAME dossier the agent reads, so the screen and the phone cannot
 * tell two different stories about one building.
 */
import { generateText } from "ai";
import { agentModel } from "../models/index.js";
import type { Sql } from "../db/client.js";
import { getPropertyDossier, renderDossier } from "./property-dossier.js";

export interface PropertyBrief {
  propertyId: number;
  brief: string | null;
  error: string | null;
  durationMs: number;
}

export async function briefProperty(sql: Sql, propertyId: number): Promise<PropertyBrief> {
  const started = Date.now();
  const out: PropertyBrief = { propertyId, brief: null, error: null, durationMs: 0 };

  const d = await getPropertyDossier(propertyId, sql);
  if (!d) {
    out.error = "No building with that number.";
    out.durationMs = Date.now() - started;
    return out;
  }

  try {
    const { text } = await generateText({
      model: agentModel(),
      providerOptions: { openrouter: { reasoning: { enabled: false } } } as never,
      system:
        "You brief a dispatcher who is about to speak to somebody about this building. " +
        "THREE SHORT SENTENCES, maximum. No heading, no list, no preamble, no sign-off. " +
        "They left school after high school: short words, short sentences, no jargon. " +
        "Write numbers as digits — $6,499.50 and 3 visits, never spelled out in words. " +
        "Sentence one: what this place is and who the account is. " +
        "Sentence two: what is outstanding — money owed, the next visit, anything unfinished. " +
        "Sentence three: the one thing that would catch somebody out — a standing rule, an " +
        "access quirk, a warranty position, a pattern in the visits. If nothing would, leave it out " +
        "and write two sentences. " +
        "Never invent anything. Never mention an entry code's value; saying one is on file is fine. " +
        "Do not say 'this property' — say the street.",
      prompt: renderDossier(d).slice(0, 12000),
      temperature: 0,
      maxTokens: 300,
    });
    const brief = text.replace(/```/g, "").trim();
    out.brief = brief ? brief.slice(0, 700) : null;
  } catch (err) {
    // A missing briefing is not a broken page. Everything it summarises is
    // already on screen underneath it.
    out.error = "Could not write a briefing just now.";
    void err;
  }

  out.durationMs = Date.now() - started;
  return out;
}
