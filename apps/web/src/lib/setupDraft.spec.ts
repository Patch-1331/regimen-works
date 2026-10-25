import { afterEach, describe, expect, it } from "vitest";
import { addIsoDays } from "@regimen-works/shared";
import * as fixtures from "../test/fixtures";
import { answersLeft, kitLine, readDraft, writeDraft } from "./setupDraft";
import type { SetupDraft } from "./setupDraft";

/**
 * A draft is read days after it was written (DN-198), against options that
 * have moved on. What survives is the answers that still fit, in order: one
 * that no longer does is asked again, along with everything after it.
 */

const options = fixtures.setupOptions();
const draft: SetupDraft = {
  answered: 4,
  kit: ["bar"],
  programId: fixtures.boundedProgram().id,
  days: [1, 3, 5],
  weeks: 6,
  startDate: options.earliestStartDate,
  restEdit: null,
};

afterEach(() => localStorage.clear());

describe("readDraft", () => {
  it("reads back what was written, for that athlete only", () => {
    writeDraft("user_alice", draft);
    expect(readDraft("user_alice", options)).toEqual(draft);
    expect(readDraft("user_bob", options)).toBeNull();
  });

  it("asks the start date again once it is no longer offered", () => {
    writeDraft("user_alice", {
      ...draft,
      startDate: addIsoDays(options.earliestStartDate, -1),
    });
    expect(readDraft("user_alice", options)?.answered).toBe(3);
  });

  it("asks the program again, and everything after it, once it is gone", () => {
    writeDraft("user_alice", { ...draft, programId: "program-archived" });
    expect(readDraft("user_alice", options)?.answered).toBe(1);
  });

  it("asks the days again when the length no longer fits the program", () => {
    writeDraft("user_alice", { ...draft, weeks: 99 });
    expect(readDraft("user_alice", options)?.answered).toBe(2);
  });

  it("drops pieces of kit the catalog no longer has", () => {
    writeDraft("user_alice", {
      ...draft,
      kit: ["bar", "trampoline"] as unknown as SetupDraft["kit"],
    });
    expect(readDraft("user_alice", options)?.kit).toEqual(["bar"]);
  });

  it("is nothing when nothing was answered, or the value is not a draft", () => {
    writeDraft("user_alice", { ...draft, answered: 0 });
    expect(readDraft("user_alice", options)).toBeNull();

    localStorage.setItem("setup-draft:user_alice", "{not json");
    expect(readDraft("user_alice", options)).toBeNull();
  });
});

describe("answersLeft", () => {
  it("counts what is left in words", () => {
    expect(answersLeft(1)).toBe("Three answers left");
    expect(answersLeft(3)).toBe("One answer left");
  });
});

describe("kitLine", () => {
  it("names a short kit and shortens a long one", () => {
    expect(kitLine([])).toBe("Nothing — bodyweight");
    expect(kitLine(["bar"])).toBe("Pull-up bar");
    expect(kitLine(["bar", "bench"])).toBe("Pull-up bar and Bench");
    expect(kitLine(["bar", "bands", "bench", "dumbbell"])).toBe(
      "Pull-up bar, Resistance bands and 2 more",
    );
  });
});
