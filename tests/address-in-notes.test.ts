/**
 * The dossier must never read a stray address back to a caller.
 *
 * About 11% of the notes in this export name a different street from the
 * property they hang off, because the anonymiser rewrote the note text but not
 * the property row. On a live rehearsal the agent read "7 Doris Rollins Circle"
 * back to a caller who had said "7 Grouper Shores Circle" — while confirming a
 * change to their appointment. The property has nine notes carrying the wrong
 * street and one row carrying the right one.
 */
import { describe, it, expect } from "vitest";
import { useOwnAddress } from "../src/read/property-dossier.js";
describe("useOwnAddress", () => {
  const mine = "7 Grouper Shores Cir";
  it("rewrites a stray address", () => {
    expect(useOwnAddress("Past visits — 7 Doris Rollins Cir, Key Biscayne", mine))
      .toBe("Past visits — 7 Grouper Shores Cir, Key Biscayne");
  });
  it("leaves the property's own address alone, however abbreviated", () => {
    expect(useOwnAddress("Work at 7 Grouper Shores Circle went fine", mine))
      .toBe("Work at 7 Grouper Shores Circle went fine");
  });
  it("does not touch text with no address in it", () => {
    const s = "Blower wheel very dirty. Customer approved the estimate on Aug 26.";
    expect(useOwnAddress(s, mine)).toBe(s);
  });
  it("rewrites every occurrence", () => {
    expect(useOwnAddress("7 Doris Rollins Cir and 4311 Banyan Ridge Blvd", mine))
      .toBe("7 Grouper Shores Cir and 7 Grouper Shores Cir");
  });
  it("is a no-op with no canonical street", () => {
    expect(useOwnAddress("7 Doris Rollins Cir", "")).toBe("7 Doris Rollins Cir");
  });
});
