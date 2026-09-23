import { z } from "zod";
import { movementGroup } from "./enums.js";

/**
 * The athlete's standing choice of movement per movement group — the last
 * thing they picked, remembered so they do not re-pick it every session.
 *
 * Not a level (DN-88). The app holds no view about what anyone can do: the
 * stored value is the movement itself (DN-139), which says what they chose and
 * nothing about how they rank. A row exists only once the athlete has chosen
 * something; nobody is provisioned onto one (DN-86), and the default handed to
 * someone who has chosen nothing is resolved at prescription time and never
 * written here.
 */
export const skillLevelSchema = z.object({
  id: z.string(),
  movementGroup: movementGroup,
  exerciseId: z.string().min(1),
  /**
   * Carried so a screen can name the choice without a second request. The name
   * as it stands now, not as it stood when they picked it — this is a live
   * pointer, unlike the completion card's snapshot.
   */
  exerciseName: z.string().min(1),
  updatedAt: z.string().datetime(),
});
export type SkillLevel = z.infer<typeof skillLevelSchema>;

/** Set a group's standing choice directly, rather than through the completion screen. */
export const setSkillLevelRequestSchema = z.object({
  exerciseId: z.string().min(1),
});
export type SetSkillLevelRequest = z.infer<typeof setSkillLevelRequestSchema>;
