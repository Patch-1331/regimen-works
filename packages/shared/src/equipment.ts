import type { Equipment } from "./enums.js";

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
 * list reads as an easy yes, yes, no rather than a shopping list. Gym machines
 * come last because they are the one piece nobody keeps at home: ticking it is
 * saying where you train, not what you own. `bar` leads
 * because it is the one piece the app has always assumed -- it was the whole
 * of equipment, as `Exercise.needsBar`, until these tags replaced it (DN-31).
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
    value: "bands",
    label: "Resistance bands",
    description:
      "Any band you can pull against — loop bands, tube bands with handles, or a long physio band. Light ones count.",
  },
  {
    value: "box",
    label: "Box or step",
    description:
      "A stable surface around knee height to step or jump onto — a plyo box, a bench, a sturdy chair, or the bottom stair.",
  },
  {
    value: "bench",
    label: "Bench",
    description:
      "Something flat to lie or sit on at about knee height — a weight bench, flat or adjustable. A sturdy box or a solid chair does the job for most moves.",
  },
  {
    value: "dip_bars",
    label: "Dip bars",
    description:
      "Two parallel handholds you can press yourself up between — a dip station, parallel bars at a park, or the backs of two sturdy chairs.",
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
  {
    value: "foam_roller",
    label: "Foam roller",
    description:
      "Any roller firm enough to lie on — foam, a hollow grid roller, or at a pinch a rolled-up yoga mat.",
  },
  {
    value: "stability_ball",
    label: "Stability ball",
    description:
      "An inflatable ball big enough to lie back over — also sold as an exercise or Swiss ball.",
  },
  {
    value: "medicine_ball",
    label: "Medicine ball",
    description:
      "A weighted ball you can throw, slam or hold — a slam ball or wall ball counts, any weight.",
  },
  {
    value: "barbell",
    label: "Barbell",
    description:
      "A bar you load with plates — an Olympic or standard bar, or an EZ curl bar — and the plates to go on it. Not the pull-up bar: this is the one you lift.",
  },
  {
    value: "suspension_trainer",
    label: "Suspension trainer",
    description:
      "Straps that hang from an anchor and take your bodyweight — gymnastic rings or a TRX.",
  },
  {
    value: "gym_machines",
    label: "Gym machines",
    description:
      "Cable stations and weight machines. One switch for all of them: tick it if you train at a gym that has them.",
  },
];

/**
 * What an athlete owns before they have said anything (DN-81): bodyweight,
 * which is no tag at all, plus the bar.
 *
 * The baseline the app assumed for its whole life before these tags existed,
 * and so the only default that changes no existing athlete's workouts.
 * Owning nothing would silently drop the whole pull group to its fallbacks
 * for everyone who never opens the Settings screen; owning everything would
 * make the setting opt-in-by-discovery.
 *
 * It lives here so the two readers that need it -- `SettingsService`, for an
 * athlete with no `ScheduleRule` row, and the resolver, for the same athlete
 * on the scheduling path -- cannot drift from each other. It still has to
 * match the column default in `schema.prisma`, which nothing links to this;
 * that pairing is what the db-specs assert.
 */
export const DEFAULT_EQUIPMENT: readonly Equipment[] = ["bar"];

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
