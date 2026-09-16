import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { assertSubstitutesReachable } from "../src/seed/substitute-guard";

// Prisma 7 requires a driver adapter — a bare `new PrismaClient()` throws at
// construction. Run directly by ts-node rather than through the Prisma CLI,
// so .env is loaded here too instead of being inherited from it.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

type ExerciseSeed = {
  name: string;
  // Null only for general warm-up/cool-down filler not tied to a pattern
  // (e.g. light jogging, deep breathing).
  pattern: string | null;
  // What the movement needs beyond the athlete's own body (DN-31), from the
  // shared catalog: bar | jump_rope | box | dumbbell | kettlebell. Omitted
  // for the bodyweight baseline, which is most of the pool -- an exercise
  // needing nothing carries no tags rather than a "bodyweight" one.
  equipment?: string[];
  scalable?: boolean;
  alt?: string; // name of the no-equipment substitute
  // Progression tracking (Feature #2) — line groups exercises into an
  // ordered chain; rung is this exercise's 0-indexed position in it. See
  // the "Scaling the Ladder" design doc for why these 8 lines exist instead
  // of tracking progress per `pattern`.
  line?: string;
  rung?: number;
  // Defaults to "reps" — set to "seconds" for timed holds (plank family).
  unit?: "reps" | "seconds";
  // Warm-up/cool-down tagging (Feature #63). Null/omitted for regular pool
  // exercises — only checklist content gets a phase.
  phase?: "warmup" | "cooldown";
  // How the movement is performed, in prose: setup, what one rep is, and the
  // cue or two that decide whether it's the movement at all. Required rather
  // than optional so a movement can't join the library with no way for the
  // athlete to find out what it is — the ladders promote people onto moves
  // they've never done, so the copy has to exist before the move does.
  // Not the place for counts (WodMovement.reps) or for the easier variant
  // (`alt`), both of which the app already shows next to it.
  instructions: string;
};

const exercises: ExerciseSeed[] = [
  // Push · Horizontal
  {
    name: "Knee push-up",
    pattern: "push",
    line: "push_horizontal",
    rung: 0,
    instructions:
      "Hands under the shoulders, knees on the floor, body straight from knees to head. Lower until the chest is a fist from the floor, then press back up. Keep the hips from sagging — the knees only shorten the lever, they don't change the plank.",
  },
  {
    name: "Push-up",
    pattern: "push",
    alt: "Knee push-up",
    line: "push_horizontal",
    rung: 1,
    instructions:
      "Full plank, hands under the shoulders, elbows tracking back at roughly 45° rather than flaring wide. Lower until the chest is a fist from the floor and press back up as one rigid piece — hips and shoulders arrive together.",
  },
  {
    name: "Diamond push-up",
    pattern: "push",
    line: "push_horizontal",
    rung: 2,
    instructions:
      "A push-up with the hands together under the sternum, index fingers and thumbs touching. Elbows stay close to the ribs on the way down. The narrow base shifts the work to the triceps, so expect fewer reps than a standard push-up.",
  },
  {
    name: "Archer push-up",
    pattern: "push",
    line: "push_horizontal",
    rung: 3,
    instructions:
      "Hands wider than a push-up. Lower toward one hand while the other arm straightens out along the floor, then press up and alternate sides. The working arm does the pressing; the straight arm is a kickstand, not a second presser.",
  },

  // Push · Vertical
  {
    name: "Incline pike push-up",
    pattern: "push",
    line: "push_vertical",
    rung: 0,
    instructions:
      "Hands on the floor, feet up on a chair or step, hips high so the body makes an upside-down V. Bend the elbows to lower the crown of the head toward the floor, then press back up. The higher the feet, the harder it gets.",
  },
  {
    name: "Pike push-up",
    pattern: "push",
    scalable: true,
    alt: "Incline pike push-up",
    line: "push_vertical",
    rung: 1,
    instructions:
      "Feet on the floor, hips pushed high into an upside-down V, hands shoulder-width. Lower the crown of the head toward the floor between the hands, then press back up. Keep the hips stacked over the shoulders — dropping them turns it into a push-up.",
  },
  {
    name: "Handstand push-up",
    pattern: "push",
    scalable: true,
    alt: "Pike push-up",
    line: "push_vertical",
    rung: 2,
    instructions:
      "Kick up to a handstand with the heels resting on a wall, hands slightly wider than the shoulders. Lower under control until the head touches the floor, then press back to locked arms. Only attempt it once a wall handstand hold is comfortable.",
  },

  // Pull
  {
    name: "Supermans + reverse snow angels",
    pattern: "pull",
    line: "pull",
    rung: 0,
    instructions:
      "Face down, arms overhead. Lift the chest, arms and legs off the floor, then sweep the arms out and down to the hips and back overhead, keeping them off the floor throughout. The floor-based stand-in for pulling when no bar is available.",
  },
  {
    name: "Negative pull-up",
    pattern: "pull",
    equipment: ["bar"],
    alt: "Supermans + reverse snow angels",
    line: "pull",
    rung: 1,
    instructions:
      "Jump or step up so the chin starts above the bar, then lower yourself as slowly as you can — aim for three to five seconds to full hang. Only the lowering half counts as the rep; step back up for the next one.",
  },
  {
    name: "Chin-up",
    pattern: "pull",
    equipment: ["bar"],
    alt: "Supermans + reverse snow angels",
    line: "pull",
    rung: 2,
    instructions:
      "Hang from the bar with palms facing you, hands shoulder-width. Pull until the chin clears the bar, then lower to straight arms. The underhand grip brings the biceps in, which is why it comes before the pull-up on the ladder.",
  },
  {
    name: "Pull-up",
    pattern: "pull",
    equipment: ["bar"],
    alt: "Supermans + reverse snow angels",
    line: "pull",
    rung: 3,
    instructions:
      "Hang from the bar with palms facing away, hands just outside the shoulders. Pull the chest toward the bar until the chin clears it, then lower all the way to straight arms. Start each rep from a dead hang rather than bouncing out of the bottom.",
  },

  // Squat
  {
    name: "Air squat",
    pattern: "squat",
    line: "squat",
    rung: 0,
    instructions:
      "Feet shoulder-width, toes turned out slightly. Push the hips back and down until the hip crease drops below the top of the knee, then stand all the way up. Heels stay down and the knees track over the toes.",
  },
  {
    name: "Reverse lunge",
    pattern: "squat",
    line: "squat",
    rung: 1,
    instructions:
      "From standing, step one foot back and lower until both knees are bent near 90° and the back knee grazes the floor. Drive through the front heel to stand, then alternate legs. Stepping back rather than forward keeps the front knee quieter.",
  },
  {
    name: "Assisted pistol",
    pattern: "squat",
    line: "squat",
    rung: 2,
    instructions:
      "Stand on one leg with the other extended in front, holding a doorframe or strap for balance. Sit down as far as control allows and pull lightly on the support to help you back up — use only as much hand assistance as the rep actually needs.",
  },
  {
    name: "Pistol squat",
    pattern: "squat",
    scalable: true,
    alt: "Assisted pistol",
    line: "squat",
    rung: 3,
    instructions:
      "A full one-legged squat: stand on one leg, extend the other in front, and lower under control until the hamstring meets the calf, then stand back up without touching down. Arms out in front for a counterweight; the heel of the standing foot stays flat.",
  },
  // Siblings kept in the pool but not on the main squat line
  {
    name: "Jump squat",
    pattern: "squat",
    alt: "Air squat",
    instructions:
      "Squat to about parallel, then drive up hard and leave the floor. Land on the whole foot with soft knees and flow straight into the next rep. Absorb the landing rather than stiff-legging it.",
  },
  {
    name: "Walking lunge",
    pattern: "squat",
    instructions:
      "Step forward and lower until the back knee grazes the floor, then drive through the front heel and step the back foot straight through into the next lunge. Torso stays upright; each step is a rep.",
  },

  // Hinge
  {
    name: "Glute bridge",
    pattern: "hinge",
    line: "hinge",
    rung: 0,
    instructions:
      "Lie on your back, knees bent, feet flat and close to the hips. Squeeze the glutes to drive the hips up until knees, hips and shoulders form a straight line, pause, then lower. Push with the glutes, not by arching the lower back.",
  },
  {
    name: "Single-leg glute bridge",
    pattern: "hinge",
    alt: "Glute bridge",
    line: "hinge",
    rung: 1,
    instructions:
      "A glute bridge with one foot planted and the other leg held straight out or knee hugged to the chest. Drive the hips up with the planted leg, keeping the hips level rather than letting the free side drop. Do all reps on one side, then switch.",
  },
  {
    name: "Superman",
    pattern: "hinge",
    line: "hinge",
    rung: 2,
    instructions:
      "Face down, arms stretched overhead. Lift the chest, arms and legs off the floor at the same time, hold for a beat, then lower under control. Look at the floor rather than forward so the neck stays in line with the spine.",
  },
  {
    name: "Single-leg superman",
    pattern: "hinge",
    line: "hinge",
    rung: 3,
    instructions:
      "A superman lifting one arm and the opposite leg, holding briefly before switching. Working diagonally makes the back and glutes resist rotation as well as extend, which is what puts it above the two-sided version.",
  },
  {
    name: "Broad jump",
    pattern: "hinge",
    instructions:
      "From a quarter squat, swing the arms and jump forward as far as you can, landing on both feet with hips back and knees soft. Reset and turn around when you run out of room. Stick the landing before starting the next rep.",
  },

  // Core · Dynamic — Hanging knee raise / Toes-to-bar were previously tagged
  // `pattern: pull` since they use the bar; they're leg-raise work, not
  // pulling, so they move to `core` here.
  //
  // Sit-up sits at the bottom (DN-61). The line was built as a leg-raise
  // progression and left the one dynamic core movement the library actually
  // prescribes off it entirely, so on Angie's plate it was the single row with
  // no swap control — the athlete's one movement they were stuck with. It is
  // the most accessible of the six: the feet stay down and only the torso
  // moves, where a tuck-up lifts both halves off the floor at once.
  {
    name: "Sit-up",
    pattern: "core",
    line: "core_dynamic",
    rung: 0,
    instructions:
      "On your back, knees bent, feet flat. Curl up until the torso is upright and reaches past the knees, then lower back down. Come up one vertebra at a time rather than yanking with the neck or throwing the arms.",
  },
  {
    name: "Tuck-up",
    pattern: "core",
    line: "core_dynamic",
    rung: 1,
    instructions:
      "Lie on your back, arms overhead, legs straight. Crunch up and tuck the knees to the chest at the same time so hands and shins meet over the middle, then extend back out without letting the feet and hands rest on the floor.",
  },
  {
    name: "V-up",
    pattern: "core",
    alt: "Tuck-up",
    line: "core_dynamic",
    rung: 2,
    instructions:
      "The straight-legged tuck-up: from flat on your back with arms overhead, lift the legs and torso together into a V and reach for the toes, then lower under control. Keep the legs straight — bending them turns it back into a tuck-up.",
  },
  {
    name: "Lying leg raise",
    pattern: "core",
    line: "core_dynamic",
    rung: 3,
    instructions:
      "On your back, hands under the hips or by your sides, legs straight. Raise the legs to vertical, then lower to just above the floor without touching down. Press the lower back into the floor the whole way — if it lifts, shorten the range.",
  },
  {
    name: "Hanging knee raise",
    pattern: "core",
    equipment: ["bar"],
    alt: "Lying leg raise",
    line: "core_dynamic",
    rung: 4,
    instructions:
      "Hang from the bar with straight arms and shoulders pulled down away from the ears. Raise the knees to at least hip height, then lower under control without swinging. Stop the swing between reps rather than using it.",
  },
  {
    name: "Toes-to-bar",
    pattern: "core",
    equipment: ["bar"],
    alt: "V-up",
    line: "core_dynamic",
    rung: 5,
    instructions:
      "From a hang, raise straight legs until both feet touch the bar between the hands, then lower with control. The rep counts on contact with the bar; half-height raises are hanging knee raises, not this.",
  },
  // Core · Anti-extension — timed holds, not rep-counted.
  {
    name: "Knee plank",
    pattern: "core",
    line: "core_hold",
    rung: 0,
    unit: "seconds",
    instructions:
      "Forearms on the floor, elbows under the shoulders, knees down, body straight from knees to head. Squeeze the glutes and brace the stomach for the whole hold. Counted in seconds, not reps.",
  },
  {
    name: "Tucked hollow hold",
    pattern: "core",
    line: "core_hold",
    rung: 1,
    unit: "seconds",
    instructions:
      "The hollow hold with the knees tucked toward the chest and the arms alongside them. The shorter shape makes it far easier to keep the lower back pressed into the floor, which is the point of the position.",
  },
  {
    name: "Plank hold",
    pattern: "core",
    alt: "Knee plank",
    line: "core_hold",
    rung: 2,
    unit: "seconds",
    instructions:
      "Forearms on the floor, elbows under the shoulders, legs straight, body in one line from heels to head. Brace the stomach and squeeze the glutes so the hips neither sag nor pike up. Counted in seconds, not reps.",
  },
  {
    name: "Hollow hold",
    pattern: "core",
    alt: "Tucked hollow hold",
    line: "core_hold",
    rung: 3,
    unit: "seconds",
    instructions:
      "On your back, arms overhead, legs straight. Press the lower back flat into the floor and lift the shoulders and heels a few inches, holding that dish shape. If the back lifts off the floor, tuck the knees in until it doesn't.",
  },
  {
    name: "Long-lever plank",
    pattern: "core",
    line: "core_hold",
    rung: 4,
    unit: "seconds",
    instructions:
      "A plank with the elbows placed further forward, ahead of the shoulders. The longer lever multiplies the load on the stomach, so expect a much shorter hold. Stop the moment the lower back starts to sag.",
  },

  // Core · Anti-rotation
  {
    name: "Knee side plank",
    pattern: "core",
    line: "core_side",
    rung: 0,
    instructions:
      "On your side, elbow under the shoulder, knees bent and stacked. Lift the hips so the body is straight from knees to head, hold, then lower. Split the prescribed reps evenly between the two sides.",
  },
  {
    name: "Side plank",
    pattern: "core",
    alt: "Knee side plank",
    line: "core_side",
    rung: 1,
    instructions:
      "On your side, elbow under the shoulder, legs straight and feet stacked. Lift the hips into one line from heels to head and keep the top hip from rolling backwards. Split the prescribed reps evenly between the two sides.",
  },

  // Cardio — not part of a progression line
  {
    name: "Burpee",
    pattern: "cardio",
    alt: "Squat thrust",
    instructions:
      "From standing, drop to a plank and let the chest touch the floor, jump the feet back under you, then stand and jump with the hands overhead. Chest to the floor at the bottom and feet off the floor at the top make it a full rep.",
  },
  {
    name: "Squat thrust",
    pattern: "cardio",
    instructions:
      "A burpee without the floor contact or the jump: squat down, hands to the floor, jump the feet back to a plank, jump them back in, and stand. Easier on the shoulders and the lungs, and the substitute when burpees are too much.",
  },
  {
    name: "Mountain climber",
    pattern: "cardio",
    instructions:
      "From a plank with the hands under the shoulders, drive one knee toward the chest and switch feet quickly. Keep the hips low and level rather than bouncing them up — each knee drive is a rep.",
  },
  {
    name: "High knees",
    pattern: "cardio",
    instructions:
      "Run on the spot lifting each knee to at least hip height, landing on the balls of the feet with a tall torso. Each knee lift is a rep. Pump the arms in time with the legs.",
  },

  // Warm-up (Feature #63) — tagged with the pattern they best prep, so a
  // WOD's dominantPattern can pull in relevant moves.
  {
    name: "Arm circles",
    pattern: "push",
    phase: "warmup",
    instructions:
      "Arms straight out at shoulder height. Draw small circles forward, growing them gradually, then reverse. About twenty seconds each direction is enough to warm the shoulders.",
  },
  {
    name: "Leg swings",
    pattern: "hinge",
    phase: "warmup",
    instructions:
      "Hold a wall for balance and swing one leg forward and back, then side to side across the body, ten or so each way before switching legs. Swing to the edge of a comfortable range, not into a stretch.",
  },
  {
    name: "Bodyweight squats",
    pattern: "squat",
    phase: "warmup",
    instructions:
      "Easy, unloaded air squats at a steady pace, sinking a little deeper each rep. This is a rehearsal to get the hips and knees moving, not a set to work at.",
  },
  {
    name: "Inchworms",
    pattern: "core",
    phase: "warmup",
    instructions:
      "From standing, fold forward, walk the hands out to a plank, hold a beat, then walk the feet up to the hands and stand. Keeps the hamstrings, shoulders and stomach all in the warm-up at once.",
  },
  {
    name: "Scapular pull-ups",
    pattern: "pull",
    phase: "warmup",
    instructions:
      "Hang from the bar with straight arms and pull the shoulder blades down and together to lift yourself an inch or two, then relax back into the hang. The elbows stay straight throughout — it is a very short range on purpose.",
  },
  {
    name: "Light jogging in place",
    pattern: null,
    phase: "warmup",
    instructions:
      "An easy jog on the spot, feet barely leaving the floor, for a minute or so. Aim for warm and slightly out of breath, nothing more.",
  },

  // Cool-down (Feature #63)
  {
    name: "Static quad stretch",
    pattern: "squat",
    phase: "cooldown",
    instructions:
      "Standing, pull one heel toward the glute with knees together and hips pushed slightly forward. Hold for twenty to thirty seconds, then switch legs. Hold a wall if balance is a problem.",
  },
  {
    name: "Child's pose",
    pattern: "hinge",
    phase: "cooldown",
    instructions:
      "Kneel, sit the hips back onto the heels and reach the arms forward on the floor, forehead down. Breathe slowly and let the lower back and shoulders settle for thirty seconds or more.",
  },
  {
    name: "Cat-cow",
    pattern: "core",
    phase: "cooldown",
    instructions:
      "On hands and knees, alternate between arching the back and rounding it, moving with the breath. Slow and easy — this is about moving the spine through its range, not stretching hard.",
  },
  {
    name: "Doorway chest stretch",
    pattern: "push",
    phase: "cooldown",
    instructions:
      "Put a forearm on a doorframe with the elbow at shoulder height and step gently through until you feel the chest open. Hold twenty to thirty seconds a side; ease off if it pinches at the front of the shoulder.",
  },
  {
    name: "Cross-body shoulder stretch",
    pattern: "pull",
    phase: "cooldown",
    instructions:
      "Bring one arm straight across the chest and use the other forearm to draw it closer. Hold twenty to thirty seconds, then switch. Keep the shoulder down rather than shrugged toward the ear.",
  },
  {
    name: "Deep breathing",
    pattern: null,
    phase: "cooldown",
    instructions:
      "Lie or sit comfortably and breathe in through the nose for four counts, out through the mouth for six, for around a minute. The long exhale is what brings the heart rate down.",
  },
];

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
