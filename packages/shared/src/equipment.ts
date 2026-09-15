import { equipment, type Equipment } from "./enums.js";

/**
 * A piece of equipment as the athlete meets it: the word on the Settings row,
 * and what actually counts as owning it.
 *
 * The copy is part of the data rather than the screen because it decides
 * whether the setting is answered honestly. "Box" ticked by someone who owns
 * a box but not by someone with a staircase and a kitchen chair is a worse
 * library for the second athlete and a lie about the first — so the row has
 * to say what the app will accept, in the same place the value is defined.
 */
export type EquipmentInfo = {
  value: Equipment;
  /** How the piece is named to the athlete — the Settings row's label. */
  label: string;
  /**
   * What counts as owning it, written to be read while deciding. Deliberately
   * generous: the app asks whether the movement is possible, not whether the
   * athlete bought the right thing.
   */
  description: string;
};

/**
 * Every piece an athlete can own, in the order Settings shows them.
 *
 * Ordered most to least likely to already be in a garage or a doorway, so the
 * list reads as an easy yes, yes, no rather than a shopping list. `bar` leads
 * because it is the one piece the app has always assumed (see
 * `Exercise.needsBar`, which the equipment tags replace).
 *
 * This array is the settings list. There is no separate "selectable" subset to
 * keep in step with it — the reason `bodyweight` is not in the enum at all.
 */
export const EQUIPMENT_CATALOG: readonly EquipmentInfo[] = [
  {
    value: "bar",
    label: "Pull-up bar",
    description:
      "Anything you can hang from with straight arms and feet clear of the floor — a doorway bar, a rack, a beam, a sturdy branch.",
  },
  {
    value: "jump_rope",
    label: "Jump rope",
    description: "Any skipping rope long enough to clear your head.",
  },
  {
    value: "box",
    label: "Box or step",
    description:
      "A stable surface around knee height to step or jump onto — a plyo box, a bench, a sturdy chair, or the bottom stair.",
  },
  {
    value: "dumbbell",
    label: "Dumbbell",
    description:
      "One or more dumbbells, any weight. A loaded backpack or a water jug with a handle does the same job.",
  },
  {
    value: "kettlebell",
    label: "Kettlebell",
    description:
      "One or more kettlebells, any weight. The swing is what makes this its own row — a dumbbell held by one end substitutes for most of the rest.",
  },
];

const BY_VALUE: Record<Equipment, EquipmentInfo> = Object.fromEntries(
  EQUIPMENT_CATALOG.map((info) => [info.value, info]),
) as Record<Equipment, EquipmentInfo>;

/**
 * The catalog entry for one piece.
 *
 * Total over the enum rather than nullable: the type says the value is a real
 * piece of equipment, and `equipment.parse` is what turns an untrusted string
 * into one. A caller holding a raw string should parse it first rather than
 * hand it here and check for undefined.
 */
export function equipmentInfo(value: Equipment): EquipmentInfo {
  return BY_VALUE[value];
}

/** The label alone, for the common case of naming a piece in a sentence. */
export function equipmentLabel(value: Equipment): string {
  return BY_VALUE[value].label;
}
