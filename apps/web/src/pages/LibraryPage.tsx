import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateExercise } from "@regimen-works/shared";
import { ApiError, api, type ApiExercise, type LibraryTier } from "../lib/api";
import { ExerciseForm } from "../components/ExerciseForm";
import {
  EMPTY_DRAFT,
  alternativesFor,
  toDraft,
} from "../lib/exerciseDraft";
import { lineLabel, patternLabel } from "../lib/progressions";
import { SectionLabel } from "../components/Panel";
import { LibraryNav } from "../components/LibraryNav";

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
      : exercise.equipment.join(", "),
  );
  return parts.join(" — ");
}

function ExerciseRow({
  exercise,
  editable,
  onEdit,
  onArchive,
  onUnarchive,
  busy,
}: {
  exercise: ApiExercise;
  editable: boolean;
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
          {exercise.name}
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

/**
 * The movement library, in the two tiers it is actually stored in (DN-28).
 *
 * One page with two sections rather than two pages, because the distinction
 * between "yours" and "everyone's" is the thing an author most needs to see,
 * and a second page would hide it behind a tab. Each section carries its own
 * Add button so the tier is chosen by the act rather than by a control
 * somewhere else on the screen.
 *
 * `isAdmin` decides what is rendered and nothing else. Every admin route is
 * guarded by the API on its own (DN-92), so a client that got this wrong would
 * produce a 403, not an unauthorised write.
 */
export function LibraryPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>({ kind: "none" });
  const [serverError, setServerError] = useState<string | null>(null);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const {
    data: exercises,
    isLoading,
    error,
  } = useQuery({ queryKey: ["libraryExercises"], queryFn: api.libraryExercises });

  function close() {
    setEditing({ kind: "none" });
    setServerError(null);
  }

  // Every write invalidates both lists: `exercises` is the pool the rest of
  // the app plans from, and a movement retired here has to leave it.
  const mutationOptions = {
    onSuccess: async () => {
      close();
      await queryClient.invalidateQueries({ queryKey: ["libraryExercises"] });
      await queryClient.invalidateQueries({ queryKey: ["exercises"] });
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
  const update = useMutation({
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

  const title = (
    <h1
      className="text-3xl font-extrabold uppercase"
      style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
    >
      Library
    </h1>
  );

  if (isLoading)
    return <p className="p-6 text-[var(--ink-faint)]">Loading movements…</p>;
  if (error || !exercises)
    return (
      <p className="p-6 text-[var(--danger)]">
        Couldn't reach the API — is it running on :3001?
      </p>
    );

  const isAdmin = me?.isAdmin === true;
  const mine = exercises.filter((e) => e.ownerId !== null);
  const shared = exercises.filter((e) => e.ownerId === null);
  const busy =
    archive.isPending ||
    unarchive.isPending ||
    create.isPending ||
    update.isPending;

  function form(tier: LibraryTier) {
    if (editing.kind === "none" || editing.tier !== tier) return null;
    const exercise = editing.kind === "edit" ? editing.exercise : null;
    return (
      <ExerciseForm
        // Remounted per target, so opening a second row doesn't inherit the
        // first row's half-finished edits from the form's own state.
        key={exercise?.id ?? `new-${tier}`}
        initial={exercise ? toDraft(exercise) : EMPTY_DRAFT}
        alternatives={alternativesFor(
          exercises ?? [],
          tier,
          exercise?.id ?? null,
        )}
        saving={create.isPending || update.isPending}
        serverError={serverError}
        submitLabel={exercise ? "Save" : "Add movement"}
        onSubmit={(body) => {
          setServerError(null);
          if (exercise) update.mutate({ tier, id: exercise.id, body });
          else create.mutate({ tier, body });
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

  function list(
    rows: ApiExercise[],
    tier: LibraryTier,
    editable: boolean,
    label: string,
  ) {
    if (rows.length === 0)
      return (
        <p className="mt-3 text-[13px] text-[var(--ink-faint)]">
          Nothing here yet.
        </p>
      );
    return (
      <ul
        // Named, so the two lists are told apart by what they are rather than
        // by where they sit on the page.
        aria-label={label}
        className="mt-3"
        style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
      >
        {rows.map((exercise) => (
          <ExerciseRow
            key={exercise.id}
            exercise={exercise}
            editable={editable}
            busy={busy}
            onEdit={() => {
              setServerError(null);
              setEditing({ kind: "edit", tier, exercise });
            }}
            onArchive={() => archive.mutate({ tier, id: exercise.id })}
            onUnarchive={() => unarchive.mutate({ tier, id: exercise.id })}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="p-6">
      {title}
      <LibraryNav />
      <p className="mt-4 text-[13px] text-[var(--ink-faint)]">
        Every movement the app can program for you. Retiring one keeps the
        workouts you've already logged and takes it out of future ones.
      </p>

      <SectionLabel>YOUR MOVEMENTS</SectionLabel>
      {list(mine, "own", true, "Your movements")}
      {form("own")}
      {editing.kind === "none" && addButton("own")}

      <SectionLabel>SHARED LIBRARY</SectionLabel>
      <p className="mt-2 text-[12px] text-[var(--ink-faint)]">
        {isAdmin
          ? "Everyone's movements. What you change here, every athlete gets."
          : "Movements everyone gets. Add your own above to change what you're given."}
      </p>
      {list(shared, "global", isAdmin, "Shared library")}
      {isAdmin && form("global")}
      {isAdmin && editing.kind === "none" && addButton("global")}
    </div>
  );
}
