import { describe, expect, it } from "vitest";
import { parseRestDraft, restDraftOf, restSecondsOf } from "./rest";

describe("parseRestDraft", () => {
  it("reads whole seconds as a pace", () => {
    expect(parseRestDraft(" 90 ")).toEqual({ kind: "pace", seconds: 90 });
  });

  it("keeps 0 a pace -- straight through -- and blank not one", () => {
    expect(parseRestDraft("0")).toEqual({ kind: "pace", seconds: 0 });
    expect(parseRestDraft("")).toEqual({ kind: "blank" });
    expect(restSecondsOf(parseRestDraft("0"))).toBe(0);
    expect(restSecondsOf(parseRestDraft(""))).toBeNull();
  });

  it("refuses what is not a whole number of seconds", () => {
    for (const draft of ["-5", "1.5", "90s", "abc"]) {
      expect(parseRestDraft(draft)).toEqual({ kind: "invalid" });
    }
  });
});

describe("restDraftOf", () => {
  it("round-trips a pace, and shows no pace as blank rather than 0", () => {
    expect(restDraftOf(90)).toBe("90");
    expect(restDraftOf(0)).toBe("0");
    expect(restDraftOf(null)).toBe("");
  });
});
