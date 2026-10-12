import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { RoutineSummary } from "@regimen-works/shared";
import { ApiError, api } from "../lib/api";
import { LibraryNav } from "../components/LibraryNav";
import { SectionLabel } from "../components/Panel";
import { WEEKDAYS } from "../lib/weekdays";

/**
 * "My routines" (DN-145): what this athlete has written, live first and
 * archived after. The curated programs are not listed -- they are not yours
 * -- and the setup picker is where every program you can run is offered.
 *
 * "Remove" archives and "Restore" brings back (DN-147). Nothing is deleted:
 * a removed routine keeps every run on it, including one under way.
 */
export function RoutinesPage() {
  const queryClient = useQueryClient();
  const { data: routines, isLoading, error } = useQuery({
    queryKey: ["routines"],
    queryFn: api.routines,
  });
  // What the last remove or restore did, said once beneath the button.
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const settled = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["routines"] }),
      queryClient.invalidateQueries({ queryKey: ["routine"] }),
      queryClient.invalidateQueries({ queryKey: ["setup"] }),
    ]);
  };
  const remove = useMutation({
    mutationFn: api.archiveRoutine,
    onMutate: () => {
      setNotice(null);
      setFailure(null);
    },
    onSuccess: async ({ routine, running }) => {
      setNotice(
        running
          ? `Removed ${routine.name}. Your run of it carries on to its end; it just won't be offered again.`
          : `Removed ${routine.name}. Restore it below if you want it back.`,
      );
      await settled();
    },
    onError: (e) => setFailure(messageOf(e, "Couldn't remove the routine.")),
  });
  const restore = useMutation({
    mutationFn: api.restoreRoutine,
    onMutate: () => {
      setNotice(null);
      setFailure(null);
    },
    onSuccess: async (routine) => {
      setNotice(`Restored ${routine.name}.`);
      await settled();
    },
    onError: (e, id) => {
      const name = routines?.find((r) => r.id === id)?.name;
      setFailure(
        e instanceof ApiError && e.status === 409 && name
          ? `Another of your routines is called ${name} now. Rename that one first, then restore this.`
          : messageOf(e, "Couldn't restore the routine."),
      );
    },
  });
  const busy = remove.isPending || restore.isPending;

  const live = routines?.filter((r) => !r.archived) ?? [];
  const archived = routines?.filter((r) => r.archived) ?? [];

  return (
    <div className="p-6">
      <h1
        className="text-3xl font-extrabold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        Library
      </h1>
      <LibraryNav />

      <Link
        to="/library/routines/new"
        className="mt-5 block w-full py-3 text-center text-sm font-semibold uppercase tracking-[0.1em]"
        style={{
          fontFamily: "var(--font-mono)",
          border: "1px solid var(--glow)",
          color: "var(--glow)",
        }}
      >
        + New routine
      </Link>

      {error && (
        <p className="mt-4 text-sm text-[var(--danger)]">
          Couldn't load your routines.
        </p>
      )}
      {notice && (
        <p className="mt-4 text-sm text-[var(--ink-soft)]" role="status">
          {notice}
        </p>
      )}
      {failure && (
        <p className="mt-4 text-sm text-[var(--danger)]" role="alert">
          {failure}
        </p>
      )}
      {!isLoading && routines?.length === 0 && (
        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          Nothing yet. A routine is one week of training that repeats — write
          the days you train and what you do on them.
        </p>
      )}
      {live.length > 0 && (
        <RoutineList>
          {live.map((routine) => (
            <RoutineRow key={routine.id} routine={routine}>
              <Link
                to={`/library/routines/${routine.id}/edit`}
                aria-label={`Edit ${routine.name}`}
              >
                Edit
              </Link>
              <button
                type="button"
                aria-label={`Remove ${routine.name}`}
                disabled={busy}
                className="uppercase disabled:opacity-50"
                onClick={() => remove.mutate(routine.id)}
              >
                Remove
              </button>
            </RoutineRow>
          ))}
        </RoutineList>
      )}

      {archived.length > 0 && (
        <>
          <SectionLabel>ARCHIVED</SectionLabel>
          <RoutineList>
            {archived.map((routine) => (
              <RoutineRow key={routine.id} routine={routine}>
                <button
                  type="button"
                  aria-label={`Restore ${routine.name}`}
                  disabled={busy}
                  className="uppercase disabled:opacity-50"
                  onClick={() => restore.mutate(routine.id)}
                >
                  Restore
                </button>
              </RoutineRow>
            ))}
          </RoutineList>
        </>
      )}
    </div>
  );
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function RoutineList({ children }: { children: ReactNode }) {
  return (
    <ul
      className="mt-3"
      style={{ border: "1px solid var(--border)", background: "var(--panel)" }}
    >
      {children}
    </ul>
  );
}

function RoutineRow({
  routine,
  children,
}: {
  routine: RoutineSummary;
  children: ReactNode;
}) {
  const days =
    routine.scheduleMode === "flexible"
      ? `Any ${routine.days.length} day${routine.days.length === 1 ? "" : "s"} a week`
      : WEEKDAYS.filter((d) => routine.days.includes(d.value))
          .map((d) => d.short)
          .join(" · ");
  return (
    <li
      className="px-4 py-3"
      style={{
        borderTop: "1px solid var(--border)",
        opacity: routine.archived ? 0.7 : 1,
      }}
    >
      <span
        className="block font-semibold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        {routine.name}
      </span>
      <span className="mt-1 block text-sm text-[var(--ink-soft)]">
        {routine.summary}
      </span>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span
          className="text-[11px] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {days}
        </span>
        <span
          className="flex shrink-0 gap-4 text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {children}
        </span>
      </div>
    </li>
  );
}
