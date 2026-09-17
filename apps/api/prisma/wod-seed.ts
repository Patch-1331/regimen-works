/**
 * The WOD library, as data.
 *
 * Extracted from `seed.ts` for the reason the exercises were (DN-112): the
 * seed runs `main()` at module scope, so nothing could read this array
 * without running the seed, and nothing checked it until a deploy did.
 *
 * DN-112 deliberately left it behind — "worth doing when something wants to
 * read the WOD library, not before". DN-34 is that something: the batch it
 * adds has to grow what a bodyweight-and-bar athlete is offered rather than
 * only what an equipped one is, and that is a property of this array that a
 * spec can hold to.
 *
 * Data only: no client, no writes, nothing that happens on import.
 */

export type WodMovementSeed = {
  exercise: string;
  // Flat count, performed every round. Omitted when repScheme carries the
  // counts instead — exactly one of the two is given.
  reps?: number;
  // A ladder's per-round counts, e.g. [21, 15, 9] for a 21-15-9. The stored
  // `reps` is derived as the sum rather than written out again, so the seed
  // has no way to state a total that disagrees with the scheme.
  repScheme?: number[];
};

export type WodSeed = {
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

export const wods: WodSeed[] = [
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
  // ---------------------------------------------------------------------
  // Bodyweight, and squat/hinge dominant (DN-34)
  //
  // These three come first because of what the equipment WODs below do to
  // the pool. `pickWod` will drop a WOD whose dominant-pattern movement the
  // athlete cannot perform (DN-82), so a batch of nothing but equipment WODs
  // would re-cut the library rather than grow it: everyone else would still
  // be choosing from the same eleven. These need nothing, so every athlete
  // gets them.
  //
  // They also fill a hole that predates equipment entirely — the library had
  // no squat-dominant and no hinge-dominant WOD at all, so two of the eight
  // movement patterns never led a workout.
  {
    name: "Squat Sixty",
    type: "for_time",
    timeCapMinutes: 15,
    rounds: 3,
    isNamed: false,
    dominantPattern: "squat",
    description:
      "Three rounds: 20 air squats, 20 walking lunge steps, 20 mountain climbers. Legs the whole way through — pace the first round or the third one will pace you.",
    movements: [
      { exercise: "Air squat", reps: 20 },
      { exercise: "Walking lunge", reps: 20 },
      { exercise: "Mountain climber", reps: 20 },
    ],
  },
  {
    name: "Ladder Legs",
    type: "for_time",
    timeCapMinutes: 12,
    rounds: null,
    isNamed: false,
    dominantPattern: "squat",
    description:
      "15-12-9: jump squats and push-ups, descending. One pass through the ladder, for time.",
    movements: [
      { exercise: "Jump squat", repScheme: [15, 12, 9] },
      { exercise: "Push-up", repScheme: [15, 12, 9] },
    ],
  },
  {
    name: "Hinge Line",
    type: "amrap",
    timeCapMinutes: 12,
    rounds: null,
    isNamed: false,
    dominantPattern: "hinge",
    description:
      "As many rounds as possible in 12 minutes: 15 glute bridges, 10 supermans, 15 sit-ups. The posterior chain workout the library never had.",
    movements: [
      { exercise: "Glute bridge", reps: 15 },
      { exercise: "Superman", reps: 10 },
      { exercise: "Sit-up", reps: 15 },
    ],
  },

  // ---------------------------------------------------------------------
  // Equipment (DN-34) — each led by the piece it needs
  //
  // The dominant pattern of each of these is carried by its equipment
  // movement, deliberately. That is the hook DN-82 will drop them on: a rope
  // workout handed to someone with no rope becomes entirely high knees,
  // which is a workout but no longer this one. Substitution still covers the
  // non-dominant rows, so an athlete missing a box still gets the push-ups.
  {
    name: "Rope Trick",
    type: "emom",
    timeCapMinutes: 10,
    rounds: 10,
    workSeconds: 60,
    restSeconds: 0,
    intervalCount: 10,
    isNamed: false,
    dominantPattern: "cardio",
    description:
      "Every minute on the minute for ten: 30 double-unders, then 5 burpees with whatever is left of the minute. Rest is whatever you earn.",
    movements: [
      { exercise: "Double-unders", reps: 30 },
      { exercise: "Burpee", reps: 5 },
    ],
  },
  {
    name: "Step Change",
    type: "amrap",
    timeCapMinutes: 15,
    rounds: null,
    isNamed: false,
    dominantPattern: "squat",
    description:
      "As many rounds as possible in 15 minutes: 20 box step-ups, 10 push-ups, 15 sit-ups. Step-ups alternate legs, so 20 is ten a side.",
    movements: [
      { exercise: "Box step-up", reps: 20 },
      { exercise: "Push-up", reps: 10 },
      { exercise: "Sit-up", reps: 15 },
    ],
  },
  {
    name: "Goblet Ladder",
    type: "for_time",
    timeCapMinutes: 14,
    rounds: null,
    isNamed: false,
    dominantPattern: "squat",
    description:
      "21-15-9: goblet squats and burpees, descending. One pass, for time. Pick a weight you could do all 21 of unbroken on a good day.",
    movements: [
      { exercise: "Goblet squat", repScheme: [21, 15, 9] },
      { exercise: "Burpee", repScheme: [21, 15, 9] },
    ],
  },
  {
    name: "Swing Shift",
    type: "for_time",
    timeCapMinutes: 20,
    rounds: 5,
    isNamed: false,
    dominantPattern: "hinge",
    description:
      "Five rounds: 15 kettlebell swings, 10 push-ups, 15 air squats. The swings are the workout; the rest is what you do while the hips recover.",
    movements: [
      { exercise: "Kettlebell swing", reps: 15 },
      { exercise: "Push-up", reps: 10 },
      { exercise: "Air squat", reps: 15 },
    ],
  },
];
