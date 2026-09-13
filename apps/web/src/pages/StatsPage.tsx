import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
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
import { buildMovementChoices, lineLabel, type MovementChoice } from "../lib/progressions";
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
      <MovementChoicesPanel exercises={exercises} skillLevels={skillLevels} />
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

/**
 * What the athlete has chosen, per movement group (DN-91).
 *
 * This replaced a ladder per line marked done / current / locked. Those words
 * describe an assessment — you graduated past this, you are not allowed that
 * yet — and the app no longer makes one. What is left is what is true: the
 * movement you picked, and the rest of the group in case you want a different
 * one.
 *
 * Tappable here as well as on the plate, because this is the screen you are on
 * when you are thinking about it rather than about to train.
 */
function MovementChoicesPanel({
  exercises,
  skillLevels,
}: {
  exercises: ApiExercise[];
  skillLevels: SkillLevel[];
}) {
  const queryClient = useQueryClient();
  const [openLine, setOpenLine] = useState<string | null>(null);

  const choose = useMutation({
    mutationFn: ({ line, rung }: { line: string; rung: number }) =>
      api.setSkillLevel(line, { rung }),
    onSuccess: async () => {
      setOpenLine(null);
      await queryClient.invalidateQueries({ queryKey: ["skillLevels"] });
      // Today's plate resolves through this choice, so it has to be re-derived.
      await queryClient.invalidateQueries({ queryKey: ["today"] });
    },
  });

  const choices = buildMovementChoices(exercises, skillLevels);

  // One entry per line the athlete has chosen on, so a new athlete has none
  // (DN-86 — nobody is provisioned onto a movement any more). A bare heading
  // over nothing would read like something failed to load.
  if (choices.length === 0) {
    return (
      <>
        <SectionLabel>YOUR MOVEMENTS</SectionLabel>
        <Panel>
          <p className="text-sm leading-relaxed text-[var(--ink-faint)]">
            Nothing here yet — your workouts come exactly as written. Swap a
            movement before a session and what you picked is remembered here.
          </p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <SectionLabel>YOUR MOVEMENTS</SectionLabel>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {choices.map((choice) => (
          <MovementChoiceCard
            key={choice.line}
            choice={choice}
            open={openLine === choice.line}
            isSaving={choose.isPending}
            onToggle={() =>
              setOpenLine(openLine === choice.line ? null : choice.line)
            }
            onPick={(rung) => choose.mutate({ line: choice.line, rung })}
          />
        ))}
      </div>
    </>
  );
}

function MovementChoiceCard({
  choice,
  open,
  isSaving,
  onToggle,
  onPick,
}: {
  choice: MovementChoice;
  open: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onPick: (rung: number) => void;
}) {
  const panelId = `movement-choice-${choice.line}`;
  const label = lineLabel(choice.line);

  return (
    <div className="p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span
            className="block text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}
          >
            {label}
          </span>
          <span className="mt-1 block truncate text-sm font-bold text-[var(--ink)]">
            {/* Null only on a data gap — a stored rung with nothing seeded at
                it. Saying so beats naming the wrong movement. */}
            {choice.chosenName ?? "Not on the current library"}
          </span>
        </span>
        <span
          className="shrink-0 text-[10px] tracking-[0.1em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {open ? "CLOSE" : "CHANGE"}
        </span>
      </button>

      {open && (
        <ul id={panelId} className="mt-3 flex flex-col gap-1">
          {choice.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => onPick(option.rung)}
                disabled={isSaving || option.isChosen}
                aria-current={option.isChosen}
                className="flex w-full items-center gap-2 py-1.5 text-left"
              >
                <ChoiceMark chosen={option.isChosen} />
                <span
                  className="truncate text-xs"
                  style={{
                    color: option.isChosen ? "var(--ink)" : "var(--ink-soft)",
                    fontWeight: option.isChosen ? 700 : 400,
                  }}
                >
                  {option.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Marks the chosen movement by shape as well as colour — a filled glowing dot
 * against an empty one. Every other movement is simply unmarked: there is no
 * third state now that nothing is cleared or closed off.
 */
function ChoiceMark({ chosen }: { chosen: boolean }) {
  if (chosen) {
    return (
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: "var(--glow)", boxShadow: "0 0 6px var(--glow)" }}
      />
    );
  }
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ border: "1.5px solid var(--border)" }} />;
}
