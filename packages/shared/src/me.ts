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
  /**
   * When the athlete finished the first-run wizard, or null if they have not
   * (DN-15). The web client's setup gate reads this and nothing else.
   *
   * Here rather than on `/settings` for the same reason `isAdmin` is: this
   * is a fact about the account, and `settingsSchema.partial()` is the PATCH
   * body, so a field there sits one derivation away from being writable. The
   * one thing a client must not be able to do is tell the API it has
   * onboarded.
   *
   * It is what turned this endpoint from a free read of the token into one
   * primary-key lookup -- see the controller.
   */
  onboardedAt: z.string().datetime().nullable(),
});
export type Me = z.infer<typeof meSchema>;
