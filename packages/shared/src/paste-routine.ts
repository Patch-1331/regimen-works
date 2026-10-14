/**
 * Reading a routine pasted in from elsewhere (DN-152, from DN-137's verdict).
 *
 * Two halves, both pure: the parser turns the text into days of lines, and
 * the matcher finds each line's movement in the library -- or refuses. What
 * the athlete accepts goes onto the routine editor's week sheet, which holds
 * it to the same rules as a routine typed there.
 *
 * The matcher's bar is "the same movement", never "the nearest one". A
 * refusal costs the athlete one search in the picker; a wrong guess they do
 * not notice costs them a routine that trains something else.
 */

/** One `sets × reps` of a pasted line. A hold in seconds keeps its count in `reps`. */
export type PastedScheme = {
  sets: number;
  reps: number | null;
  repsMax: number | null;
  toFailure: boolean;
  /** "3x60s": the count is seconds, for a held movement. */
  seconds: boolean;
};

export type PastedLine = {
  /** The line as pasted, for the read-back. */
  source: string;
  /** What the line calls the movement: the text before its first scheme. */
  name: string;
  /** One per `&`-joined scheme; empty where the line gave none. */
  schemes: PastedScheme[];
  restSeconds: number | null;
  /**
   * A load the line carried, as written. The app does not track weight
   * (ADR 0005, decision 5), so it is dropped -- and said to be.
   */
  droppedLoad: string | null;
};

export type PastedDay = {
  /** The heading as pasted, or null for lines that came before any heading. */
  heading: string | null;
  /**
   * What the heading calls the day once the day itself is cut away (DN-155):
   * "Monday — Chest and Triceps" is "Chest and Triceps". Null for a bare
   * "Monday" or "Day 2", and for lines that came before any heading.
   */
  name: string | null;
  /** 0 = Sunday. Null when the routine is an order rather than a schedule. */
  dayOfWeek: number | null;
  lines: PastedLine[];
};

export type PastedRoutine = {
  /**
   * `fixed` only when every day was headed by a weekday. A "Day 1" anywhere
   * makes the whole routine an order, since its weekdays were never all said.
   */
  scheduleMode: "fixed" | "flexible";
  days: PastedDay[];
};

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

// Counts are bounded to four digits, and a scheme starts where a number does
// (not partway into one): an unbounded \d+ tried at every position of a long
// run of digits is quadratic, and pasted text is anyone's.
const SCHEME_START = /(?<!\d)\d{1,4}\s{0,3}[x×]\s{0,3}(?:failure|\d)/i;
const SCHEME =
  /(?<!\d)(\d{1,4})\s{0,3}[x×]\s{0,3}(failure|\d{1,4}\s{0,3}s(?:ec(?:ond)?s?)?\b|\d{1,4}(?:\s{0,3}[-–]\s{0,3}\d{1,4})?)/gi;
const LOAD = /@\s{0,3}(\d{1,5}(?:\.\d{1,2})?\s{0,3}(?:kg|lbs?)?)/i;
const REST = /\brest\s{0,3}(\d{1,4})\s?s?/i;
const LIST_MARKER = /^(?:[-*•]|\d+[.)])\s+/;

const WEEKDAY_NAMES = [
  ["sun", "sunday"],
  ["mon", "monday"],
  ["tue", "tues", "tuesday"],
  ["wed", "weds", "wednesday"],
  ["thu", "thur", "thurs", "thursday"],
  ["fri", "friday"],
  ["sat", "saturday"],
];
const WEEKDAY_HEADING = new RegExp(
  `^(${WEEKDAY_NAMES.flat().join("|")})\\b(?!\\s*\\d+\\s*[x×])`,
  "i",
);
const ORDER_HEADING = /^day\s{0,3}\d{1,2}\b/i;

/** The heading after its day: separators and spaces off the front. */
function dayName(heading: string, day: string): string | null {
  const name = heading.slice(day.length).replace(/^[\s—–:\-.,|]+/, "").trim();
  return name === "" ? null : name;
}

/** "Barbell Squat 5x5 @ 225 rest 90s" → its movement, schemes, rest and load. */
export function parsePastedLine(text: string): PastedLine {
  const source = text.trim();
  const body = source.replace(LIST_MARKER, "");
  const load = body.match(LOAD);
  const rest = body.match(REST);

  // The name ends where the prescription starts: the first scheme, load or
  // rest, whichever comes first.
  const ends = [SCHEME_START, /@/, REST]
    .map((re) => body.search(re))
    .filter((i) => i >= 0);
  const name = body.slice(0, ends.length ? Math.min(...ends) : undefined).trim();

  const schemes = [...body.matchAll(SCHEME)].map((m): PastedScheme => {
    const sets = Number(m[1]);
    const r = m[2].toLowerCase().replace(/\s/g, "");
    if (r === "failure") {
      return { sets, reps: null, repsMax: null, toFailure: true, seconds: false };
    }
    if (/s/.test(r)) {
      return { sets, reps: parseInt(r, 10), repsMax: null, toFailure: false, seconds: true };
    }
    const [lo, hi] = r.split(/[-–]/).map(Number);
    return { sets, reps: lo, repsMax: hi ?? null, toFailure: false, seconds: false };
  });

  return {
    source,
    name,
    schemes,
    restSeconds: rest ? Number(rest[1]) : null,
    droppedLoad: load ? load[1].replace(/\s/g, "") : null,
  };
}

/** A whole pasted routine: blank lines skipped, headings opening days. */
export function parsePastedRoutine(text: string): PastedRoutine {
  const days: PastedDay[] = [];
  let pinned = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const weekday = line.match(WEEKDAY_HEADING);
    if (weekday) {
      const word = weekday[1].toLowerCase();
      days.push({
        heading: line,
        name: dayName(line, weekday[0]),
        dayOfWeek: WEEKDAY_NAMES.findIndex((names) => names.includes(word)),
        lines: [],
      });
      continue;
    }
    const order = line.match(ORDER_HEADING);
    if (order) {
      pinned = false;
      days.push({
        heading: line,
        name: dayName(line, order[0]),
        dayOfWeek: null,
        lines: [],
      });
      continue;
    }
    if (days.length === 0) {
      pinned = false;
      days.push({ heading: null, name: null, dayOfWeek: null, lines: [] });
    }
    days[days.length - 1].lines.push(parsePastedLine(line));
  }
  return {
    scheduleMode: pinned && days.length > 0 ? "fixed" : "flexible",
    days: pinned ? days : days.map((d) => ({ ...d, dayOfWeek: null })),
  };
}

// ---------------------------------------------------------------------------
// The matcher
// ---------------------------------------------------------------------------

/** What the matcher needs of a library row. */
export type MatchableExercise = { name: string; equipment: readonly string[] };

export type PastedMatch<E extends MatchableExercise> =
  /** `guessed` when the library's name is not what the text said, so the read-back shows it. */
  | { kind: "match"; exercise: E; guessed: boolean }
  /** Several fit equally well; choosing one would be approximating. */
  | { kind: "ambiguous"; candidates: E[] }
  | { kind: "none" };

/**
 * An implement a name can carry, and the equipment it means. Named in the
 * text, it must be in the exercise's equipment ("Barbell row" never becomes
 * "Dumbbell row"); named in the library and not the text, the exercise adds
 * it, and is refused.
 */
const IMPLEMENTS: Record<string, string> = {
  barbell: "barbell",
  dumbbell: "dumbbell",
  kettlebell: "kettlebell",
  cable: "gym_machines",
  machine: "gym_machines",
  smith: "gym_machines",
  band: "bands",
};

/**
 * Words either side may carry without changing the movement: grip, posture,
 * and the muscle a press is named for. "Seated dumbbell shrug" is a dumbbell
 * shrug; "Incline dumbbell chest press" is the incline dumbbell press.
 *
 * Not here, on purpose: anything that adds a load ("weighted"), an angle
 * ("incline", "decline"), or a part of the body that makes it another
 * movement ("wrist"). Those are different exercises.
 */
const QUALIFIERS = new Set([
  "grip",
  "neutral",
  "underhand",
  "overhand",
  "wide",
  "close",
  "narrow",
  "medium",
  "seated",
  "standing",
  "side",
  "chest",
]);
/** A grip both sides name must be the same grip: underhand is not wide. */
const GRIPS = new Set(["neutral", "underhand", "overhand", "wide", "close", "narrow"]);
/**
 * Qualifiers the library may carry at no cost, as the unmarked case:
 * "Barbell bench press - medium grip" is what "Barbell bench press" means,
 * where "Close-grip barbell bench press" is a choice the text did not make.
 */
const UNMARKED = new Set(["grip", "medium"]);

function stem(word: string): string {
  if (word.length < 4 || word.endsWith("ss")) return word;
  if (/(ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** "Pull-Ups" and "Pullups" are the same two words: pull, up. */
function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\b(pull|chin|push|sit|step)-?ups?\b/g, "$1 up")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem);
}

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((w) => b.has(w));

/**
 * The library row that is the movement the text names, or a refusal.
 *
 * A row is a candidate when, setting implements and qualifiers aside, its
 * name and the text are the same words; when every implement the text names
 * is in its equipment; when its name names no implement the text left out;
 * and when the two do not name different grips. The candidates whose names
 * carry the fewest marked qualifiers win, and a tie is refused.
 */
export function matchPastedMovement<E extends MatchableExercise>(
  text: string,
  library: readonly E[],
): PastedMatch<E> {
  const said = words(text);
  if (said.length === 0) return { kind: "none" };
  const saidImplements = new Set(said.flatMap((w) => IMPLEMENTS[w] ?? []));
  const saidGrips = new Set(said.filter((w) => GRIPS.has(w)));
  const saidCore = new Set(said.filter((w) => !IMPLEMENTS[w] && !QUALIFIERS.has(w)));

  let best: E[] = [];
  let bestCost = Infinity;
  for (const e of library) {
    const named = words(e.name);
    if (!named.every((w) => !IMPLEMENTS[w] || saidImplements.has(IMPLEMENTS[w]))) continue;
    if (![...saidImplements].every((i) => e.equipment.includes(i))) continue;
    const grips = new Set(named.filter((w) => GRIPS.has(w)));
    if (saidGrips.size > 0 && grips.size > 0 && !sameSet(saidGrips, grips)) continue;
    const core = new Set(named.filter((w) => !IMPLEMENTS[w] && !QUALIFIERS.has(w)));
    if (!sameSet(core, saidCore)) continue;

    const cost = named.filter((w) => QUALIFIERS.has(w) && !UNMARKED.has(w)).length;
    if (cost < bestCost) {
      best = [e];
      bestCost = cost;
    } else if (cost === bestCost) {
      best.push(e);
    }
  }

  if (best.length === 0) return { kind: "none" };
  if (best.length > 1) return { kind: "ambiguous", candidates: best };
  const [exercise] = best;
  return {
    kind: "match",
    exercise,
    guessed: exercise.name.trim().toLowerCase() !== text.trim().toLowerCase(),
  };
}
