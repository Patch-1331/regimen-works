import { EQUIPMENT_CATALOG, equipmentLabel } from "@regimen-works/shared";
import type { Equipment, SetupOptions } from "@regimen-works/shared";
import { SETUP_QUESTIONS, weeksChoice } from "./setup";

/**
 * The first-run wizard's answers so far, kept for an athlete who leaves
 * halfway (DN-198).
 *
 * In this browser, under the Clerk user id, rather than on the API: the
 * commit at the end stays the wizard's only write, and a shared device never
 * hands one athlete another's half-finished setup. The cost is that a second
 * device starts at Welcome, which is the same place it started before.
 *
 * Every read and write survives storage being unavailable. No draft just
 * means Welcome, which is where the athlete would have landed anyway.
 */
export interface SetupDraft {
  /**
   * How many questions are answered, counted from the first: the next one to
   * ask is `SETUP_QUESTIONS[answered]`. A count rather than a set, because
   * the wizard is a sequence and Back walks it -- "the first unanswered" is
   * the only place carrying on can open.
   */
  answered: number;
  kit: Equipment[];
  programId: string;
  days: number[];
  weeks: number | null;
  startDate: string;
  /** The rest field as typed on the last screen, or null if untouched. */
  restEdit: string | null;
}

const draftKey = (userId: string) => `setup-draft:${userId}`;

/**
 * The draft as it can still be used against today's options, or null.
 *
 * A draft is days old by the time it is read, and the options have moved on:
 * the program may be archived, and the start dates offered slide forward
 * daily. An answer that no longer fits is dropped together with every answer
 * after it, so carrying on opens on the first question that needs asking
 * again rather than on a commit the API would refuse.
 */
export function readDraft(
  userId: string,
  options: SetupOptions,
): SetupDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(draftKey(userId)) ?? "null");
  } catch {
    // Blocked storage throws on access, and a hand-edited value on parse.
    // Either way there is nothing to carry on with.
    return null;
  }
  return restore(raw, options);
}

export function writeDraft(userId: string, draft: SetupDraft): void {
  try {
    localStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    // Nothing to do: the wizard works the same, and only a later visit
    // misses out -- landing on Welcome, as it did before drafts existed.
  }
}

export function clearDraft(userId: string): void {
  try {
    localStorage.removeItem(draftKey(userId));
  } catch {
    // As above. A draft that cannot be removed could not be read either.
  }
}

function restore(raw: unknown, options: SetupOptions): SetupDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;

  let answered =
    typeof value.answered === "number" && Number.isInteger(value.answered)
      ? Math.min(Math.max(value.answered, 0), SETUP_QUESTIONS.length)
      : 0;

  const pieces = new Set<string>(EQUIPMENT_CATALOG.map((p) => p.value));
  const kit = Array.isArray(value.kit)
    ? (value.kit.filter(
        (p) => typeof p === "string" && pieces.has(p),
      ) as Equipment[])
    : null;
  if (kit === null) answered = 0;

  const program = options.programs.find((p) => p.id === value.programId);
  if (!program) answered = Math.min(answered, 1);

  const days = Array.isArray(value.days)
    ? value.days.filter(
        (d): d is number => Number.isInteger(d) && d >= 0 && d <= 6,
      )
    : null;
  const lengths = program ? weeksChoice(program) : null;
  const weeksFit =
    value.weeks === null
      ? lengths === null || lengths.noEnd
      : typeof value.weeks === "number" &&
        lengths !== null &&
        value.weeks >= lengths.min &&
        value.weeks <= lengths.max;
  if (days === null || !weeksFit) answered = Math.min(answered, 2);

  const startDate =
    typeof value.startDate === "string" &&
    value.startDate >= options.earliestStartDate &&
    value.startDate <= options.latestStartDate
      ? value.startDate
      : null;
  if (startDate === null) answered = Math.min(answered, 3);

  // Welcome then nothing: a draft with no answer in it is not one worth
  // offering to carry on with.
  if (answered === 0) return null;

  // Every field is filled even where its answer was dropped, so there is one
  // shape to read. The wizard only seeds from the answered ones; the rest
  // are placeholders it never shows.
  const fallback = options.programs[0];
  return {
    answered,
    kit: kit ?? [],
    programId: (program ?? fallback).id,
    days: days ?? [],
    weeks: weeksFit ? (value.weeks as number | null) : null,
    startDate: startDate ?? options.earliestStartDate,
    restEdit: typeof value.restEdit === "string" ? value.restEdit : null,
  };
}

/**
 * "Two answers left", as the athlete is told it.
 *
 * Words rather than a numeral, because it is a headline and there are only
 * ever four.
 */
export function answersLeft(answered: number): string {
  const left = SETUP_QUESTIONS.length - answered;
  if (left === 0) return "Every answer in";
  const words = ["", "One", "Two", "Three", "Four"];
  return `${words[left]} answer${left === 1 ? "" : "s"} left`;
}

/**
 * The kit as one line: "Pull-up bar, Bench and Dumbbell".
 *
 * Shortened past three, because a gym's worth of pieces is a paragraph, and
 * the row only has to remind the athlete what they answered.
 */
export function kitLine(kit: readonly Equipment[]): string {
  if (kit.length === 0) return "Nothing — bodyweight";
  const labels = kit.map(equipmentLabel);
  if (labels.length > 3) {
    return `${labels.slice(0, 2).join(", ")} and ${labels.length - 2} more`;
  }
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
