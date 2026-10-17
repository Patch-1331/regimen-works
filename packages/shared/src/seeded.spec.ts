import { describe, expect, it } from "vitest";
import { SEEDED_SOURCE, seededRefusal } from "./seeded";

describe("seededRefusal", () => {
  // What an admin reads on a 409 (DN-151, ADR 0010): the row, why the change
  // would not last, and the one file to make it in instead.
  it("names a seeded movement and the library file to change", () => {
    const message = seededRefusal("exercise", "Pullups");
    expect(message).toContain('"Pullups" is a seeded movement');
    expect(message).toContain(SEEDED_SOURCE.exercise);
  });

  it("names a seeded workout and the WOD file to change", () => {
    const message = seededRefusal("wod", "Cindy");
    expect(message).toContain('"Cindy" is a seeded workout');
    expect(message).toContain("apps/api/prisma/wod-seed.ts");
  });
});
