/**
 * The ownership and liveness half of every `Exercise` and `Wod` read
 * (DN-93, DN-25).
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
 * Archived rows are excluded here for the same reason (DN-25). Every caller
 * is a pool or a picker -- the exercise list, the WOD pool, the checklist
 * content, the rung ladder, the equipment fallback, the swap ladder, the
 * skill-level aggregate -- and not one of them wants to offer a movement the
 * library has retired. Folding it in rather than adding a second helper or an
 * eighth hand-written `archivedAt: null`: two names differing by one clause
 * would be the original problem back again, one call site at a time.
 *
 * What this does *not* hide is the point of a soft delete. A row already
 * named by a `WodMovement` or an `AssignmentSubstitution` still loads, because
 * those come through the relation rather than through here -- so an archived
 * movement keeps its name in the history of the workout it was part of, and
 * only stops being offered for new ones.
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
  archivedAt: null;
} {
  return { OR: [{ ownerId: null }, { ownerId: userId }], archivedAt: null };
}

/**
 * The global tier alone: what an athlete may build on but not edit.
 *
 * Distinct from `libraryVisibleTo` on purpose, twice over. The seed writes
 * global content and resolves names against it, and a name lookup that could
 * land on an athlete's row would let a personal exercise become the target of
 * a global one — the one direction the ownership boundary does not allow,
 * because then one athlete's delete breaks everyone's scheduler.
 *
 * It also carries no `archivedAt` filter, and must not grow one (DN-25).
 * Archiving does not free a name: a seed that skipped archived rows would try
 * to create a name the unique index still holds and fail the deploy. Finding
 * the archived row and writing `archivedAt: null` over it is the correct
 * outcome — re-seeding a retired global movement brings it back.
 */
export const GLOBAL_LIBRARY = { ownerId: null } as const;

/**
 * Who is writing, and therefore which tier the row lands in (DN-25, DN-26).
 *
 * `ownerId: null` is an admin curating global content; a string is an athlete
 * writing their own. It comes from *which controller was called* — the admin
 * routes live behind `@AdminOnly()` — and never from a request body, so there
 * is no path by which a caller names a tier they are not entitled to.
 */
export type LibraryWriter = { ownerId: string | null };

/**
 * What a writer's references may point at.
 *
 * This one function carries three of the rules at once, which is why it is a
 * function and not three checks in a row:
 *
 *   - An admin writing global content sees only global content, so the
 *     one-way reference rule (DN-93) holds by construction rather than by a
 *     comparison someone can forget. A global row pointing at an athlete's
 *     own would let one athlete's delete break everyone's scheduler.
 *   - An athlete sees the global library plus their own, so an id lifted from
 *     another athlete's library is simply not found.
 *   - Neither sees archived rows, so a live row cannot be pointed at content
 *     the pool has stopped offering.
 *
 * Shared rather than per-service: an `Exercise`'s equipment fallback and a
 * `Wod`'s movement list are the same question asked of the same table, and
 * two copies of it would be two chances for one to drift.
 */
export function referenceableBy(writer: LibraryWriter) {
  return writer.ownerId === null
    ? { ownerId: null, archivedAt: null }
    : libraryVisibleTo(writer.ownerId);
}
