import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { RoutineSummary } from "@regimen-works/shared";
import { api } from "../lib/api";
import { LibraryNav } from "../components/LibraryNav";
import { WEEKDAYS } from "../lib/weekdays";

/**
 * "My routines" (DN-145): what this athlete has written, live first and
 * archived after. The curated programs are not listed -- they are not yours
 * -- and the setup picker is where every program you can run is offered.
 */
export function RoutinesPage() {
  const { data: routines, isLoading, error } = useQuery({
    queryKey: ["routines"],
    queryFn: api.routines,
  });

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
      {!isLoading && routines?.length === 0 && (
        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          Nothing yet. A routine is one week of training that repeats — write
          the days you train and what you do on them.
        </p>
      )}
      {routines && routines.length > 0 && (
        <ul
          className="mt-5"
          style={{ border: "1px solid var(--border)", background: "var(--panel)" }}
        >
          {routines.map((routine) => (
            <RoutineRow key={routine.id} routine={routine} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RoutineRow({ routine }: { routine: RoutineSummary }) {
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
        opacity: routine.archived ? 0.55 : 1,
      }}
    >
      <span
        className="block font-semibold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        {routine.name}
        {routine.archived && (
          <span
            className="ml-2 text-[10px] tracking-[0.14em] text-[var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            ARCHIVED
          </span>
        )}
      </span>
      <span className="mt-1 block text-sm text-[var(--ink-soft)]">
        {routine.summary}
      </span>
      <span
        className="mt-1 block text-[11px] text-[var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {days}
      </span>
    </li>
  );
}
