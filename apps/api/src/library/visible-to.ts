/**
 * The ownership half of every `Exercise` and `Wod` read (DN-93).
 *
 * The library has two tiers: rows with no owner are global content, seeded
 * and admin-curated, and every athlete reads them; rows with an owner belong
 * to that athlete alone. A read that wants "the library" means the union, and
 * it means that in nine places across six services.
 *
 * One helper rather than nine hand-written clauses, for the same reason every
 * other model is scoped by a `userId` in its `where`: an unscoped read still
 * compiles. Written out nine times, the clause has nine chances to come out
 * as `{ ownerId: userId }` — which type-checks, passes a test written against
 * an athlete's own rows, and quietly costs that athlete the entire shared
 * library.
 *
 * Spread into a `where` alongside the read's own filters:
 *
 *     where: { ...libraryVisibleTo(userId), line: { not: null } }
 *
 * It occupies the `OR` key, so a read that needs an `OR` of its own must nest
 * both under `AND` rather than spreading this over the top of it.
 */
export function libraryVisibleTo(userId: string): {
  OR: [{ ownerId: null }, { ownerId: string }];
} {
  return { OR: [{ ownerId: null }, { ownerId: userId }] };
}

/**
 * The global tier alone: what an athlete may build on but not edit.
 *
 * Distinct from `libraryVisibleTo` on purpose. The seed writes global content
 * and resolves names against it, and a name lookup that could land on an
 * athlete's row would let a personal exercise become the target of a global
 * one — the one direction the ownership boundary does not allow, because then
 * one athlete's delete breaks everyone's scheduler.
 */
export const GLOBAL_LIBRARY = { ownerId: null } as const;
