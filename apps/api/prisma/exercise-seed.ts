/**
 * The exercise library, as data.
 *
 * Extracted from `seed.ts` so it can be read without being run (DN-112).
 * `seed.ts` calls `main()` at module scope and throws on a missing
 * `DATABASE_URL`, so while this array lived inside it nothing could check it
 * but a deploy — and the guard written for exactly that
 * (`assertSubstitutesReachable`, DN-83) was exercised against hand-written
 * stand-ins rather than against the library that actually ships.
 *
 * Data only, deliberately: no client, no writes, nothing that happens on
 * import. That is the whole property that makes it readable from a spec.
 */

export type ExerciseSeed = {
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
  fallback?: string; // name of the no-equipment substitute
  // The movement group this belongs to (Feature #2, ADR-0004): the set of
  // movements that accomplish the same thing in a program, freely
  // interchangeable. Membership is a statement about role, not difficulty.
  movementGroup?: string;
  // Where this movement sits in the list its group is displayed in. Display
  // order only (DN-139) -- nothing resolves through it, so a member can be
  // inserted mid-list without moving anybody's stored choice.
  sortOrder?: number;
  // The member prescribed to an athlete who has not chosen in this group, or
  // whose choice they cannot perform today (ADR-0004 decision 7). Exactly one
  // per group, checked by `exercise-seed.spec.ts` and by a partial unique
  // index in the database.
  //
  // Declared rather than inferred from `sortOrder`: it is an opinion about
  // what to hand someone who has told the app nothing, and an opinion that is
  // written down is one that can be argued with. Spelled `0`, it could not be.
  isGroupDefault?: boolean;
  // Defaults to "reps" — set to "seconds" for timed holds (plank family).
  unit?: 'reps' | 'seconds';
  // Warm-up/cool-down tagging (Feature #63). Null/omitted for regular pool
  // exercises — only checklist content gets a phase.
  phase?: 'warmup' | 'cooldown';
  // How the movement is performed, in prose: setup, what one rep is, and the
  // cue or two that decide whether it's the movement at all. Required rather
  // than optional so a movement can't join the library with no way for the
  // athlete to find out what it is — the swap panel puts moves in front of
  // people who have never done them, so the copy has to exist before the
  // move does. Not the place for counts (WodMovement.reps) or for the
  // no-equipment fallback (`fallback`), both of which the app already shows
  // next to it.
  instructions: string;
};

export const exercises: ExerciseSeed[] = [
  // Push · Horizontal
  {
    name: 'Knee push-up',
    pattern: 'push',
    movementGroup: 'push_horizontal',
    sortOrder: 0,
    isGroupDefault: true,
    instructions:
      "Hands under the shoulders, knees on the floor, body straight from knees to head. Lower until the chest is a fist from the floor, then press back up. Keep the hips from sagging — the knees only shorten the lever, they don't change the plank.",
  },
  {
    name: 'Push-up',
    pattern: 'push',
    fallback: 'Knee push-up',
    movementGroup: 'push_horizontal',
    sortOrder: 1,
    instructions:
      'Full plank, hands under the shoulders, elbows tracking back at roughly 45° rather than flaring wide. Lower until the chest is a fist from the floor and press back up as one rigid piece — hips and shoulders arrive together.',
  },
  {
    name: 'Diamond push-up',
    pattern: 'push',
    movementGroup: 'push_horizontal',
    sortOrder: 2,
    instructions:
      'A push-up with the hands together under the sternum, index fingers and thumbs touching. Elbows stay close to the ribs on the way down. The narrow base shifts the work to the triceps, so expect fewer reps than a standard push-up.',
  },
  {
    name: 'Archer push-up',
    pattern: 'push',
    movementGroup: 'push_horizontal',
    sortOrder: 3,
    instructions:
      'Hands wider than a push-up. Lower toward one hand while the other arm straightens out along the floor, then press up and alternate sides. The working arm does the pressing; the straight arm is a kickstand, not a second presser.',
  },

  // Loaded pressing (DN-113) — its own group, not a member of
  // `push_horizontal`.
  //
  // The reason is equipment, not difficulty: a floor press needs a dumbbell
  // and every member of `push_horizontal` needs nothing, so grouping them
  // would put a movement the athlete may not be able to perform in a group
  // the resolver treats as freely interchangeable. Nothing here claims a
  // floor press is harder than an archer push-up; the code could not tell.
  {
    name: 'Dumbbell floor press',
    pattern: 'push',
    equipment: ['dumbbell'],
    fallback: 'Push-up',
    instructions:
      'On your back, knees bent, a dumbbell in each hand at chest height with the elbows on the floor at about 45°. Press until the arms are straight, then lower until the upper arms touch down again and pause there. The floor is the depth stop, which is what makes this kinder on the shoulders than a bench press.',
  },

  // Push · Vertical
  {
    name: 'Incline pike push-up',
    pattern: 'push',
    movementGroup: 'push_vertical',
    sortOrder: 0,
    isGroupDefault: true,
    instructions:
      'Hands on the floor, feet up on a chair or step, hips high so the body makes an upside-down V. Bend the elbows to lower the crown of the head toward the floor, then press back up. The higher the feet, the harder it gets.',
  },
  {
    name: 'Pike push-up',
    pattern: 'push',
    scalable: true,
    fallback: 'Incline pike push-up',
    movementGroup: 'push_vertical',
    sortOrder: 1,
    instructions:
      'Feet on the floor, hips pushed high into an upside-down V, hands shoulder-width. Lower the crown of the head toward the floor between the hands, then press back up. Keep the hips stacked over the shoulders — dropping them turns it into a push-up.',
  },
  {
    name: 'Handstand push-up',
    pattern: 'push',
    scalable: true,
    fallback: 'Pike push-up',
    movementGroup: 'push_vertical',
    sortOrder: 2,
    instructions:
      'Kick up to a handstand with the heels resting on a wall, hands slightly wider than the shoulders. Lower under control until the head touches the floor, then press back to locked arms. Only attempt it once a wall handstand hold is comfortable.',
  },

  // Pull
  {
    name: 'Supermans + reverse snow angels',
    pattern: 'pull',
    movementGroup: 'pull',
    sortOrder: 0,
    isGroupDefault: true,
    instructions:
      'Face down, arms overhead. Lift the chest, arms and legs off the floor, then sweep the arms out and down to the hips and back overhead, keeping them off the floor throughout. The floor-based stand-in for pulling when no bar is available.',
  },
  {
    name: 'Negative pull-up',
    pattern: 'pull',
    equipment: ['bar'],
    fallback: 'Supermans + reverse snow angels',
    movementGroup: 'pull',
    sortOrder: 1,
    instructions:
      'Jump or step up so the chin starts above the bar, then lower yourself as slowly as you can — aim for three to five seconds to full hang. Only the lowering half counts as the rep; step back up for the next one.',
  },
  {
    name: 'Chin-up',
    pattern: 'pull',
    equipment: ['bar'],
    fallback: 'Supermans + reverse snow angels',
    movementGroup: 'pull',
    sortOrder: 2,
    instructions:
      'Hang from the bar with palms facing you, hands shoulder-width. Pull until the chin clears the bar, then lower to straight arms. The underhand grip brings the biceps in, which is what makes it a different option rather than the same one.',
  },
  {
    name: 'Pull-up',
    pattern: 'pull',
    equipment: ['bar'],
    fallback: 'Supermans + reverse snow angels',
    movementGroup: 'pull',
    sortOrder: 3,
    instructions:
      'Hang from the bar with palms facing away, hands just outside the shoulders. Pull the chest toward the bar until the chin clears it, then lower all the way to straight arms. Start each rep from a dead hang rather than bouncing out of the bottom.',
  },

  // Loaded pulling (DN-113) — outside the group, for the reason the floor press is.
  // A dumbbell row is not a step above a pull-up; it is the horizontal pull
  // the library otherwise has nothing for, at whatever load you own.
  {
    name: 'Dumbbell row',
    pattern: 'pull',
    equipment: ['dumbbell'],
    fallback: 'Supermans + reverse snow angels',
    instructions:
      "Hinge at the hips with a flat back, one hand braced on a knee or a chair, the dumbbell hanging at arm's length. Pull it to the ribs by driving the elbow back, then lower to a full stretch. Alternate sides; each pull is a rep. The torso stays still — if it twists to help, the weight is winning.",
  },

  // Squat
  {
    name: 'Air squat',
    pattern: 'squat',
    movementGroup: 'squat',
    sortOrder: 0,
    isGroupDefault: true,
    instructions:
      'Feet shoulder-width, toes turned out slightly. Push the hips back and down until the hip crease drops below the top of the knee, then stand all the way up. Heels stay down and the knees track over the toes.',
  },
  {
    name: 'Reverse lunge',
    pattern: 'squat',
    movementGroup: 'squat',
    sortOrder: 1,
    instructions:
      'From standing, step one foot back and lower until both knees are bent near 90° and the back knee grazes the floor. Drive through the front heel to stand, then alternate legs. Stepping back rather than forward keeps the front knee quieter.',
  },
  {
    name: 'Assisted pistol',
    pattern: 'squat',
    movementGroup: 'squat',
    sortOrder: 2,
    instructions:
      'Stand on one leg with the other extended in front, holding a doorframe or strap for balance. Sit down as far as control allows and pull lightly on the support to help you back up — use only as much hand assistance as the rep actually needs.',
  },
  {
    name: 'Pistol squat',
    pattern: 'squat',
    scalable: true,
    fallback: 'Assisted pistol',
    movementGroup: 'squat',
    sortOrder: 3,
    instructions:
      'A full one-legged squat: stand on one leg, extend the other in front, and lower under control until the hamstring meets the calf, then stand back up without touching down. Arms out in front for a counterweight; the heel of the standing foot stays flat.',
  },
  // The loaded squats — members of `squat`, not a group of their own (DN-140).
  // They were split off in DN-84 on two grounds ADR-0004 retired, and held
  // apart afterwards only by DN-115's; `Exercise.equipment` says everything
  // the split was saying, and holding them apart stopped an athlete swapping
  // an air squat for the dumbbell in front of them.
  //
  // They sort after the bodyweight members so the swap panel leads with what
  // anyone can do, which is ordering and nothing more — see `movementGroup`
  // in the shared enums.
  //
  // The group is made of variations, never of weight: a 20 lb goblet squat
  // and a 40 lb one are the same exercise, and nothing in the schema can tell
  // them apart (DN-85). What varies here is where the load sits and how much
  // of the body has to hold it there.
  //
  // Every member carries its own bodyweight `fallback`, not just one of them
  // — the remembered choice is applied before equipment is, so an athlete can
  // be resolved onto any member of this group and then need a way out of it.
  {
    name: 'Goblet squat',
    pattern: 'squat',
    equipment: ['dumbbell'],
    movementGroup: 'squat',
    sortOrder: 4,
    fallback: 'Air squat',
    instructions:
      'Hold one dumbbell vertically against the chest, elbows tucked under it. Squat between your knees until the hips are below parallel, then stand. The weight at the chest is what keeps the torso upright — let it pull you forward and it becomes a different movement.',
  },
  {
    name: 'Dumbbell front squat',
    pattern: 'squat',
    equipment: ['dumbbell'],
    movementGroup: 'squat',
    sortOrder: 5,
    fallback: 'Air squat',
    instructions:
      'A dumbbell resting on each shoulder, elbows pointed forward and up. Squat to depth and stand, keeping both elbows high the whole way. Two weights split across the shoulders sit further from the midline than one at the chest, so the trunk works harder to stay upright.',
  },
  {
    // No group (DN-140). A thruster is a squat *and* an overhead press, so
    // prescribing it into a squat slot silently doubles the pressing volume of
    // a day that already has a push slot. It keeps its pattern and its
    // fallback and stays available to an authored WOD by name; what it stops
    // being is something a program slot resolves to or an athlete stores as a
    // standing choice.
    name: 'Dumbbell thruster',
    pattern: 'squat',
    equipment: ['dumbbell'],
    fallback: 'Jump squat',
    instructions:
      'Front squat into an overhead press in one movement: stand out of the bottom and let that drive send the dumbbells straight overhead, arms locked. Lower them back to the shoulders and go again. One rep is the whole thing — the pause between squat and press is what makes it two exercises instead of this one.',
  },

  // Siblings kept in the pool but not on the main squat line
  {
    name: 'Jump squat',
    pattern: 'squat',
    fallback: 'Air squat',
    instructions:
      'Squat to about parallel, then drive up hard and leave the floor. Land on the whole foot with soft knees and flow straight into the next rep. Absorb the landing rather than stiff-legging it.',
  },
  {
    name: 'Walking lunge',
    pattern: 'squat',
    instructions:
      'Step forward and lower until the back knee grazes the floor, then drive through the front heel and step the back foot straight through into the next lunge. Torso stays upright; each step is a rep.',
  },
  // Box (DN-33, grouped in DN-115, merged in DN-140). The step-up is a squat
  // member like any other now; the box jump is not a squat at all and holds no
  // group. Keeping the two together was what DN-115 bought, and it cost the
  // step-up its swap to a movement needing no box — the trade ADR-0004
  // decision 9 reversed.
  {
    name: 'Box step-up',
    pattern: 'squat',
    equipment: ['box'],
    movementGroup: 'squat',
    sortOrder: 6,
    fallback: 'Reverse lunge',
    instructions:
      'Place one whole foot on the box, drive through that heel until the leg is straight, then lower under control and step down. Alternate legs; each step up is a rep. Push through the top foot rather than bouncing off the bottom one — a box around knee height is plenty.',
  },
  {
    // No group (DN-140), for the same reason the thruster has none: a box jump
    // is plyometric, so "3x8 squat" performed as box jumps is a different
    // session. Its fallback already says where an athlete without a box goes.
    name: 'Box jump',
    pattern: 'squat',
    equipment: ['box'],
    fallback: 'Jump squat',
    instructions:
      'From a quarter squat, swing the arms and jump onto the box, landing on the whole foot with knees soft and hips back. Stand up fully on top, then step down — one foot at a time, every rep. Pick a height you can land on, not the one you can barely clear.',
  },

  // Hinge
  {
    name: 'Glute bridge',
    pattern: 'hinge',
    movementGroup: 'hinge',
    sortOrder: 0,
    isGroupDefault: true,
    instructions:
      'Lie on your back, knees bent, feet flat and close to the hips. Squeeze the glutes to drive the hips up until knees, hips and shoulders form a straight line, pause, then lower. Push with the glutes, not by arching the lower back.',
  },
  {
    name: 'Single-leg glute bridge',
    pattern: 'hinge',
    fallback: 'Glute bridge',
    movementGroup: 'hinge',
    sortOrder: 1,
    instructions:
      'A glute bridge with one foot planted and the other leg held straight out or knee hugged to the chest. Drive the hips up with the planted leg, keeping the hips level rather than letting the free side drop. Do all reps on one side, then switch.',
  },
  {
    name: 'Superman',
    pattern: 'hinge',
    movementGroup: 'hinge',
    sortOrder: 2,
    instructions:
      'Face down, arms stretched overhead. Lift the chest, arms and legs off the floor at the same time, hold for a beat, then lower under control. Look at the floor rather than forward so the neck stays in line with the spine.',
  },
  {
    name: 'Single-leg superman',
    pattern: 'hinge',
    movementGroup: 'hinge',
    sortOrder: 3,
    instructions:
      'A superman lifting one arm and the opposite leg, holding briefly before switching. Working diagonally makes the back and glutes resist rotation as well as extend, which is what puts it above the two-sided version.',
  },
  // The loaded hinges — members of `hinge` since DN-140, for the same reason
  // the loaded squats are members of `squat`: see the comment above.
  //
  // The swing is the one movement here that genuinely wants a kettlebell
  // rather than a dumbbell, which is what earns it its own row in the
  // catalog. The two deadlifts are tagged `dumbbell`, the piece more people
  // own, and read the same held in either hand.
  {
    name: 'Romanian deadlift',
    pattern: 'hinge',
    equipment: ['dumbbell'],
    movementGroup: 'hinge',
    sortOrder: 4,
    fallback: 'Glute bridge',
    instructions:
      'Dumbbells in front of the thighs, knees softly bent and fixed there. Push the hips straight back, letting the weights track down the legs until you feel the hamstrings load, then drive the hips forward to stand. The back stays flat throughout — this is a hinge, not a squat and not a round-backed reach for the floor.',
  },
  {
    name: 'Single-leg Romanian deadlift',
    pattern: 'hinge',
    equipment: ['dumbbell'],
    movementGroup: 'hinge',
    sortOrder: 5,
    fallback: 'Single-leg glute bridge',
    instructions:
      'One dumbbell, standing on one leg. Hinge at the hip and let the free leg travel straight back as a counterweight, body forming one line from head to heel, then stand tall. Do all the reps on one side before switching. The hips stay square to the floor — letting the free hip open up turns it into a twist.',
  },
  {
    name: 'Kettlebell swing',
    pattern: 'hinge',
    equipment: ['kettlebell'],
    movementGroup: 'hinge',
    sortOrder: 6,
    fallback: 'Broad jump',
    instructions:
      'Hike the kettlebell back between the legs, then snap the hips forward to float it to chest height — the arms only steer it. Let it fall back into the next hinge. It is a hip snap, not a front raise: if the shoulders are lifting the bell, it is too heavy or the hips are too quiet.',
  },

  {
    name: 'Broad jump',
    pattern: 'hinge',
    instructions:
      'From a quarter squat, swing the arms and jump forward as far as you can, landing on both feet with hips back and knees soft. Reset and turn around when you run out of room. Stick the landing before starting the next rep.',
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
    name: 'Sit-up',
    pattern: 'core',
    movementGroup: 'core_dynamic',
    sortOrder: 0,
    isGroupDefault: true,
    instructions:
      'On your back, knees bent, feet flat. Curl up until the torso is upright and reaches past the knees, then lower back down. Come up one vertebra at a time rather than yanking with the neck or throwing the arms.',
  },
  {
    name: 'Tuck-up',
    pattern: 'core',
    movementGroup: 'core_dynamic',
    sortOrder: 1,
    instructions:
      'Lie on your back, arms overhead, legs straight. Crunch up and tuck the knees to the chest at the same time so hands and shins meet over the middle, then extend back out without letting the feet and hands rest on the floor.',
  },
  {
    name: 'V-up',
    pattern: 'core',
    fallback: 'Tuck-up',
    movementGroup: 'core_dynamic',
    sortOrder: 2,
    instructions:
      'The straight-legged tuck-up: from flat on your back with arms overhead, lift the legs and torso together into a V and reach for the toes, then lower under control. Keep the legs straight — bending them turns it back into a tuck-up.',
  },
  {
    name: 'Lying leg raise',
    pattern: 'core',
    movementGroup: 'core_dynamic',
    sortOrder: 3,
    instructions:
      'On your back, hands under the hips or by your sides, legs straight. Raise the legs to vertical, then lower to just above the floor without touching down. Press the lower back into the floor the whole way — if it lifts, shorten the range.',
  },
  {
    name: 'Hanging knee raise',
    pattern: 'core',
    equipment: ['bar'],
    fallback: 'Lying leg raise',
    movementGroup: 'core_dynamic',
    sortOrder: 4,
    instructions:
      'Hang from the bar with straight arms and shoulders pulled down away from the ears. Raise the knees to at least hip height, then lower under control without swinging. Stop the swing between reps rather than using it.',
  },
  {
    name: 'Toes-to-bar',
    pattern: 'core',
    equipment: ['bar'],
    fallback: 'V-up',
    movementGroup: 'core_dynamic',
    sortOrder: 5,
    instructions:
      'From a hang, raise straight legs until both feet touch the bar between the hands, then lower with control. The rep counts on contact with the bar; half-height raises are hanging knee raises, not this.',
  },
  // Core · Anti-extension — timed holds, not rep-counted.
  {
    name: 'Knee plank',
    pattern: 'core',
    movementGroup: 'core_hold',
    sortOrder: 0,
    isGroupDefault: true,
    unit: 'seconds',
    instructions:
      'Forearms on the floor, elbows under the shoulders, knees down, body straight from knees to head. Squeeze the glutes and brace the stomach for the whole hold. Counted in seconds, not reps.',
  },
  {
    name: 'Tucked hollow hold',
    pattern: 'core',
    movementGroup: 'core_hold',
    sortOrder: 1,
    unit: 'seconds',
    instructions:
      'The hollow hold with the knees tucked toward the chest and the arms alongside them. The shorter shape makes it far easier to keep the lower back pressed into the floor, which is the point of the position.',
  },
  {
    name: 'Plank hold',
    pattern: 'core',
    fallback: 'Knee plank',
    movementGroup: 'core_hold',
    sortOrder: 2,
    unit: 'seconds',
    instructions:
      'Forearms on the floor, elbows under the shoulders, legs straight, body in one line from heels to head. Brace the stomach and squeeze the glutes so the hips neither sag nor pike up. Counted in seconds, not reps.',
  },
  {
    name: 'Hollow hold',
    pattern: 'core',
    fallback: 'Tucked hollow hold',
    movementGroup: 'core_hold',
    sortOrder: 3,
    unit: 'seconds',
    instructions:
      "On your back, arms overhead, legs straight. Press the lower back flat into the floor and lift the shoulders and heels a few inches, holding that dish shape. If the back lifts off the floor, tuck the knees in until it doesn't.",
  },
  {
    name: 'Long-lever plank',
    pattern: 'core',
    movementGroup: 'core_hold',
    sortOrder: 4,
    unit: 'seconds',
    instructions:
      'A plank with the elbows placed further forward, ahead of the shoulders. The longer lever multiplies the load on the stomach, so expect a much shorter hold. Stop the moment the lower back starts to sag.',
  },

  // Core · Anti-rotation
  {
    name: 'Knee side plank',
    pattern: 'core',
    movementGroup: 'core_side',
    sortOrder: 0,
    isGroupDefault: true,
    instructions:
      'On your side, elbow under the shoulder, knees bent and stacked. Lift the hips so the body is straight from knees to head, hold, then lower. Split the prescribed reps evenly between the two sides.',
  },
  {
    name: 'Side plank',
    pattern: 'core',
    fallback: 'Knee side plank',
    movementGroup: 'core_side',
    sortOrder: 1,
    instructions:
      'On your side, elbow under the shoulder, legs straight and feet stacked. Lift the hips into one line from heels to head and keep the top hip from rolling backwards. Split the prescribed reps evenly between the two sides.',
  },

  // Core · Carries (DN-113) — counted in seconds, like the holds above.
  //
  // A carry is really measured in distance, which `Exercise.unit` has no word
  // for. Seconds is the honest half of it rather than a compromise: "carry
  // these for forty seconds" is a real prescription, where a carry counted in
  // reps is not a carry at all.
  //
  // Both fall to a plank rather than to a side plank or a hold matching their
  // own bracing direction, because the fallback has to keep the unit: the
  // `core_side` movements are rep-counted, so a forty-second carry handed to
  // an athlete without dumbbells would arrive as forty side planks.
  {
    name: 'Farmer carry',
    pattern: 'core',
    equipment: ['dumbbell'],
    fallback: 'Plank hold',
    unit: 'seconds',
    instructions:
      'A dumbbell in each hand at your sides, shoulders back and down, ribs stacked over the hips. Walk at a steady pace — turning where you run out of room — without leaning back or letting the weights swing. Counted in seconds, not reps or lengths.',
  },
  {
    name: 'Suitcase carry',
    pattern: 'core',
    equipment: ['dumbbell'],
    fallback: 'Plank hold',
    unit: 'seconds',
    instructions:
      'The farmer carry with one dumbbell instead of two, held at one side. The load pulls you sideways and the job is to stay upright — both shoulders level, no leaning away from the weight. Split the prescribed time evenly between the two sides.',
  },

  // Cardio — not part of a movement groups
  {
    name: 'Burpee',
    pattern: 'cardio',
    fallback: 'Squat thrust',
    instructions:
      'From standing, drop to a plank and let the chest touch the floor, jump the feet back under you, then stand and jump with the hands overhead. Chest to the floor at the bottom and feet off the floor at the top make it a full rep.',
  },
  {
    name: 'Squat thrust',
    pattern: 'cardio',
    instructions:
      'A burpee without the floor contact or the jump: squat down, hands to the floor, jump the feet back to a plank, jump them back in, and stand. Easier on the shoulders and the lungs, and the substitute when burpees are too much.',
  },
  {
    name: 'Mountain climber',
    pattern: 'cardio',
    instructions:
      'From a plank with the hands under the shoulders, drive one knee toward the chest and switch feet quickly. Keep the hips low and level rather than bouncing them up — each knee drive is a rep.',
  },
  {
    name: 'High knees',
    pattern: 'cardio',
    instructions:
      'Run on the spot lifting each knee to at least hip height, landing on the balls of the feet with a tall torso. Each knee lift is a rep. Pump the arms in time with the legs.',
  },
  // Jump rope (DN-32) — the one group in `cardio`, added in DN-115.
  //
  // DN-32 put these in no group, reasoning that a rope is not something
  // anyone climbs in order: an athlete picks the one they can turn. The
  // premise holds and the conclusion does not follow. The swap panel is *how*
  // an athlete picks, and outside a group it offers only the bodyweight
  // fallback — so someone who owned a rope and could not yet turn doubles was
  // offered high knees, which is the app taking away gear they have.
  //
  // The group is not a claim that everyone should work single → double. It is
  // the only way the app can put both in front of them.
  //
  // Both still fall to high knees, which keeps the feet moving at the same
  // cadence and needs nothing.
  {
    name: 'Single-unders',
    pattern: 'cardio',
    equipment: ['jump_rope'],
    movementGroup: 'cardio_rope',
    sortOrder: 0,
    isGroupDefault: true,
    fallback: 'High knees',
    instructions:
      'Turn the rope with the wrists, not the arms, and hop just high enough to clear it — one pass under the feet is a rep. Elbows stay close to the ribs; big arm circles make the rope slower and the jump higher than it needs to be.',
  },
  {
    name: 'Double-unders',
    pattern: 'cardio',
    equipment: ['jump_rope'],
    movementGroup: 'cardio_rope',
    sortOrder: 1,
    fallback: 'High knees',
    instructions:
      'One jump, two passes of the rope. Jump a little higher than a single-under and turn the wrists faster rather than pulling the knees up — tucking the legs is what turns a set into a string of misses. Trip the rope and you start the next rep, not the set again.',
  },

  // Warm-up (Feature #63) — tagged with the pattern they best prep, so a
  // WOD's dominantPattern can pull in relevant moves.
  {
    name: 'Arm circles',
    pattern: 'push',
    phase: 'warmup',
    instructions:
      'Arms straight out at shoulder height. Draw small circles forward, growing them gradually, then reverse. About twenty seconds each direction is enough to warm the shoulders.',
  },
  {
    name: 'Leg swings',
    pattern: 'hinge',
    phase: 'warmup',
    instructions:
      'Hold a wall for balance and swing one leg forward and back, then side to side across the body, ten or so each way before switching legs. Swing to the edge of a comfortable range, not into a stretch.',
  },
  {
    name: 'Bodyweight squats',
    pattern: 'squat',
    phase: 'warmup',
    instructions:
      'Easy, unloaded air squats at a steady pace, sinking a little deeper each rep. This is a rehearsal to get the hips and knees moving, not a set to work at.',
  },
  {
    name: 'Inchworms',
    pattern: 'core',
    phase: 'warmup',
    instructions:
      'From standing, fold forward, walk the hands out to a plank, hold a beat, then walk the feet up to the hands and stand. Keeps the hamstrings, shoulders and stomach all in the warm-up at once.',
  },
  {
    name: 'Scapular pull-ups',
    pattern: 'pull',
    phase: 'warmup',
    instructions:
      'Hang from the bar with straight arms and pull the shoulder blades down and together to lift yourself an inch or two, then relax back into the hang. The elbows stay straight throughout — it is a very short range on purpose.',
  },
  {
    name: 'Light jogging in place',
    pattern: null,
    phase: 'warmup',
    instructions:
      'An easy jog on the spot, feet barely leaving the floor, for a minute or so. Aim for warm and slightly out of breath, nothing more.',
  },

  // Cool-down (Feature #63)
  {
    name: 'Static quad stretch',
    pattern: 'squat',
    phase: 'cooldown',
    instructions:
      'Standing, pull one heel toward the glute with knees together and hips pushed slightly forward. Hold for twenty to thirty seconds, then switch legs. Hold a wall if balance is a problem.',
  },
  {
    name: "Child's pose",
    pattern: 'hinge',
    phase: 'cooldown',
    instructions:
      'Kneel, sit the hips back onto the heels and reach the arms forward on the floor, forehead down. Breathe slowly and let the lower back and shoulders settle for thirty seconds or more.',
  },
  {
    name: 'Cat-cow',
    pattern: 'core',
    phase: 'cooldown',
    instructions:
      'On hands and knees, alternate between arching the back and rounding it, moving with the breath. Slow and easy — this is about moving the spine through its range, not stretching hard.',
  },
  {
    name: 'Doorway chest stretch',
    pattern: 'push',
    phase: 'cooldown',
    instructions:
      'Put a forearm on a doorframe with the elbow at shoulder height and step gently through until you feel the chest open. Hold twenty to thirty seconds a side; ease off if it pinches at the front of the shoulder.',
  },
  {
    name: 'Cross-body shoulder stretch',
    pattern: 'pull',
    phase: 'cooldown',
    instructions:
      'Bring one arm straight across the chest and use the other forearm to draw it closer. Hold twenty to thirty seconds, then switch. Keep the shoulder down rather than shrugged toward the ear.',
  },
  {
    name: 'Deep breathing',
    pattern: null,
    phase: 'cooldown',
    instructions:
      'Lie or sit comfortably and breathe in through the nose for four counts, out through the mouth for six, for around a minute. The long exhale is what brings the heart rate down.',
  },
];
