import {
  equipment,
  exerciseCategory,
  exerciseLevel,
  movementPattern,
  muscle,
  type Equipment,
  type ExerciseCategory,
  type ExerciseLevel,
  type MovementPattern,
  type Muscle,
} from "@regimen-works/shared";

/**
 * The library page's search and filters, as the URL holds them (DN-171).
 *
 * In the URL rather than in component state, so a filtered view can be
 * linked and survives a reload. Pure, and in lib, so the reading and writing
 * can be tested without mounting the page.
 *
 * Read leniently: a link is something a person types or pastes, and one
 * stale or misspelt value should drop that filter, not empty the page or
 * send the API a query it will refuse.
 */
export type LibraryFilters = {
  q: string;
  muscle: Muscle | null;
  equipment: Equipment | null;
  category: ExerciseCategory | null;
  level: ExerciseLevel | null;
  pattern: MovementPattern | null;
  /**
   * Only what the athlete's equipment covers. On unless the URL says
   * `kit=all`: the library is mostly movements for kit they don't have, and
   * the first view should be the one they can train from.
   */
  owned: boolean;
  /** 1-based. */
  page: number;
};

/** The filters that pick from a fixed list, in the order the page shows them. */
export const SELECT_FILTERS = [
  "muscle",
  "equipment",
  "category",
  "level",
  "pattern",
] as const;
export type SelectFilter = (typeof SELECT_FILTERS)[number];

/** Every value each list filter accepts, from the shared enums. */
export const FILTER_VALUES: Record<SelectFilter, readonly string[]> = {
  muscle: muscle.options,
  equipment: equipment.options,
  category: exerciseCategory.options,
  level: exerciseLevel.options,
  pattern: movementPattern.options,
};

function pick<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = params.get(key);
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function readFilters(params: URLSearchParams): LibraryFilters {
  const page = Number(params.get("page"));
  return {
    q: (params.get("q") ?? "").trim(),
    muscle: pick(params, "muscle", muscle.options),
    equipment: pick(params, "equipment", equipment.options),
    category: pick(params, "category", exerciseCategory.options),
    level: pick(params, "level", exerciseLevel.options),
    pattern: pick(params, "pattern", movementPattern.options),
    owned: params.get("kit") !== "all",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/**
 * The URL for `filters`, naming only what differs from the default, so the
 * plain library is a plain `/library` and a link says only what it narrows.
 */
export function writeFilters(filters: LibraryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  for (const key of SELECT_FILTERS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (!filters.owned) params.set("kit", "all");
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

/**
 * The API's query string for `filters`. Its own function rather than
 * `writeFilters`, because the two disagree on the kit switch's default: the
 * page has it on unless told otherwise, and the API off.
 */
export function searchQuery(filters: LibraryFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  for (const key of SELECT_FILTERS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  params.set("owned", String(filters.owned));
  params.set("page", String(filters.page));
  return params.toString();
}

/** Whether anything narrows the list beyond the default kit switch. */
export function isFiltered(filters: LibraryFilters): boolean {
  return filters.q !== "" || SELECT_FILTERS.some((key) => filters[key] !== null);
}

/**
 * A dataset value as a person reads it: "lower_back" as "Lower back",
 * "olympic_weightlifting" as "Olympic weightlifting".
 */
export function humanize(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
