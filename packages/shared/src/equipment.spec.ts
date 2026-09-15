import { describe, expect, it } from "vitest";
import { equipment } from "./enums.js";
import {
  EQUIPMENT_CATALOG,
  equipmentInfo,
  equipmentLabel,
} from "./equipment.js";

/**
 * The catalog's whole job is to be the only list. These tests are mostly
 * about that: a piece added to the enum without a row here, or a row left
 * behind by a removal, would otherwise surface as a Settings screen missing
 * an option — visible to nobody until an athlete goes looking for the piece
 * they own.
 */

describe("EQUIPMENT_CATALOG", () => {
  it("has a row for every value in the enum, and nothing else", () => {
    expect(EQUIPMENT_CATALOG.map((info) => info.value).sort()).toEqual(
      [...equipment.options].sort(),
    );
  });

  it("lists each piece once", () => {
    const values = EQUIPMENT_CATALOG.map((info) => info.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("gives every piece a label and a description to tick it by", () => {
    for (const info of EQUIPMENT_CATALOG) {
      expect(info.label.length, `${info.value} label`).toBeGreaterThan(0);
      expect(info.description.length, `${info.value} description`).toBeGreaterThan(0);
    }
  });

  it("leads with the bar, the piece the app already assumed", () => {
    expect(EQUIPMENT_CATALOG[0].value).toBe("bar");
  });
});

describe("the enum", () => {
  it("rejects bodyweight, which is the baseline rather than a piece", () => {
    // Not an oversight: an exercise needing nothing carries no tags, and
    // there is no Settings row for owning your own body.
    expect(equipment.safeParse("bodyweight").success).toBe(false);
  });

  it("rejects anything not in the catalog", () => {
    expect(equipment.safeParse("barbell").success).toBe(false);
    expect(equipment.safeParse("").success).toBe(false);
  });

  it("accepts every value the catalog offers", () => {
    for (const info of EQUIPMENT_CATALOG) {
      expect(equipment.safeParse(info.value).success).toBe(true);
    }
  });
});

describe("equipmentInfo / equipmentLabel", () => {
  it("looks a piece up by value", () => {
    expect(equipmentInfo("jump_rope").label).toBe("Jump rope");
    expect(equipmentInfo("box").description).toContain("stair");
  });

  it("returns the same row the catalog holds", () => {
    for (const info of EQUIPMENT_CATALOG) {
      expect(equipmentInfo(info.value)).toBe(info);
    }
  });

  it("names a piece for a sentence", () => {
    expect(equipmentLabel("kettlebell")).toBe("Kettlebell");
  });
});
