import { useState } from "react";

/**
 * Remembering that an athlete declined a change of movement (WOD-6).
 *
 * Per assignment, so coming back to edit a note doesn't re-ask a question
 * already answered. A browser-local convenience rather than domain state: it
 * records that someone said "not now" to one prompt, which is worth nothing
 * on another device and nothing to the API.
 */

const dismissedKey = (assignmentId: string) =>
  `movement-change-dismissed:${assignmentId}`;

export function wasDismissed(assignmentId: string): boolean {
  try {
    return localStorage.getItem(dismissedKey(assignmentId)) === "1";
  } catch {
    // Private windows and blocked site data throw on access. A forgotten
    // dismissal just re-asks, which is the harmless direction to fail in.
    return false;
  }
}

export function rememberDismissed(assignmentId: string): void {
  try {
    localStorage.setItem(dismissedKey(assignmentId), "1");
  } catch {
    // Nothing to do — see above.
  }
}

/** The state the card needs, kept here so the page stays about logging a result. */
export function useMovementChangeCard(assignmentId: string) {
  const [dismissed, setDismissed] = useState(() => wasDismissed(assignmentId));

  return {
    dismissed,
    dismiss: () => {
      rememberDismissed(assignmentId);
      setDismissed(true);
    },
  };
}
