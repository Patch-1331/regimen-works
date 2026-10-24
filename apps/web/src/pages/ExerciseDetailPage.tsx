import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { equipmentLabel, type Equipment, type MovementHistory } from "@regimen-works/shared";
import { ApiError, api } from "../lib/api";
import { humanize } from "../lib/libraryFilters";
import { lineLabel, patternLabel } from "../lib/progressions";
import { prescribedDayLabel, shortDate } from "../lib/movementHistory";
import { SectionLabel } from "../components/Panel";
import { DatasetCredit } from "../components/DatasetCredit";
import { ExerciseChecklists } from "../components/ChecklistEntries";

/**
 * One movement, read in full (DN-171): how to do it, what it works, what it
 * needs, and the dataset's description of it.
 *
 * No image, and no slot where one would go. The dataset's images are never
 * imported (ADR-0007), and an empty frame would say something is missing.
 *
 * The level is printed as a fact about the exercise, beside its force and
 * mechanic, and nothing on the page compares it with the athlete (ADR-0004,
 * ADR-0007).
 */
export function ExerciseDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  // The list's filters, when the athlete came from it, so "back" is the list
  // they left rather than the library from the top.
  const from = (location.state as { from?: string } | null)?.from ?? "";

  const { data: exercise, error, isLoading } = useQuery({
    queryKey: ["exercise", id],
    queryFn: () => api.exercise(id),
  });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const owned = new Set<string>(settings?.equipment ?? []);
  // Shared with Stats, which reads the same history (DN-89). An addition to
  // the page rather than part of it: nothing waits on it, and a failure here
  // leaves the movement readable.
  const { data: history } = useQuery({
    queryKey: ["movementHistory"],
    queryFn: api.movementHistory,
  });
  const trained = history?.find((movement) => movement.exerciseId === id);

  const back = (
    <Link
      to={`/library${from}`}
      className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      ← Movements
    </Link>
  );

  if (isLoading)
    return (
      <div className="p-6">
        {back}
        <p className="mt-4 text-[var(--ink-faint)]">Loading movement…</p>
      </div>
    );
  if (error || !exercise)
    return (
      <div className="p-6">
        {back}
        <p className="mt-4 text-[var(--danger)]">
          {error instanceof ApiError && error.status === 404
            ? "There's no movement here. It may have been someone else's."
            : "Couldn't reach the API — is it running on :3001?"}
        </p>
      </div>
    );

  const facts: [string, string][] = [];
  if (exercise.level) facts.push(["Level", humanize(exercise.level)]);
  if (exercise.category) facts.push(["Category", humanize(exercise.category)]);
  if (exercise.force) facts.push(["Force", humanize(exercise.force)]);
  if (exercise.mechanic) facts.push(["Mechanic", humanize(exercise.mechanic)]);
  if (exercise.pattern) facts.push(["Pattern", patternLabel(exercise.pattern)]);
  if (exercise.movementGroup) facts.push(["Group", lineLabel(exercise.movementGroup)]);
  facts.push(["Counted in", exercise.unit]);

  return (
    <div className="p-6">
      {back}
      <h1
        className="mt-3 text-3xl font-extrabold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        {exercise.name}
      </h1>
      {(exercise.ownerId !== null || exercise.archivedAt !== null) && (
        <p
          className="mt-1 text-[10px] tracking-[0.14em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {[exercise.ownerId !== null && "YOURS", exercise.archivedAt !== null && "RETIRED"]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <dl
        className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2"
        aria-label="About this movement"
      >
        {facts.map(([term, value]) => (
          <div key={term} className="min-w-0">
            <dt
              className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {term}
            </dt>
            <dd className="truncate text-[14px] text-[var(--ink)]">{value}</dd>
          </div>
        ))}
      </dl>

      <SectionLabel>MUSCLES</SectionLabel>
      {exercise.primaryMuscles.length === 0 ? (
        <Quiet>Not described.</Quiet>
      ) : (
        <dl className="mt-2 space-y-1 text-[14px]">
          <MuscleLine term="Primary" muscles={exercise.primaryMuscles} />
          {exercise.secondaryMuscles.length > 0 && (
            <MuscleLine term="Secondary" muscles={exercise.secondaryMuscles} />
          )}
        </dl>
      )}

      <SectionLabel>EQUIPMENT</SectionLabel>
      {exercise.equipment.length === 0 ? (
        <Quiet>None — bodyweight.</Quiet>
      ) : (
        <ul aria-label="Equipment needed" className="mt-2 space-y-1">
          {exercise.equipment.map((piece) => (
            <li key={piece} className="flex items-center justify-between gap-3 text-[14px]">
              <span className="text-[var(--ink)]">{equipmentLabel(piece as Equipment)}</span>
              {settings && (
                <span
                  className="shrink-0 text-[10px] tracking-[0.14em]"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: owned.has(piece) ? "var(--glow)" : "var(--ink-faint)",
                  }}
                >
                  {owned.has(piece) ? "YOU HAVE THIS" : "NOT IN YOUR EQUIPMENT"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {exercise.fallbackExercise && (
        <p className="mt-2 text-[13px] text-[var(--ink-soft)]">
          Without it:{" "}
          <Link
            to={`/library/movements/${exercise.fallbackExercise.id}`}
            state={{ from }}
            className="underline underline-offset-2"
          >
            {exercise.fallbackExercise.name}
          </Link>
        </p>
      )}

      <SectionLabel>HOW TO DO IT</SectionLabel>
      {exercise.instructions.length === 0 ? (
        <Quiet>No written instructions yet.</Quiet>
      ) : (
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-[14px] leading-relaxed text-[var(--ink-soft)]">
          {exercise.instructions.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}

      <ExerciseChecklists exercise={exercise} />

      {trained && <PrescribedDays movement={trained} />}

      {/* Only under the dataset's own rows: an athlete's movement is theirs. */}
      {exercise.key !== null && <DatasetCredit />}
    </div>
  );
}

/**
 * What each past day prescribed of this movement, newest first (DN-192), in
 * the words Today's plate used: "5 × 5", or each set with its load step where
 * they varied. A record of what was asked for -- what was done is the log's --
 * and never a weight, which the history does not hold.
 *
 * Absent rather than "never trained" for a movement with no days: a count of
 * nothing reads as a mark against the athlete for a movement they may simply
 * not have met yet.
 */
function PrescribedDays({ movement }: { movement: MovementHistory }) {
  return (
    <>
      <SectionLabel>PRESCRIBED</SectionLabel>
      <ul aria-label="Prescribed days" className="mt-2 space-y-2">
        {movement.days.map((day, i) => (
          <li key={`${day.date}-${i}`} className="flex items-baseline gap-3 text-[14px]">
            <span
              className="w-14 shrink-0 text-[11px] tracking-[0.06em] text-[var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {shortDate(day.date)}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block text-[var(--ink)]"
                style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
              >
                {prescribedDayLabel(day, movement.unit)}
              </span>
              <span className="block truncate text-[12px] text-[var(--ink-faint)]">
                {day.name}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function MuscleLine({ term, muscles }: { term: string; muscles: string[] }) {
  return (
    <div className="flex gap-3">
      <dt
        className="w-24 shrink-0 text-[10px] uppercase leading-[21px] tracking-[0.14em] text-[var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {term}
      </dt>
      <dd className="text-[var(--ink)]">{muscles.map(humanize).join(", ")}</dd>
    </div>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[13px] text-[var(--ink-faint)]">{children}</p>;
}
