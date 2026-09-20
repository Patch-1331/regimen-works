import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { CompletedProgram } from "@regimen-works/shared";
import { api } from "../lib/api";
import { summaryText } from "../lib/program-summary";
import { formatResult } from "../lib/stats";

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function HistoryPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["logs"], queryFn: api.logs });
  // Its own query rather than a field on the logs response: a finished program
  // is a different kind of record from a logged workout, and the list is empty
  // for almost every athlete almost all the time. Not gated on `isLoading`
  // below, so a slow logs request does not hold up the shorter list.
  const { data: completed } = useQuery({
    queryKey: ["completed-programs"],
    queryFn: api.completedPrograms,
  });

  if (isLoading) return <p className="p-6 text-[var(--ink-faint)]">Loading history…</p>;
  if (error) return <p className="p-6 text-[var(--danger)]">Couldn't reach the API — is it running on :3001?</p>;

  return (
    <div className="p-6">
      <h1 className="text-3xl font-extrabold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        History
      </h1>

      {completed && completed.length > 0 && <CompletedPrograms programs={completed} />}

      {!data || data.length === 0 ? (
        <p className="mt-3 text-[var(--ink-faint)]">
          Logged workouts will show up here once you finish and save your first WOD.
        </p>
      ) : (
        <div className="mt-5 divide-y" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderColor: "var(--border)" }}>
          {data.map((log) => (
            <button
              key={log.id}
              onClick={() => navigate(`/log/${log.assignmentId}`)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-[0.12em] text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
                  {formatDate(log.date)}
                </p>
                <p className="truncate font-semibold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
                  {log.name}
                </p>
                {log.notes && <p className="mt-0.5 truncate text-sm text-[var(--ink-soft)]">{log.notes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {log.rpe !== null && (
                  <span
                    className="px-2 py-1 text-xs font-semibold"
                    style={{ background: "var(--glow-tint)", color: "var(--glow)", fontFamily: "var(--font-mono)" }}
                  >
                    RPE {log.rpe}
                  </span>
                )}
                <span
                  className="text-lg font-bold"
                  style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--glow)", textShadow: "0 0 8px var(--glow-tint)" }}
                >
                  {formatResult(log.resultType, log.resultValue)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The programs the athlete has finished (DN-18).
 *
 * Above the workout log rather than below it, because it is the shorter list
 * and the one an athlete scrolls to History to find. Rendered only when there
 * is something in it: an empty "Programs completed" heading on the day
 * somebody installs the app is a reminder of nothing.
 *
 * Not a button. There is no program detail screen to open, and a row that
 * looks pressable and is not is worse than a row that does not.
 */
function CompletedPrograms({ programs }: { programs: CompletedProgram[] }) {
  return (
    <section className="mt-5">
      <h2
        className="text-[11px] font-bold tracking-[0.18em] text-[var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        PROGRAMS COMPLETED
      </h2>
      <div
        className="mt-2 divide-y"
        style={{ background: "var(--panel)", border: "1px solid var(--border)", borderColor: "var(--border)" }}
      >
        {programs.map((program) => (
          <div key={program.enrollmentId} className="px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <p className="text-[11px] font-semibold tracking-[0.12em] text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
              {new Date(program.completedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            <p className="truncate font-semibold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
              {program.planName}
            </p>
            <p className="mt-0.5 text-sm text-[var(--ink-soft)]">{summaryText(program)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
