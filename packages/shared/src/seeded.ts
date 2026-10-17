/**
 * Where seeded library content is changed (DN-151, ADR 0010).
 *
 * A global exercise or WOD that carries a `key` came from a committed file,
 * and every deploy writes it from there. The admin routes refuse to change
 * one, and the library pages show it read-only; both point at the same file,
 * so the two can never send an admin to different places.
 */
export const SEEDED_SOURCE = {
  exercise: "apps/api/prisma/library/curation.ts",
  wod: "apps/api/prisma/wod-seed.ts",
} as const;

export type SeededKind = keyof typeof SEEDED_SOURCE;

/** The 409 an admin route answers for a seeded row. */
export function seededRefusal(kind: SeededKind, name: string): string {
  const what = kind === "exercise" ? "movement" : "workout";
  return (
    `"${name}" is a seeded ${what}: every deploy writes it from ` +
    `${SEEDED_SOURCE[kind]}, so a change made here would not last. ` +
    "Change it in that file, or remove it there to retire it."
  );
}
