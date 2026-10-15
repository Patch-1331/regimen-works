/**
 * Which movement an athlete performs in a group today (DN-139, ADR-0004
 * decisions 7 and 8).
 *
 * One rule where the codebase used to hold two: `prescription.ts` defaulted to
 * rung 0 and `enrollment-summary.logic.ts` defaulted to rung 0 — "the bottom
 * of the ladder", which is not a thing an unordered group has.
 *
 * Two functions rather than one, because callers differ in what they have to
 * fall back *to*. A program slot authors a group and nothing else, so an
 * athlete who has chosen nothing needs the group's declared default. A WOD
 * authors a movement by name, so the same athlete already has one: the one the
 * WOD asked for. Both reach for `usableChoice` first, and only the first kind
 * of caller goes on to the default.
 *
 * Pure, like the rest of this directory: every input is a fact the caller has
 * already fetched.
 */

/** Enough of an exercise to be a group member and to be resolved through. */
export type GroupMember = {
  id: string;
  movementGroup: string | null;
  equipment: string[];
  isGroupDefault: boolean;
};

/**
 * The group's declared default, by group.
 *
 * Built once per request from the same visible-library read the caller already
 * makes. A group with no default member yields nothing and its rows fall
 * through untouched — a library hole, not a reason to hand the athlete a
 * movement nobody chose.
 */
export function defaultsByGroup<E extends GroupMember>(
  library: readonly E[],
): Map<string, E> {
  const defaults = new Map<string, E>();
  for (const e of library) {
    if (e.isGroupDefault && e.movementGroup !== null)
      defaults.set(e.movementGroup, e);
  }
  return defaults;
}

/** Whether the athlete owns everything this movement needs. */
function performable(exercise: GroupMember, owned: ReadonlySet<string>) {
  return exercise.equipment.every((e) => owned.has(e));
}

/**
 * The movement to prescribe in `group`: the athlete's stored choice where they
 * have one they can use, and the group's declared default otherwise.
 *
 * "Otherwise" covers three cases deliberately collapsed into one path, because
 * the athlete experiences them identically — a movement they did not pick:
 *
 *   - **Absent.** They have never chosen in this group. DN-86 stopped
 *     provisioning a row per group, so this is what every group of a new
 *     athlete looks like.
 *   - **Archived.** Their choice was retired out from under them. This used to
 *     make the prescription path drop the row, so a program day quietly lost a
 *     movement; the stored row is deliberately left alone, so un-archiving
 *     restores their preference for free.
 *   - **Unperformable.** They own nothing for it today. The equipment layer
 *     downstream still runs and still drops anything left to its declared
 *     fallback — this only means an athlete who owns no dumbbell gets the
 *     group's default rather than the fallback of a movement they cannot do.
 *
 * Nothing here is written back. A stored default is indistinguishable from a
 * choice the athlete made, and the app would then be claiming they picked
 * something they never saw. Handing someone a starting point is not the same
 * as recording a judgement about them, which is what keeps "no ability
 * assessment" true through this function.
 */
export function resolveGroupChoice<E extends GroupMember>(
  group: string,
  chosen: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, E>,
  defaults: ReadonlyMap<string, E>,
  owned: ReadonlySet<string>,
): E | undefined {
  return usableChoice(group, chosen, byId, owned) ?? defaults.get(group);
}

/**
 * The athlete's stored choice in `group`, where they have one they can be
 * handed today — nothing at all in the three cases above.
 *
 * For the caller that already holds an authored movement: absent, archived and
 * unperformable all mean "leave what the library named", so a curated WOD
 * never loses a movement to a gap in one athlete's stored choices.
 */
export function usableChoice<E extends GroupMember>(
  group: string,
  chosen: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, E>,
  owned: ReadonlySet<string>,
): E | undefined {
  const chosenId = chosen.get(group);
  if (chosenId === undefined) return undefined;
  const choice = byId.get(chosenId);
  // Absent from `byId` means archived or outside this caller's library —
  // `libraryVisibleTo` has already filtered it — and either way it is not a
  // movement this athlete can be handed today.
  if (choice === undefined || !performable(choice, owned)) return undefined;
  return choice;
}
