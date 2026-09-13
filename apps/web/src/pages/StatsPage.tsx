import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SkillLevel } from "@regimen-works/shared";
import { api, type ApiExercise } from "../lib/api";
import {
  computeForTimeTrends,
  computePRs,
  computePatternBalance,
  computePatternVolumeTrend,
  computeStreaks,
  computeWeeklyTrainingDays,
  computeWodTypeDistribution,
  formatResult,
} from "../lib/stats";
import { buildLadders, lineLabel } from "../lib/progressions";
import { DigitReadout } from "../components/DigitReadout";
import { PatternVolumeTrendChart } from "../components/PatternVolumeTrendChart";
import { WodTypeDistribution } from "../components/WodTypeDistribution";
import { WeeklyTrainingDaysChart } from "../components/WeeklyTrainingDaysChart";
import { ForTimeTrendCharts } from "../components/ForTimeTrendChart";

const PATTERN_LABELS: Record<string, string> = {
  squat: "Squat",
  hinge: "Hinge",
  push: "Push",
  pull: "Pull",
  core: "Core",
  carry: "Carry",
  monostructural: "Monostructural",
};

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="mt-8 text-xs font-semibold tracking-[0.14em] text-[var(--ink-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
      {children}
    </p>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
      {children}
    </div>
  );
}

export function StatsPage() {
  const { data: logs, isLoading: logsLoading, error } = useQuery({ queryKey: ["logs"], queryFn: api.logs });
  const { data: today } = useQuery({ queryKey: ["today"], queryFn: api.today });
  const { data: skillLevels } = useQuery({ queryKey: ["skillLevels"], queryFn: api.skillLevels });
  const { data: exercises } = useQuery({ queryKey: ["exercises"], queryFn: api.exercises });
  const { data: scheduleRule } = useQuery({ queryKey: ["scheduleRule"], queryFn: api.scheduleRule });

  if (logsLoading) return <p className="p-6 text-[var(--ink-faint)]">Loading stats…</p>;
  if (error) return <p className="p-6 text-[var(--danger)]">Couldn't reach the API — is it running on :3001?</p>;

  const progressions =
    skillLevels && exercises ? (
      <ProgressionsPanel exercises={exercises} skillLevels={skillLevels} todayIsoDate={today?.date ?? ""} />
    ) : null;

  if (!logs || logs.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-extrabold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
          Stats
        </h1>
        <p className="mt-3 text-[var(--ink-faint)]">
          Streaks, PRs, and pattern balance land here once you've logged a workout.
        </p>
        {progressions}
      </div>
    );
  }

  const anchorDate = today?.date ?? logs[0].date;
  const streaks = computeStreaks(logs.map((l) => l.date), anchorDate);
  const prs = computePRs(logs);
  const balance = computePatternBalance(logs);
  const maxBalance = Math.max(...balance.map((b) => b.count));
  const volumeTrend = computePatternVolumeTrend(logs);
  const typeDistribution = computeWodTypeDistribution(logs);
  const weeklyTrainingDays = computeWeeklyTrainingDays(logs.map((l) => l.date));
  const forTimeTrends = computeForTimeTrends(logs);

  return (
    <div className="p-6">
      <h1 className="text-3xl font-extrabold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        Stats
      </h1>

      <div className="mt-5 grid grid-cols-3 gap-2.5">
        <DigitReadout value={String(streaks.current)} label="Streak (days)" />
        <DigitReadout value={String(streaks.longest)} label="Longest" />
        <DigitReadout value={String(logs.length)} label="Logged" />
      </div>

      <SectionLabel>PERSONAL RECORDS</SectionLabel>
      <div className="mt-3 divide-y" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderColor: "var(--border)" }}>
        {prs.map((pr) => (
          <div key={pr.wodName} className="flex items-center justify-between px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <span className="font-semibold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
              {pr.wodName}
            </span>
            <span
              className="text-lg font-bold"
              style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--glow)", textShadow: "0 0 8px var(--glow-tint)" }}
            >
              {formatResult(pr.resultType, pr.resultValue)}
            </span>
          </div>
        ))}
      </div>

      <SectionLabel>FOR TIME TREND</SectionLabel>
      <Panel>
        <ForTimeTrendCharts trends={forTimeTrends} />
      </Panel>

      <SectionLabel>MOVEMENT PATTERN BALANCE</SectionLabel>
      <div className="mt-3 space-y-2 p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
        {balance.map((b) => (
          <div key={b.pattern} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-sm text-[var(--ink-soft)]">
              {PATTERN_LABELS[b.pattern] ?? b.pattern}
            </span>
            <div className="h-2.5 flex-1" style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}>
              <div
                className="h-full"
                style={{ width: `${(b.count / maxBalance) * 100}%`, background: "var(--glow)", boxShadow: "0 0 6px var(--glow-tint)" }}
              />
            </div>
            <span
              className="text-xs"
              style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--ink-faint)" }}
            >
              {b.count}
            </span>
          </div>
        ))}
      </div>

      <SectionLabel>PATTERN VOLUME TREND</SectionLabel>
      <Panel>
        <PatternVolumeTrendChart weeks={volumeTrend} />
      </Panel>

      <SectionLabel>WOD TYPE DISTRIBUTION</SectionLabel>
      <Panel>
        <WodTypeDistribution shares={typeDistribution} />
      </Panel>

      <SectionLabel>WEEKLY TRAINING DAYS</SectionLabel>
      <Panel>
        <WeeklyTrainingDaysChart weeks={weeklyTrainingDays} cap={scheduleRule?.maxDaysPerWeek ?? 5} />
      </Panel>

      {progressions}
    </div>
  );
}

function ProgressionsPanel({
  exercises,
  skillLevels,
  todayIsoDate,
}: {
  exercises: ApiExercise[];
  skillLevels: SkillLevel[];
  todayIsoDate: string;
}) {
  const ladders = buildLadders(exercises, skillLevels, todayIsoDate);

  // One ladder per line the athlete has chosen a movement on, so a new athlete
  // has none at all (DN-86 — nobody is provisioned onto a rung any more). The
  // heading on its own would read like something failed to load.
  if (ladders.length === 0) {
    return (
      <>
        <SectionLabel>PROGRESSIONS</SectionLabel>
        <Panel>
          <p className="text-sm leading-relaxed text-[var(--ink-faint)]">
            Nothing here yet — your workouts come as written. Swap a movement
            before a session and the ladder you picked from shows up here.
          </p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <SectionLabel>PROGRESSIONS</SectionLabel>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ladders.map((ladder) => (
          <div key={ladder.line} className="p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between gap-2">
              <span
                className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                style={{ fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}
              >
                {lineLabel(ladder.line)}
              </span>
              {ladder.justAdvancedToday && (
                <span
                  className="px-1.5 py-0.5 text-[10px] font-bold tracking-[0.1em]"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--glow)", background: "var(--glow-tint)" }}
                >
                  LEVELED UP
                </span>
              )}
            </div>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {ladder.rungs.map((r) => (
                <div key={r.rung} className="flex items-center gap-2">
                  {/* status by mark, not color alone: hollow ring = locked, filled
                      dim dot = cleared, filled glowing dot = current rung */}
                  <RungMark status={r.status} />
                  <span
                    className="text-xs"
                    style={{
                      color: r.status === "locked" ? "var(--ink-faint)" : r.status === "current" ? "var(--ink)" : "var(--ink-soft)",
                      fontWeight: r.status === "current" ? 700 : 400,
                    }}
                  >
                    {r.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function RungMark({ status }: { status: "locked" | "current" | "done" }) {
  if (status === "current") {
    return (
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: "var(--glow)", boxShadow: "0 0 6px var(--glow)" }}
      />
    );
  }
  if (status === "locked") {
    return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ border: "1.5px solid var(--border)" }} />;
  }
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--ink-faint)" }} />;
}
