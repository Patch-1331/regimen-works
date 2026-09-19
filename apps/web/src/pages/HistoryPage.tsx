import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
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

  if (isLoading) return <p className="p-6 text-[var(--ink-faint)]">Loading history…</p>;
  if (error) return <p className="p-6 text-[var(--danger)]">Couldn't reach the API — is it running on :3001?</p>;

  return (
    <div className="p-6">
      <h1 className="text-3xl font-extrabold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        History
      </h1>

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
