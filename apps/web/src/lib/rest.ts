/**
 * The rest-pace field, as the wizard and Settings both read it (DN-143).
 *
 * Seconds in a text box. Blank is an answer -- "use the routine's own" -- and
 * so is 0, which is "straight through": the two are the null and the zero the
 * whole issue exists to keep apart, so blank never parses as 0.
 */

/** What the box holds: a pace, no pace, or something that is neither. */
export type RestDraft =
  | { kind: "pace"; seconds: number }
  | { kind: "blank" }
  | { kind: "invalid" };

export function parseRestDraft(draft: string): RestDraft {
  const trimmed = draft.trim();
  if (trimmed === "") return { kind: "blank" };
  // Digits only: "-5", "1.5" and "90s" are all things a person might type,
  // and none of them is a whole number of seconds this can send.
  if (!/^\d+$/.test(trimmed)) return { kind: "invalid" };
  return { kind: "pace", seconds: Number(trimmed) };
}

/** The value a draft sends, where it sends one -- null for blank. */
export function restSecondsOf(draft: RestDraft): number | null {
  return draft.kind === "pace" ? draft.seconds : null;
}

/** The box's text for a stored pace. */
export function restDraftOf(seconds: number | null): string {
  return seconds === null ? "" : String(seconds);
}
