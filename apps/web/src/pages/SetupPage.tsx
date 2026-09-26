import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Me, SetupOptions, SetupProgram } from "@regimen-works/shared";
import { api } from "../lib/api";
import {
  dayCountWarning,
  formatStartDate,
  listDays,
  restPaceWarning,
  startDateChoices,
  weekdayOf,
  weeksChoice,
} from "../lib/setup";
import { parseRestDraft, restDraftOf, restSecondsOf } from "../lib/rest";
import { WEEKDAYS, localIsoDate } from "../lib/weekdays";

/**
 * The first-run wizard (DN-15): three questions, then training.
 *
 * Every answer lives here rather than in the step that asks for it, which is
 * the whole of "back navigation preserving answers" — a step is a way of
 * looking at this state, not a place it is kept. Going back and forward again
 * changes nothing, and the commit at the end is the only write.
 *
 * There is deliberately no fourth question about what the athlete can do.
 * Everyone is handed each group's default movement and changes it in one tap
 * on their first workout, which is a better first impression than a form
 * asking how many pull-ups you can do before you have done one here.
 */

const STEPS = ["welcome", "program", "cadence", "start", "ready"] as const;
type Step = (typeof STEPS)[number];

export function SetupPage() {
  const { data: options, isLoading, error } = useQuery({
    queryKey: ["setup"],
    queryFn: api.setup,
  });

  if (isLoading) {
    return <Frame>{null}</Frame>;
  }
  if (error || !options) {
    return (
      <Frame>
        <p className="text-[var(--danger)]">
          Couldn't reach the API — is it running on :3001?
        </p>
      </Frame>
    );
  }
  // Keyed remount is unnecessary — the query settles once — but the answers
  // below are seeded from `options`, so they are only sound once it is here.
  return <Wizard options={options} />;
}

function Wizard({ options }: { options: SetupOptions }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("welcome");
  const [planId, setPlanId] = useState(options.programs[0].id);
  const [days, setDays] = useState<number[]>(() =>
    initialDays(options.programs[0], options.trainingDays),
  );
  const [weeks, setWeeks] = useState<number | null>(
    () => weeksChoice(options.programs[0])?.start ?? null,
  );
  const [startDate, setStartDate] = useState(options.earliestStartDate);
  // Null until the athlete types, so the prefill can follow the program: see
  // `restPrefill`.
  const [restEdit, setRestEdit] = useState<string | null>(null);

  const program =
    options.programs.find((p) => p.id === planId) ?? options.programs[0];
  const isFixed = program.scheduleMode === "fixed";
  const restDraft = restEdit ?? restPrefill(program, options.lastRestSeconds);
  const rest = parseRestDraft(restDraft);
  const restWarning = restPaceWarning(program, rest);

  const commit = useMutation({
    mutationFn: () =>
      api.commitSetup({
        planId: program.id,
        // Null for a fixed program, whose days are not the athlete's to
        // choose — the API refuses days here rather than ignoring them.
        trainingDays: isFixed ? null : days,
        weeks,
        startDate,
        // Only where there is a rest between sets to pace -- a pace on Just
        // WODs would be stored and never read.
        defaultRestSeconds: program.hasStraightSets ? restSecondsOf(rest) : null,
      }),
    onSuccess: async ({ onboardedAt }) => {
      // Written straight into the cache the route guard reads, so the
      // redirect back into the app does not race a refetch of the very field
      // that decides whether the athlete is allowed to leave this screen.
      queryClient.setQueryData(["me"], (previous: Me | undefined) =>
        previous ? { ...previous, onboardedAt } : previous,
      );
      // Setup changes the program, the week and the day being trained, which
      // is most of what the app has cached. Everything, rather than a list
      // that would need an entry adding every time a screen is built.
      await queryClient.invalidateQueries();
      navigate("/", { replace: true });
    },
  });

  /**
   * Picking a program re-seeds the answers that belong to *it* — its
   * suggested days, its length — because those are the program's opinion and
   * not the athlete's yet. Picking the same program again changes nothing, so
   * stepping back to look at the list does not undo the days just chosen.
   */
  function chooseProgram(next: SetupProgram) {
    if (next.id !== planId) {
      setPlanId(next.id);
      setDays(initialDays(next, options.trainingDays));
      setWeeks(weeksChoice(next)?.start ?? null);
    }
    setStep("cadence");
  }

  const warning = dayCountWarning(program, days);

  return (
    <Frame>
      {step === "welcome" && <Welcome onBegin={() => setStep("program")} />}

      {step === "program" && (
        <ProgramStep
          programs={options.programs}
          chosenId={planId}
          onChoose={chooseProgram}
          onBack={() => setStep("welcome")}
        />
      )}

      {step === "cadence" && (
        <CadenceStep
          program={program}
          days={days}
          weeks={weeks}
          warning={warning}
          onToggleDay={(day) =>
            setDays((current) =>
              current.includes(day)
                ? current.filter((d) => d !== day)
                : [...current, day].sort((a, b) => a - b),
            )
          }
          onWeeks={setWeeks}
          onBack={() => setStep("program")}
          onNext={() => setStep("start")}
        />
      )}

      {step === "start" && (
        <StartDateStep
          options={options}
          chosen={startDate}
          onChoose={setStartDate}
          onBack={() => setStep("cadence")}
          onNext={() => setStep("ready")}
        />
      )}

      {step === "ready" && (
        <ReadyStep
          program={program}
          days={isFixed ? program.fixedDays : days}
          weeks={weeks}
          startDate={startDate}
          restDraft={restDraft}
          restWarning={restWarning}
          onRest={setRestEdit}
          pending={commit.isPending}
          error={commit.error?.message ?? null}
          onBack={() => setStep("start")}
          onGo={() => commit.mutate()}
        />
      )}
    </Frame>
  );
}

/**
 * What the rest field holds before the athlete touches it (DN-143).
 *
 * Their last pace, but only where the program needs one. Where it states every
 * rest itself, a prefilled pace would quietly replace the author's numbers on
 * a screen the athlete may tap straight through -- the pace overrides
 * everything, so it should only ever be one they chose for this run.
 */
function restPrefill(program: SetupProgram, last: number | null): string {
  return program.restPaceRequired ? restDraftOf(last) : "";
}

/**
 * Where the day picker starts for a newly chosen program.
 *
 * The program's suggestion where it has one, and otherwise the days the
 * athlete already trains — which for someone returning to an abandoned setup
 * is the days they picked last time. A fixed program has no answer here and
 * its slots are shown instead, so what this returns is never read.
 */
function initialDays(program: SetupProgram, stored: number[]): number[] {
  return program.defaultDays.length > 0 ? [...program.defaultDays] : [...stored];
}

/** The wizard's own chrome: no tab bar, because there is nowhere else to be. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-[var(--bg)] p-6">
      {children}
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h1
      className="text-3xl font-extrabold uppercase"
      style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
    >
      {children}
    </h1>
  );
}

function Lede({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm text-[var(--ink-soft)]">{children}</p>;
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-6 w-full px-4 py-3 text-sm font-semibold uppercase tracking-[0.1em] disabled:opacity-50"
      style={{
        background: "var(--glow)",
        color: "var(--panel)",
        fontFamily: "var(--font-display)",
      }}
    >
      {children}
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 w-full px-4 py-2 text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)]"
      style={{ fontFamily: "var(--font-display)" }}
    >
      Back
    </button>
  );
}

function Welcome({ onBegin }: { onBegin: () => void }) {
  return (
    <div>
      <Title>Let's set up your training</Title>
      <Lede>
        Three questions and you're training. We don't ask what you can do —
        you'll set that yourself on your first workout, one tap per movement.
      </Lede>
      <ol
        className="mt-6 flex flex-col gap-2 p-4 text-sm"
        style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
      >
        <li className="text-[var(--ink-soft)]">01 — Your program</li>
        <li className="text-[var(--ink-soft)]">02 — Training days</li>
        <li className="text-[var(--ink-soft)]">03 — Start date</li>
      </ol>
      <PrimaryButton onClick={onBegin}>Begin</PrimaryButton>
    </div>
  );
}

function ProgramStep({
  programs,
  chosenId,
  onChoose,
  onBack,
}: {
  programs: SetupProgram[];
  chosenId: string;
  onChoose: (program: SetupProgram) => void;
  onBack: () => void;
}) {
  return (
    <div>
      <Title>Pick your program</Title>
      <Lede>
        A program decides what each training day is. You can change it later.
      </Lede>

      <ul className="mt-5 flex flex-col gap-3">
        {programs.map((program, index) => (
          <li key={program.id}>
            <button
              type="button"
              onClick={() => onChoose(program)}
              aria-pressed={program.id === chosenId}
              className="w-full p-4 text-left"
              style={{
                background: "var(--panel)",
                border: `1px solid ${program.id === chosenId ? "var(--glow)" : "var(--border)"}`,
              }}
            >
              <span
                className="block font-semibold uppercase"
                style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
              >
                {program.name}
              </span>
              <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                {programMeta(program)}
              </span>
              <span className="mt-2 block text-sm text-[var(--ink-soft)]">
                {program.summary}
              </span>
              {/* The first program is the one the athlete is already on, and
                  the honest recommendation for anyone unsure — said out loud
                  rather than implied by being at the top. */}
              {index === 0 && (
                <span className="mt-2 block text-[11px] uppercase tracking-[0.1em] text-[var(--glow)]">
                  Recommended if you're not sure
                </span>
              )}
            </button>
          </li>
        ))}
        <li>
          {/* The Program Editor is its own project. Shown disabled rather
              than hidden, because "you could build your own" is a true thing
              about this app and a first-run screen is where an athlete forms
              their idea of what it does. */}
          <div
            className="w-full p-4 opacity-50"
            style={{ background: "var(--panel)", border: "1px dashed var(--border)" }}
          >
            <span
              className="block font-semibold uppercase"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
            >
              Build your own
            </span>
            <span className="mt-2 block text-sm text-[var(--ink-soft)]">
              Write your own weeks, day by day. Coming soon.
            </span>
          </div>
        </li>
      </ul>
      <BackButton onClick={onBack} />
    </div>
  );
}

/** The one line under a program's name: how long, and how many days. */
function programMeta(program: SetupProgram): string {
  const length =
    program.minWeeks === null || program.maxWeeks === null
      ? "Open-ended"
      : program.minWeeks === program.maxWeeks
        ? `${program.minWeeks} weeks`
        : `${program.minWeeks}–${program.maxWeeks} weeks`;
  const cadence =
    program.scheduleMode === "fixed"
      ? `Fixed schedule · ${program.fixedDays.length} days`
      : program.minDaysPerWeek === program.maxDaysPerWeek
        ? `${program.minDaysPerWeek} days a week`
        : `${program.minDaysPerWeek}–${program.maxDaysPerWeek} days a week`;
  return `${length} · ${cadence}`;
}

function CadenceStep({
  program,
  days,
  weeks,
  warning,
  onToggleDay,
  onWeeks,
  onBack,
  onNext,
}: {
  program: SetupProgram;
  days: number[];
  weeks: number | null;
  warning: string | null;
  onToggleDay: (day: number) => void;
  onWeeks: (weeks: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const isFixed = program.scheduleMode === "fixed";
  // A fixed program's days are read off the program; a flexible one's are the
  // athlete's own. The strip below renders whichever is in force, which is
  // what makes the locked case a readout rather than a second component.
  const shown = isFixed ? program.fixedDays : days;
  const lengths = weeksChoice(program);

  return (
    <div>
      <Title>{isFixed ? "Your training week" : "Which days do you train?"}</Title>
      {isFixed ? (
        <Lede>
          {program.name} trains {listDays(program.fixedDays)} — the same days
          every week. They're part of the programming rather than a starting
          point, so they stay put while it runs.
        </Lede>
      ) : (
        <Lede>Tap the days you can train. You can change these later.</Lede>
      )}

      <ul className="mt-5 flex flex-wrap gap-2">
        {WEEKDAYS.map((day) => {
          const on = shown.includes(day.value);
          return (
            <li key={day.value}>
              <button
                type="button"
                // The full day name, because "Mon" read aloud on its own is an
                // abbreviation the listener has to expand.
                aria-label={day.full}
                aria-pressed={on}
                disabled={isFixed}
                onClick={() => onToggleDay(day.value)}
                className="flex h-10 w-12 items-center justify-center text-[12px] font-semibold uppercase tracking-[0.1em]"
                style={{
                  background: on ? "var(--glow)" : "var(--panel-2)",
                  border: "1px solid var(--border)",
                  color: on ? "var(--panel)" : "var(--ink-soft)",
                  fontFamily: "var(--font-mono)",
                  opacity: isFixed && !on ? 0.4 : 1,
                }}
              >
                {day.short}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Derived, never a second control: the count is what the athlete
          thinks in, and a field of its own could disagree with the days
          (DN-12). */}
      <p className="mt-4 text-sm text-[var(--ink-soft)]">
        Days per week: <strong>{shown.length}</strong>
      </p>

      {isFixed && (
        <p className="mt-1 text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)]">
          Set by {program.name}
        </p>
      )}

      {/* The author's own reason for the layout (DN-124). Shown here, where
          the locked picker first appears, because a disabled control with no
          reason beside it reads as something taken away — and the reason is
          the difference between a rule and a piece of programming. Most
          programs have nothing to say and show nothing. */}
      {program.scheduleNote && (
        <p
          className="mt-3 p-3 text-sm text-[var(--ink-soft)]"
          style={{
            background: "var(--panel)",
            borderLeft: "2px solid var(--glow)",
          }}
        >
          {program.scheduleNote}
        </p>
      )}

      {/* What picking fewer days than the program can run actually costs
          (DN-128). Only below the maximum, and only once the count is one the
          program will accept -- two messages about the same picker, one of
          them a warning, is a screen arguing with itself. */}
      {!isFixed &&
        warning === null &&
        program.maxDaysPerWeek !== null &&
        days.length < program.maxDaysPerWeek && (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            At {days.length} days you get {program.name}'s main sessions — it
            gives its lighter days away first.
          </p>
        )}

      {warning && (
        <p className="mt-3 text-sm text-[var(--danger)]" role="status">
          {warning}
        </p>
      )}

      {lengths && weeks !== null && (
        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)]">
            How long
          </p>
          <div className="mt-2 flex items-center gap-4">
            <StepperButton
              label="Fewer weeks"
              disabled={weeks <= lengths.min}
              onClick={() => onWeeks(weeks - 1)}
            >
              −
            </StepperButton>
            <span
              className="text-2xl font-semibold"
              style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}
            >
              {weeks} weeks
            </span>
            <StepperButton
              label="More weeks"
              disabled={weeks >= lengths.max}
              onClick={() => onWeeks(weeks + 1)}
            >
              +
            </StepperButton>
          </div>
          <p className="mt-2 text-xs text-[var(--ink-faint)]">
            {weeks === program.defaultWeeks
              ? `${program.name} is written as ${weeks} weeks.`
              : `${program.name} is written as ${program.defaultWeeks} weeks — ${weeks} repeats or trims the middle block.`}
          </p>
        </div>
      )}

      <PrimaryButton onClick={onNext} disabled={warning !== null}>
        Continue
      </PrimaryButton>
      <BackButton onClick={onBack} />
    </div>
  );
}

function StepperButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center text-lg disabled:opacity-40"
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        color: "var(--ink)",
      }}
    >
      {children}
    </button>
  );
}

function StartDateStep({
  options,
  chosen,
  onChoose,
  onBack,
  onNext,
}: {
  options: SetupOptions;
  chosen: string;
  onChoose: (date: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const dates = startDateChoices(
    options.earliestStartDate,
    options.latestStartDate,
  );
  const today = localIsoDate();
  // The API decides this, not the client: it moves to tomorrow the moment
  // today has been trained, because committing a start of today discards
  // today's assignment.
  const todayIsSpokenFor = options.earliestStartDate > today;

  return (
    <div>
      <Title>When do you start?</Title>
      <Lede>
        {todayIsSpokenFor
          ? "Today's already under way, so the earliest start is tomorrow."
          : "Start today and this morning's workout becomes day 1."}
      </Lede>

      <ul className="mt-5 grid grid-cols-7 gap-1">
        {dates.map((date) => {
          const isChosen = date === chosen;
          // Mondays marked, because a week that starts on one is the unit
          // every program is written in — an athlete scanning for "next
          // Monday" should not have to count.
          const isMonday = weekdayOf(date) === 1;
          return (
            <li key={date}>
              <button
                type="button"
                aria-label={formatStartDate(date)}
                aria-pressed={isChosen}
                onClick={() => onChoose(date)}
                className="flex h-10 w-full items-center justify-center text-[12px]"
                style={{
                  background: isChosen ? "var(--glow)" : "var(--panel-2)",
                  border: "1px solid var(--border)",
                  color: isChosen ? "var(--panel)" : "var(--ink-soft)",
                  fontFamily: "var(--font-mono)",
                  textDecoration: isMonday ? "underline" : "none",
                }}
              >
                {Number(date.slice(8))}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
        Mondays are underlined.
      </p>

      <p className="mt-4 text-sm text-[var(--ink-soft)]">
        {chosen === today
          ? "Starting today — this morning's workout becomes day 1."
          : `Starting ${formatStartDate(chosen)}. Until then, Just WODs fills the gap.`}
      </p>

      <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
      <BackButton onClick={onBack} />
    </div>
  );
}

function ReadyStep({
  program,
  days,
  weeks,
  startDate,
  restDraft,
  restWarning,
  onRest,
  pending,
  error,
  onBack,
  onGo,
}: {
  program: SetupProgram;
  days: number[];
  weeks: number | null;
  startDate: string;
  restDraft: string;
  restWarning: string | null;
  onRest: (draft: string) => void;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onGo: () => void;
}) {
  return (
    <div>
      <Title>You're ready</Title>
      <Lede>
        Every movement starts on a default. Change any of them with one tap on
        your first workout.
      </Lede>

      <dl
        className="mt-5 flex flex-col gap-2 p-4 text-sm"
        style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
      >
        <Readout label="Program" value={program.name} />
        <Readout label="Days" value={listDays(days)} />
        <Readout
          label="Length"
          value={weeks === null ? "Open-ended" : `${weeks} weeks`}
        />
        <Readout label="Starts" value={formatStartDate(startDate)} />
      </dl>

      {program.scheduleMode === "fixed" && <WhileItRuns program={program} />}

      {program.hasStraightSets && (
        <RestPaceField
          program={program}
          draft={restDraft}
          warning={restWarning}
          onChange={onRest}
        />
      )}

      {error && (
        <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <PrimaryButton onClick={onGo} disabled={pending || restWarning !== null}>
        {pending ? "Saving…" : "Go to today"}
      </PrimaryButton>
      <BackButton onClick={onBack} />
    </div>
  );
}

/**
 * The two things a fixed program takes over, said before the athlete agrees
 * to it rather than when they bite (DN-124).
 *
 * Both are real losses — the day picker stops working and the rest-day makeup
 * offer never appears — and both are currently only discoverable by walking
 * into them. The last screen before the commit is where they belong: on the
 * cadence step the athlete is still choosing, and a warning beside a choice
 * they have not made yet reads as a reason not to make it.
 *
 * Written as what the program does, never as what the athlete may not do. The
 * distinction is the whole issue: "your days are locked" is a restriction,
 * and "it trains these four days and hands yours back at the end" is the same
 * fact told by someone who thinks the programming is worth having.
 */
function WhileItRuns({ program }: { program: SetupProgram }) {
  return (
    <section
      className="mt-4 p-4"
      style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
    >
      <h2 className="text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)]">
        While {program.name} runs
      </h2>
      {program.scheduleNote && (
        <p className="mt-2 text-sm text-[var(--ink)]">{program.scheduleNote}</p>
      )}
      <ul className="mt-2 flex flex-col gap-2 text-sm text-[var(--ink-soft)]">
        <li>
          It trains {listDays(program.fixedDays)}. Your own training days sit
          out the run and come back when it finishes.
        </li>
        <li>
          Rest days stay rest days — nothing will offer to move a missed
          session onto one. The gaps are as much the program as the sessions.
        </li>
      </ul>
    </section>
  );
}

/**
 * The one question about rest, asked once for the whole run (ADR 0005,
 * DN-143).
 *
 * Here rather than on a step of its own: it is a fact about how the athlete
 * trains, not about the program, and for every built-in routine it is
 * optional -- a whole screen for an optional question is a speed bump.
 */
function RestPaceField({
  program,
  draft,
  warning,
  onChange,
}: {
  program: SetupProgram;
  draft: string;
  warning: string | null;
  onChange: (draft: string) => void;
}) {
  return (
    <div className="mt-4">
      <label
        htmlFor="rest-pace"
        className="text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)]"
      >
        Rest between sets{program.restPaceRequired ? "" : " (optional)"}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <input
          id="rest-pace"
          inputMode="numeric"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={warning !== null}
          aria-describedby="rest-pace-help"
          className="w-24 px-3 py-2 text-lg"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            color: "var(--ink)",
            fontFamily: "var(--font-mono)",
          }}
        />
        <span className="text-sm text-[var(--ink-soft)]">seconds</span>
      </div>
      <p id="rest-pace-help" className="mt-2 text-xs text-[var(--ink-faint)]">
        {program.restPaceRequired
          ? `${program.name} leaves some rests to you. This one number covers every set; 0 means straight through.`
          : `Leave it blank to rest as ${program.name} is written. A number here replaces every rest in it; 0 means straight through.`}
      </p>
      {warning && (
        <p className="mt-2 text-sm text-[var(--danger)]" role="status">
          {warning}
        </p>
      )}
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--ink-faint)]">{label}</dt>
      <dd className="text-right text-[var(--ink)]">{value}</dd>
    </div>
  );
}
