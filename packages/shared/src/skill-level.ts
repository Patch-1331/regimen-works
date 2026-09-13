import { z } from "zod";
import { progressionLine } from "./enums.js";

/**
 * The athlete's standing choice of movement per progression line — the last
 * thing they picked, remembered so they do not re-pick it every session.
 *
 * Not a level (DN-88). The app holds no view about what anyone can do: `rung`
 * is where the chosen movement sits in the line's list, which is a sort order
 * and a grouping, not a score. A row exists only once the athlete has chosen
 * something; nobody is provisioned onto one (DN-86).
 */
export const skillLevelSchema = z.object({
  id: z.string(),
  line: progressionLine,
  rung: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type SkillLevel = z.infer<typeof skillLevelSchema>;

/** Set a line's standing choice directly, rather than through the completion screen. */
export const setSkillLevelRequestSchema = z.object({
  rung: z.number().int().nonnegative(),
});
export type SetSkillLevelRequest = z.infer<typeof setSkillLevelRequestSchema>;
