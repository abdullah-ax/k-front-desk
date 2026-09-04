/**
 * The reply must not claim a write that never happened.
 *
 * On a live call the agent said "I've added that note — gate code changed, use
 * the service entrance" and never called add_note. Three tools ran, one change
 * was filed, and the note did not exist. It happened about one time in six,
 * which is worse than always: a caller who is told something is recorded has no
 * way to know it is not, and neither has the technician who turns up.
 *
 * The loop now checks for the claim mechanically and gives the model one chance
 * to do what it said. This pins the detector, because a detector that misses the
 * sentence that started all this is worth nothing.
 */
import { describe, it, expect } from "vitest";

/** The same expression the loop uses. Kept in step by these tests. */
const CLAIMED_A_WRITE =
  /\b(i(?:'ve| have)\s+(?:added|put|noted|recorded|moved|booked|cancell?ed|scheduled|updated)|(?:that'?s|it'?s)\s+(?:on|in)\s+the\s+job|added that note|i(?:'ve| have)\s+got that (?:down|on))\b/i;

describe("catching a write the reply only claimed", () => {
  const claims = [
    "I've added that note — gate code changed, use the service entrance.",
    "I have added the note about the gate code.",
    "Done — that's on the job for September 8th.",
    "I've put that on the job for the technician.",
    "I've noted that for the crew.",
    "I've moved that to Tuesday the 8th.",
    "I've booked you in for Friday morning.",
    "I've cancelled that visit for you.",
    "I've got that down for the technician.",
    "It's on the job now.",
  ];
  for (const line of claims) {
    it(`catches: ${line.slice(0, 46)}`, () => {
      expect(CLAIMED_A_WRITE.test(line)).toBe(true);
    });
  }

  // The check must not fire on an ordinary answer, or every clean turn would
  // spend a second model call proving there was nothing to fix.
  const innocent = [
    "We were out on August 19th for a duct inspection on the third floor.",
    "I can move that to Tuesday the 8th in the morning. Is that right?",
    "I'm not able to read entry codes over the phone.",
    "Someone from the office will call you back with a quote.",
    "Your balance is six thousand four hundred and ninety nine dollars.",
    "I'll need to get someone out to you right away.",
    "Is there anything else I can help you with?",
    "That visit is already under way, so I cannot move it.",
  ];
  for (const line of innocent) {
    it(`leaves alone: ${line.slice(0, 42)}`, () => {
      expect(CLAIMED_A_WRITE.test(line)).toBe(false);
    });
  }
});
