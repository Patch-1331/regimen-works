import { z } from "zod";

/**
 * Who the caller is, as the API sees them (DN-92).
 *
 * Its own endpoint rather than a field on `/settings`: settings are athlete
 * preferences and PATCHable, and `updateSettingsSchema` is `settingsSchema
 * .partial()`. An `isAdmin` field there would sit one derivation away from
 * being a writable one.
 *
 * `isAdmin` is for rendering, not for access. The API refuses an admin route
 * on its own; this only keeps the UI from offering a button that 403s.
 */
export const meSchema = z.object({
  id: z.string(),
  isAdmin: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;
