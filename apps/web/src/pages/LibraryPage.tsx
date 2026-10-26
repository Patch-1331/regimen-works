import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { equipmentLabel, type CreateExercise, type Equipment } from "@regimen-works/shared";
import { ApiError, api, type ApiExercise, type LibraryTier } from "../lib/api";
import { ExerciseForm } from "../components/ExerciseForm";
import {
  EMPTY_DRAFT,
  alternativesFor,
  toDraft,
} from "../lib/exerciseDraft";
import { lineLabel, patternLabel } from "../lib/progressions";
import {
  FILTER_VALUES,
  SELECT_FILTERS,
  humanize,
  isFiltered,
  readFilters,
  searchQuery,
  writeFilters,
  type LibraryFilters,
  type SelectFilter,
} from "../lib/libraryFilters";
import { SectionLabel } from "../components/Panel";
import { LibraryNav } from "../components/LibraryNav";
import { SeededNote } from "../components/SeededNote";
import { DatasetCredit } from "../components/DatasetCredit";

/**
 * Which form is open, if any. A single piece of state rather than one flag per
 * section, because two forms open at once on a phone-width column is not a
 * state worth being able to reach.
 */
type Editing =
  | { kind: "none" }
  | { kind: "create"; tier: LibraryTier }
  | { kind: "edit"; tier: LibraryTier; exercise: ApiExercise };

/** What a row says about itself under its name — pattern, group, equipment. */
function summarise(exercise: ApiExercise): string {
  const parts: string[] = [];
  if (exercise.pattern) parts.push(patternLabel(exercise.pattern));
  // The group, but not the position in it. A list index is not information
  // an athlete needs, and printing it is what made it look like a grade.
  if (exercise.movementGroup)
    parts.push(lineLabel(exercise.movementGroup));
  parts.push(
    exercise.equipment.length === 0
      ? "bodyweight"
      : exercise.equipment
          .map((piece) => equipmentLabel(piece as Equipment))
          .join(", "),
  );
  return parts.join(" — ");
}

function ExerciseRow({
  exercise,
  search,
  editable,
  seeded,
  onEdit,
  onArchive,
  onUnarchive,
  busy,
}: {
  exercise: ApiExercise;
  /** The list's own query string, for the detail view's way back. */
  search: string;
  editable: boolean;
  /** Shown to an admin on a row the library files own, in place of controls. */
  seeded: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  busy: boolean;
}) {
  const retired = exercise.archivedAt !== null;
  return (
    <li
      className="flex items-center gap-3 px-4 py-3"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[14px]"
          style={{ color: retired ? "var(--ink-faint)" : "var(--ink)" }}
        >
          {/* The name opens the detail view (DN-171), carrying the filters
              along so "back" lands on the list the athlete left. */}
          <Link
            to={`/library/movements/${exercise.id}`}
            state={{ from: search }}
            className="underline-offset-2 hover:underline"
          >
            {exercise.name}
          </Link>
          {exercise.ownerId !== null && !retired && (
            <span
              className="ml-2 text-[10px] tracking-[0.14em] text-[var(--glow)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              YOURS
            </span>
          )}
          {/* Said in words rather than by a strikethrough, which a screen
              reader does not read out and a glance can mistake for styling. */}
          {retired && (
            <span className="ml-2 text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
              Retired
            </span>
          )}
        </p>
        <p className="truncate text-[11px] text-[var(--ink-faint)]">
          {summarise(exercise)}
        </p>
        {seeded && <SeededNote kind="exercise" />}
      </div>
      {editable && (
        <div className="flex shrink-0 gap-2">
          {retired ? (
            <button
              type="button"
              disabled={busy}
              onClick={onUnarchive}
              className="px-2 py-1 text-[11px] uppercase tracking-[0.14em] disabled:opacity-50"
              style={{
                border: "1px solid var(--border)",
                color: "var(--ink-soft)",
                fontFamily: "var(--font-mono)",
              }}
              aria-label={`Bring back ${exercise.name}`}
            >
              Bring back
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="px-2 py-1 text-[11px] uppercase tracking-[0.14em]"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--ink-soft)",
                  fontFamily: "var(--font-mono)",
                }}
                aria-label={`Edit ${exercise.name}`}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onArchive}
                className="px-2 py-1 text-[11px] uppercase tracking-[0.14em] disabled:opacity-50"
                style={{
                  border: "1px solid var(--danger)",
                  color: "var(--danger)",
                  fontFamily: "var(--font-mono)",
                }}
                aria-label={`Retire ${exercise.name}`}
              >
                Retire
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** What each list filter is called on the page, and what its "any" reads. */
const FILTER_LABELS: Record<SelectFilter, { label: string; any: string }> = {
  muscle: { label: "Muscle", any: "Any muscle" },
  equipment: { label: "Equipment", any: "Any equipment" },
  category: { label: "Category", any: "Any category" },
  level: { label: "Level", any: "Any level" },
  pattern: { label: "Pattern", any: "Any pattern" },
};

function optionLabel(filter: SelectFilter, value: string): string {
  if (filter === "equipment") return equipmentLabel(value as Equipment);
  if (filter === "pattern") return patternLabel(value);
  return humanize(value);
}

const control = "mt-1 w-full px-3 py-2 text-sm";
const controlStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  color: "var(--ink)",
  fontFamily: "var(--font-mono)",
} as const;

const quietButton = {
  border: "1px solid var(--border)",
  color: "var(--ink-soft)",
  fontFamily: "var(--font-mono)",
} as const;

/**
 * The movement library (DN-28, DN-171): one searchable list across both
 * tiers, the shared library and the athlete's own movements, because a
 * search that could not find your own box step-up would be a strange search.
 * Which tier a row is in still decides who may edit it, so the athlete's own
 * rows say YOURS and carry their controls; an admin gets them on shared rows
 * too.
 *
 * Searched, filtered and paged by the API, never over the whole library in
 * the browser (~800 movements). The filters live in the URL, so a filtered
 * view can be linked and survives a reload.
 *
 * Retired movements are not in the search -- nothing offers a retired
 * movement -- so the ones the viewer may bring back are listed below it.
 *
 * `isAdmin` decides what is rendered and nothing else. Every admin route is
 * guarded by the API on its own (DN-92), so a client that got this wrong would
 * produce a 403, not an unauthorised write.
 */
export function LibraryPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const [editing, setEditing] = useState<Editing>({ kind: "none" });
  const [serverError, setServerError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(() =>
    SELECT_FILTERS.some((key) => filters[key] !== null),
  );

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const query = searchQuery(filters);
  const {
    data: results,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["librarySearch", query],
    queryFn: () => api.searchExercises(query),
    // The last page stays up while the next loads, so typing in the search
    // box does not blank the list on every keystroke.
    placeholderData: keepPreviousData,
  });
  const { data: retired = [] } = useQuery({
    queryKey: ["retiredExercises"],
    queryFn: api.retiredExercises,
  });
  // The form's alternative picker needs the whole pool; read only while a
  // form is open, so browsing never loads the library entire.
  const { data: pool } = useQuery({
    queryKey: ["exercises"],
    queryFn: api.exercises,
    enabled: editing.kind !== "none",
  });

  /** Writes `changes` to the URL, back to the first page unless it is the page. */
  function update(changes: Partial<LibraryFilters>) {
    const next = { ...filters, page: 1, ...changes };
    setParams(writeFilters(next), { replace: true });
  }

  function close() {
    setEditing({ kind: "none" });
    setServerError(null);
  }

  // Every write invalidates every list: `exercises` is the pool the rest of
  // the app plans from, and a movement retired here has to leave it.
  const mutationOptions = {
    onSuccess: async () => {
      close();
      await Promise.all(
        ["librarySearch", "retiredExercises", "exercises", "exercise"].map(
          (key) => queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
    onError: (err: unknown) => {
      setServerError(
        err instanceof ApiError ? err.message : "Couldn't reach the API.",
      );
    },
  };

  const create = useMutation({
    mutationFn: ({ tier, body }: { tier: LibraryTier; body: CreateExercise }) =>
      api.createExercise(tier, body),
    ...mutationOptions,
  });
  const updateExercise = useMutation({
    mutationFn: ({
      tier,
      id,
      body,
    }: {
      tier: LibraryTier;
      id: string;
      body: CreateExercise;
    }) => api.updateExercise(tier, id, body),
    ...mutationOptions,
  });
  const archive = useMutation({
    mutationFn: ({ tier, id }: { tier: LibraryTier; id: string }) =>
      api.archiveExercise(tier, id),
    ...mutationOptions,
  });
  const unarchive = useMutation({
    mutationFn: ({ tier, id }: { tier: LibraryTier; id: string }) =>
      api.unarchiveExercise(tier, id),
    ...mutationOptions,
  });

  const isAdmin = me?.isAdmin === true;
  const tierOf = (e: ApiExercise): LibraryTier =>
    e.ownerId === null ? "global" : "own";
  // A shared row with a key is the library files' (ADR 0010): the API
  // refuses to change it, so an admin is shown where to change it instead.
  const isSeeded = (e: ApiExercise) => e.ownerId === null && e.key !== null;
  const canEdit = (e: ApiExercise) =>
    e.ownerId !== null || (isAdmin && !isSeeded(e));
  const busy =
    archive.isPending ||
    unarchive.isPending ||
    create.isPending ||
    updateExercise.isPending;

  function form() {
    if (editing.kind === "none") return null;
    const exercise = editing.kind === "edit" ? editing.exercise : null;
    if (!pool)
      return (
        <p className="mt-3 text-[13px] text-[var(--ink-faint)]">
          Loading movements…
        </p>
      );
    return (
      <ExerciseForm
        // Remounted per target, so opening a second row doesn't inherit the
        // first row's half-finished edits from the form's own state.
        key={exercise?.id ?? `new-${editing.tier}`}
        tier={editing.tier}
        selfId={exercise?.id ?? null}
        initial={exercise ? toDraft(exercise) : EMPTY_DRAFT}
        alternatives={alternativesFor(pool, editing.tier, exercise?.id ?? null)}
        saving={create.isPending || updateExercise.isPending}
        serverError={serverError}
        submitLabel={exercise ? "Save" : "Add movement"}
        onSubmit={(body) => {
          setServerError(null);
          if (exercise)
            updateExercise.mutate({ tier: editing.tier, id: exercise.id, body });
          else create.mutate({ tier: editing.tier, body });
        }}
        onCancel={close}
      />
    );
  }

  function addButton(tier: LibraryTier) {
    return (
      <button
        type="button"
        onClick={() => {
          setServerError(null);
          setEditing({ kind: "create", tier });
        }}
        className="mt-3 w-full py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em]"
        style={{
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          color: "var(--glow)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {tier === "own" ? "Add your own movement" : "Add a shared movement"}
      </button>
    );
  }

  function rows(list: ApiExercise[], label: string) {
    return (
      <ul
        // Named, so the two lists are told apart by what they are rather than
        // by where they sit on the page.
        aria-label={label}
        className="mt-3"
        style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
      >
        {list.map((exercise) => (
          <ExerciseRow
            key={exercise.id}
            exercise={exercise}
            search={location.search}
            editable={canEdit(exercise)}
            seeded={isAdmin && isSeeded(exercise)}
            busy={busy}
            onEdit={() => {
              setServerError(null);
              setEditing({ kind: "edit", tier: tierOf(exercise), exercise });
            }}
            onArchive={() =>
              archive.mutate({ tier: tierOf(exercise), id: exercise.id })
            }
            onUnarchive={() =>
              unarchive.mutate({ tier: tierOf(exercise), id: exercise.id })
            }
          />
        ))}
      </ul>
    );
  }

  const activeFilters = SELECT_FILTERS.filter((key) => filters[key] !== null).length;
  const retiredHere = retired.filter(canEdit);

  return (
    <div className="p-6">
      <h1
        className="text-3xl font-extrabold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        Library
      </h1>
      <LibraryNav />
      <p className="mt-4 text-[13px] text-[var(--ink-faint)]">
        Every movement the app can program for you. Retiring one keeps the
        workouts you've already logged and takes it out of future ones.
      </p>

      {editing.kind === "none" && (
        <>
          {addButton("own")}
          {isAdmin && addButton("global")}
        </>
      )}
      {isAdmin && (
        <p className="mt-2 text-[12px] text-[var(--ink-faint)]">
          Shared movements are everyone's. What you change there, every athlete gets.
        </p>
      )}
      {form()}

      <SectionLabel>MOVEMENTS</SectionLabel>
      <div className="mt-3">
        <label
          htmlFor="library-search"
          className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Search movements
        </label>
        <input
          id="library-search"
          type="search"
          className={control}
          style={controlStyle}
          value={params.get("q") ?? ""}
          placeholder="Name"
          onChange={(e) => update({ q: e.target.value })}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] text-[var(--ink-soft)]">
          <input
            type="checkbox"
            checked={filters.owned}
            onChange={(e) => update({ owned: e.target.checked })}
          />
          Only what I own
        </label>
        <button
          type="button"
          onClick={() => setFiltersOpen(!filtersOpen)}
          aria-expanded={filtersOpen}
          aria-controls="library-filters"
          className="shrink-0 px-2 py-1 text-[11px] uppercase tracking-[0.14em]"
          style={quietButton}
        >
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ""} {filtersOpen ? "▾" : "▸"}
        </button>
      </div>

      {filtersOpen && (
        <div id="library-filters" className="mt-3 grid grid-cols-2 gap-3">
          {SELECT_FILTERS.map((key) => (
            <div key={key} className="min-w-0">
              <label
                htmlFor={`library-filter-${key}`}
                className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {FILTER_LABELS[key].label}
              </label>
              <select
                id={`library-filter-${key}`}
                className={control}
                style={controlStyle}
                value={filters[key] ?? ""}
                onChange={(e) => update({ [key]: e.target.value || null })}
              >
                <option value="">{FILTER_LABELS[key].any}</option>
                {FILTER_VALUES[key].map((value) => (
                  <option key={value} value={value}>
                    {optionLabel(key, value)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {isFiltered(filters) && (
        <button
          type="button"
          onClick={() =>
            update({
              q: "",
              muscle: null,
              equipment: null,
              category: null,
              level: null,
              pattern: null,
            })
          }
          className="mt-3 px-2 py-1 text-[11px] uppercase tracking-[0.14em]"
          style={quietButton}
        >
          Clear filters
        </button>
      )}

      {isLoading ? (
        <p className="mt-4 text-[13px] text-[var(--ink-faint)]">Loading movements…</p>
      ) : error || !results ? (
        <p className="mt-4 text-[13px] text-[var(--danger)]">
          Couldn't reach the API — is it running on :3001?
        </p>
      ) : results.total === 0 ? (
        <p className="mt-4 text-[13px] text-[var(--ink-faint)]">
          {filters.owned
            ? "No movements match with the equipment you own. Turn off “Only what I own” to see the rest."
            : "No movements match."}
        </p>
      ) : (
        <>
          <p
            className="mt-4 text-[11px] text-[var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono)" }}
            aria-live="polite"
          >
            {results.items.length === 0
              ? `Nothing on page ${results.page} — ${results.total} in all`
              : `${(results.page - 1) * results.pageSize + 1}–${
                  (results.page - 1) * results.pageSize + results.items.length
                } of ${results.total}`}
          </p>
          {results.items.length > 0 && rows(results.items, "Movements")}
          <Pager
            page={results.page}
            last={Math.max(1, Math.ceil(results.total / results.pageSize))}
            onPage={(page) => update({ page })}
          />
        </>
      )}

      {retiredHere.length > 0 && (
        <>
          <SectionLabel>RETIRED</SectionLabel>
          <p className="mt-2 text-[12px] text-[var(--ink-faint)]">
            Out of every workout from now on. Bring one back to use it again.
          </p>
          {rows(retiredHere, "Retired movements")}
        </>
      )}

      <DatasetCredit />
    </div>
  );
}

function Pager({
  page,
  last,
  onPage,
}: {
  page: number;
  last: number;
  onPage: (page: number) => void;
}) {
  if (last <= 1 && page <= 1) return null;
  const button = "flex-1 py-2 text-[11px] uppercase tracking-[0.14em] disabled:opacity-40";
  return (
    <nav aria-label="Pages" className="mt-3 flex gap-3">
      <button
        type="button"
        className={button}
        style={quietButton}
        disabled={page <= 1}
        onClick={() => onPage(Math.min(page - 1, last))}
      >
        ← Previous
      </button>
      <button
        type="button"
        className={button}
        style={quietButton}
        disabled={page >= last}
        onClick={() => onPage(page + 1)}
      >
        Next →
      </button>
    </nav>
  );
}
