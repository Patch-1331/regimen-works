import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { assertSubstitutesReachable } from "../src/seed/substitute-guard";
import { exercises } from "./exercise-seed";

// Prisma 7 requires a driver adapter — a bare `new PrismaClient()` throws at
// construction. Run directly by ts-node rather than through the Prisma CLI,
// so .env is loaded here too instead of being inherited from it.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

type WodMovementSeed = {
  exercise: string;
  // Flat count, performed every round. Omitted when repScheme carries the
  // counts instead — exactly one of the two is given.
  reps?: number;
  // A ladder's per-round counts, e.g. [21, 15, 9] for a 21-15-9. The stored
  // `reps` is derived as the sum rather than written out again, so the seed
  // has no way to state a total that disagrees with the scheme.
  repScheme?: number[];
};

type WodSeed = {
  name: string;
  type: "amrap" | "for_time" | "emom" | "tabata";
  timeCapMinutes: number;
  rounds: number | null;
  // Interval structure for the emom/tabata timer (Feature #30) — omitted on
  // AMRAP/For Time, which are round-tapped rather than auto-advanced.
  workSeconds?: number;
  restSeconds?: number;
  intervalCount?: number;
  isNamed: boolean;
  dominantPattern: string;
  // How the workout is meant to be performed, where the movement list alone
  // leaves it ambiguous — "one pass" vs. "as many rounds as possible".
  description?: string;
  movements: WodMovementSeed[];
};

/**
 * Resolves a seeded movement to the pair actually stored, and refuses
 * anything self-contradictory. The DB has a CHECK constraint saying the same
 * thing; this just fails at the line of seed data that's wrong rather than at
 * the insert.
 */
function movementCounts(
  m: WodMovementSeed,
  wodName: string,
): { reps: number; repScheme: number[] } {
  const repScheme = m.repScheme ?? [];
  if (repScheme.length > 0) {
    const total = repScheme.reduce((sum, r) => sum + r, 0);
    if (m.reps !== undefined && m.reps !== total) {
      throw new Error(
        `"${wodName}" / ${m.exercise}: reps ${m.reps} doesn't match repScheme total ${total}`,
      );
    }
    return { reps: total, repScheme };
  }
  if (m.reps === undefined) {
    throw new Error(`"${wodName}" / ${m.exercise}: needs reps or repScheme`);
  }
  return { reps: m.reps, repScheme: [] };
}

/** A ladder is one shape for the whole WOD, so every scheme in it is the same length. */
function assertUniformSchemes(w: WodSeed): void {
  const lengths = w.movements
    .map((m) => m.repScheme?.length ?? 0)
    .filter((n) => n > 0);
  if (new Set(lengths).size > 1) {
    throw new Error(`"${w.name}": repSchemes of differing lengths`);
  }
}

const wods: WodSeed[] = [
  {
    name: "Cindy",
    type: "amrap",
    timeCapMinutes: 20,
    rounds: null,
    isNamed: true,
    dominantPattern: "pull",
    movements: [
      { exercise: "Pull-up", reps: 5 },
      { exercise: "Push-up", reps: 10 },
      { exercise: "Air squat", reps: 15 },
    ],
  },
  {
    name: "Angie",
    type: "for_time",
    timeCapMinutes: 30,
    rounds: 1,
    isNamed: true,
    dominantPattern: "pull",
    description:
      "All 75 reps of one movement before starting the next, in the order listed. One pass, for time.",
    movements: [
      { exercise: "Pull-up", reps: 75 },
      { exercise: "Push-up", reps: 75 },
      { exercise: "Sit-up", reps: 75 },
      { exercise: "Air squat", reps: 75 },
    ],
  },
  {
    name: "Murph, Home Cap",
    type: "for_time",
    timeCapMinutes: 30,
    rounds: 1,
    isNamed: true,
    dominantPattern: "pull",
    description:
      "Half a Murph, no vest, no run. All 50 pull-ups, then all 100 push-ups, then all 150 air squats. Partition them however you like inside the cap.",
    movements: [
      { exercise: "Pull-up", reps: 50 },
      { exercise: "Push-up", reps: 100 },
      { exercise: "Air squat", reps: 150 },
    ],
  },
  {
    name: "Ten to One",
    type: "for_time",
    timeCapMinutes: 20,
    rounds: null,
    isNamed: false,
    dominantPattern: "pull",
    description:
      "A descending ladder: 10 pull-ups and 10 burpees, then 9 and 9, all the way down to 1 and 1. One pass, for time.",
    movements: [
      { exercise: "Pull-up", repScheme: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] },
      { exercise: "Burpee", repScheme: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] },
    ],
  },
  {
    name: "Fran's Cousin",
    type: "for_time",
    timeCapMinutes: 10,
    rounds: null,
    isNamed: false,
    dominantPattern: "push",
    description:
      "21-15-9: 21 push-ups and 21 jump squats, then 15 and 15, then 9 and 9. One pass through the ladder, for time — not as many rounds as possible.",
    movements: [
      { exercise: "Push-up", repScheme: [21, 15, 9] },
      { exercise: "Jump squat", repScheme: [21, 15, 9] },
    ],
  },
  {
    name: "Rung by Rung",
    type: "amrap",
    timeCapMinutes: 15,
    rounds: null,
    isNamed: false,
    dominantPattern: "pull",
    movements: [
      { exercise: "Pull-up", reps: 3 },
      { exercise: "Hanging knee raise", reps: 6 },
      { exercise: "Air squat", reps: 9 },
    ],
  },
  {
    name: "Core Cindy",
    type: "amrap",
    timeCapMinutes: 12,
    rounds: null,
    isNamed: false,
    dominantPattern: "core",
    movements: [
      { exercise: "Sit-up", reps: 10 },
      { exercise: "Mountain climber", reps: 20 },
      { exercise: "Plank hold", reps: 30 },
    ],
  },
  {
    name: "Chalk Line",
    type: "for_time",
    timeCapMinutes: 15,
    rounds: 5,
    isNamed: false,
    dominantPattern: "cardio",
    movements: [
      { exercise: "Burpee", reps: 10 },
      { exercise: "Walking lunge", reps: 15 },
      { exercise: "Mountain climber", reps: 20 },
    ],
  },
  {
    name: "Bar Ladder",
    type: "emom",
    timeCapMinutes: 12,
    rounds: 12,
    workSeconds: 60,
    restSeconds: 0,
    intervalCount: 12,
    isNamed: false,
    dominantPattern: "pull",
    movements: [
      { exercise: "Burpee", reps: 8 },
      { exercise: "Pull-up", reps: 1 }, // max effort per interval
    ],
  },
  {
    name: "Even Odd",
    type: "emom",
    timeCapMinutes: 16,
    rounds: 16,
    workSeconds: 60,
    restSeconds: 0,
    intervalCount: 16,
    isNamed: false,
    dominantPattern: "push",
    // True to the name: even minutes push, odd minutes pull — exactly two
    // movements alternating, not a three-way rotation.
    movements: [
      { exercise: "Push-up", reps: 12 },
      { exercise: "Pull-up", reps: 8 },
    ],
  },
  {
    name: "Tabata Trio",
    type: "tabata",
    timeCapMinutes: 14,
    rounds: 24, // 8 rounds x 3 movements
    // Classic 20/10, three movements deep: 24 x 30s = 12 minutes of work,
    // inside the 14-minute cap.
    workSeconds: 20,
    restSeconds: 10,
    intervalCount: 24,
    isNamed: false,
    dominantPattern: "cardio",
    movements: [
      { exercise: "Burpee", reps: 1 },
      { exercise: "Push-up", reps: 1 },
      { exercise: "Air squat", reps: 1 },
    ],
  },
];

async function main() {
  // Before anything is written: every movement needing equipment must have a
  // one-step fall to a movement needing none (DN-83). Nothing at runtime can
  // report this -- the resolver passes a gap through rather than throwing, so
  // the athlete just gets a movement they cannot do -- and a half-written
  // seed is worse than a refused one.
  assertSubstitutesReachable(exercises);

  console.log("Seeding exercises...");
  const idByName = new Map<string, string>();

  for (const e of exercises) {
    const row = await prisma.exercise.upsert({
      where: { name: e.name },
      update: {
        pattern: e.pattern,
        equipment: e.equipment ?? [],
        scalable: e.scalable ?? false,
        unit: e.unit ?? "reps",
        line: e.line ?? null,
        rung: e.rung ?? null,
        phase: e.phase ?? null,
        instructions: e.instructions,
      },
      create: {
        name: e.name,
        pattern: e.pattern,
        equipment: e.equipment ?? [],
        scalable: e.scalable ?? false,
        unit: e.unit ?? "reps",
        line: e.line ?? null,
        rung: e.rung ?? null,
        phase: e.phase ?? null,
        instructions: e.instructions,
      },
    });
    idByName.set(e.name, row.id);
  }

  for (const e of exercises) {
    if (!e.alt) continue;
    const altId = idByName.get(e.alt);
    if (!altId) throw new Error(`Unknown alt exercise "${e.alt}" for "${e.name}"`);
    await prisma.exercise.update({
      where: { id: idByName.get(e.name)! },
      data: { altExerciseId: altId },
    });
  }

  console.log("Seeding WOD library...");
  for (const w of wods) {
    assertUniformSchemes(w);
    const movements = w.movements.map((m, i) => ({
      ...movementCounts(m, w.name),
      order: i,
      exercise: { connect: { id: idByName.get(m.exercise)! } },
    }));

    const existing = await prisma.wod.findUnique({ where: { name: w.name } });
    if (existing) {
      await prisma.wodMovement.deleteMany({ where: { wodId: existing.id } });
    }

    await prisma.wod.upsert({
      where: { name: w.name },
      update: {
        type: w.type,
        timeCapMinutes: w.timeCapMinutes,
        rounds: w.rounds,
        workSeconds: w.workSeconds ?? null,
        restSeconds: w.restSeconds ?? null,
        intervalCount: w.intervalCount ?? null,
        isNamed: w.isNamed,
        dominantPattern: w.dominantPattern,
        description: w.description ?? null,
        movements: { create: movements },
      },
      create: {
        name: w.name,
        type: w.type,
        timeCapMinutes: w.timeCapMinutes,
        rounds: w.rounds,
        workSeconds: w.workSeconds ?? null,
        restSeconds: w.restSeconds ?? null,
        intervalCount: w.intervalCount ?? null,
        isNamed: w.isNamed,
        dominantPattern: w.dominantPattern,
        description: w.description ?? null,
        movements: { create: movements },
      },
    });
  }

  // ScheduleRule and SkillLevel rows used to be seeded here, when they were
  // global singletons. They are per-user now, so UserProvisioningService
  // creates them on a user's first authenticated request instead — this seed
  // runs at deploy time, when no user exists yet. Only the shared catalogue
  // (exercises and WODs) belongs here.
  console.log(`Done: ${exercises.length} exercises, ${wods.length} WODs.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
