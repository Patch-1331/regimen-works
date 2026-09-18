import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
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
import { patternLabel } from "../lib/progressions";
import { DigitReadout } from "../components/DigitReadout";
import { MovementChoicesPanel } from "../components/MovementChoicesPanel";
import { Panel, SectionLabel } from "../components/Panel";
import { PatternVolumeTrendChart } from "../components/PatternVolumeTrendChart";
import { WodTypeDistribution } from "../components/WodTypeDistribution";
import { WeeklyTrainingDaysChart } from "../components/WeeklyTrainingDaysChart";
import { ForTimeTrendCharts } from "../components/ForTimeTrendChart";

export function StatsPage() {
  const { data: logs, isLoading: logsLoading, error } = useQuery({ queryKey: ["logs"], queryFn: api.logs });
  const { data: today } = useQuery({ queryKey: ["today"], queryFn: api.today });
  const { data: skillLevels } = useQuery({ queryKey: ["skillLevels"], queryFn: api.skillLevels });
  const { data: exercises } = useQuery({ queryKey: ["exercises"], queryFn: api.exercises });
  const { data: scheduleRule } = useQuery({ queryKey: ["scheduleRule"], queryFn: api.scheduleRule });
  const { data: movementHistory } = useQuery({ queryKey: ["movementHistory"], queryFn: api.movementHistory });

  if (logsLoading) return <p className="p-6 text-[var(--ink-faint)]">Loading stats…</p>;
  if (error) return <p className="p-6 text-[var(--danger)]">Couldn't reach the API — is it running on :3001?</p>;

  const progressions =
    skillLevels && exercises ? (
      <MovementChoicesPanel
        exercises={exercises}
        skillLevels={skillLevels}
        history={movementHistory}
      />
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
              {patternLabel(b.pattern)}
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
