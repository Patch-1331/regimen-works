import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type {
  Equipment,
  Me,
  ProgramRun,
  SetupOptions,
  SetupProgram,
} from "@regimen-works/shared";
import { EQUIPMENT_CATALOG } from "@regimen-works/shared";
import { api } from "../lib/api";
import { EquipmentChecklist } from "../components/EquipmentChecklist";
import { endsLine } from "../lib/programRuns";
import {
  KIT_PRESETS,
  SETUP_QUESTIONS,
  type SetupQuestion,
  dayCountWarning,
  formatStartDate,
  inCatalogOrder,
  listDays,
  questionNumber,
  restPaceWarning,
  startDateChoices,
  weekdayOf,
  weeksChoice,
} from "../lib/setup";
import { parseRestDraft, restDraftOf, restSecondsOf } from "../lib/rest";
import {
  type SetupDraft,
  answersLeft,
  clearDraft,
  kitLine,
  readDraft,
  writeDraft,
} from "../lib/setupDraft";
import { WEEKDAYS, localIsoDate } from "../lib/weekdays";

/**
 * The first-run wizard (DN-15): four questions, then training. Kit comes
 * first (DN-195), so nothing after it is chosen before the app knows what the
 * athlete owns; `SETUP_QUESTIONS` is the order.
 *
 * Every answer lives here rather than in the step that asks for it, which is
 * the whole of "back navigation preserving answers" — a step is a way of
 * looking at this state, not a place it is kept. Going back and forward again
 * changes nothing, and the commit at the end is the only write.
 *
 * Except to this browser (DN-198): the answers so far are kept as a draft
 * under the athlete's id, so leaving halfway and coming back offers to carry
 * on rather than starting again at Welcome. See `lib/setupDraft`.
 *
 * There is deliberately no fifth question about what the athlete can do.
 * Kit is what they have, not what they can do with it.
 * Everyone is handed each group's default movement and changes it in one tap
 * on their first workout, which is a better first impression than a form
 * asking how many pull-ups you can do before you have done one here.
 *
 * The same steps start a program from the Programs tab (DN-180, ADR 0009
 * decision 8), at `/programs/:id/start`: the program is already chosen, so it
 * opens on the days, welcome is for someone who has never been here, and the
 * kit is already set -- that start never asks for it or saves it.
 * Cancelling goes back to Programs having written nothing, and the confirm
 * step says what the start ends.
 */

type Step = "welcome" | "resume" | SetupQuestion | "ready";

/**
 * What the wizard hands the program editor on "Build your own" (DN-145), and
 * gets back from it: the program written, and the kit already answered.
 */
export interface SetupHandBack {
  programId?: string;
  kit?: Equipment[];
}

export function SetupPage() {
  // Only on `/programs/:id/start`; the first-run wizard has no id.
  const { id: startId } = useParams();
  const {
    data: options,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["setup"],
    queryFn: api.setup,
  });
  // What a start from Programs would end. Not needed before onboarding,
  // where the only run is the Just WODs one provisioning made.
  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ["programRuns"],
    queryFn: api.programRuns,
    enabled: startId !== undefined,
  });
  // Where the kit question starts: what the athlete already owns, which for a
  // new one is the default kit provisioning gave them.
  const {
    data: settings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
    enabled: startId === undefined,
  });
  // Whose draft to look for (DN-198). Already cached by the setup gate, so
  // this is never a request of its own; a `/me` that failed just means no
  // draft, and Welcome.
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    enabled: startId === undefined,
  });

  if (
    isLoading ||
    (startId !== undefined ? runsLoading : settingsLoading || meLoading)
  ) {
    return <Frame>{null}</Frame>;
  }
  if (error || settingsError || !options) {
    return (
      <Frame>
        <p className="text-[var(--danger)]">
          Couldn't reach the API — is it running on :3001?
        </p>
      </Frame>
    );
  }
  if (startId !== undefined) {
    // Archived, someone else's, or never there: nothing this athlete can
    // start, and the list it came from is the place to say so.
    if (!options.programs.some((p) => p.id === startId)) {
      return <Navigate to="/programs" replace />;
    }
    return (
      <Wizard
        options={options}
        start={{ programId: startId, current: runs?.current ?? null }}
      />
    );
  }
  // Keyed remount is unnecessary — the query settles once — but the answers
  // below are seeded from `options`, so they are only sound once it is here.
  return (
    <FirstRun
      options={options}
      owned={settings?.equipment ?? []}
      userId={me?.id}
    />
  );
}

/**
 * The first-run wizard with the draft it carries on from (DN-198).
 *
 * Read once, on arrival: from then on the wizard's own state is the answer,
 * and the draft only follows it. Start over is a fresh wizard -- a remount,
 * so every answer goes back to what a first visit would seed, with no list
 * of setters to keep in step with the state.
 */
function FirstRun({
  options,
  owned,
  userId,
}: {
  options: SetupOptions;
  owned: Equipment[];
  userId: string | undefined;
}) {
  const [draft, setDraft] = useState(() =>
    userId ? readDraft(userId, options) : null,
  );
  const [round, setRound] = useState(0);

  return (
    <Wizard
      key={round}
      options={options}
      owned={owned}
      userId={userId}
      draft={draft}
      onStartOver={() => {
        if (userId) clearDraft(userId);
        setDraft(null);
        setRound((n) => n + 1);
      }}
    />
  );
}

/** A start from the Programs tab: the program chosen, and the run it leaves. */
interface StartFromPrograms {
  programId: string;
  current: ProgramRun | null;
}

function Wizard({
  options,
  owned = [],
  start,
  userId,
  draft = null,
  onStartOver,
}: {
  options: SetupOptions;
  /** The kit the athlete has now; unread on a start from Programs. */
  owned?: Equipment[];
  start?: StartFromPrograms;
  /** Whose draft this is. Absent on a start from Programs, which keeps none. */
  userId?: string;
  /** What a first run left off with last time (DN-198). */
  draft?: SetupDraft | null;
  onStartOver?: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Back from "Build your own" (DN-145): the editor hands over the program it
  // just saved, and the wizard picks up at the picker with it chosen.
  // Cancelling the editor hands back the kit alone, and still lands on the
  // picker it left from.
  const handedBack = useLocation().state as SetupHandBack | null;
  const authored = options.programs.find(
    (p) => p.id === (start?.programId ?? handedBack?.programId),
  );
  // A hand-back is newer than any draft -- the athlete is mid-wizard, not
  // returning to it -- so the draft only counts on a plain arrival. Of it,
  // only the answered questions seed anything; the rest start as a first
  // visit would.
  const resumed = start || authored || handedBack?.kit ? null : draft;
  const has = (question: SetupQuestion) =>
    resumed !== null && resumed.answered > questionIndex(question);
  const first =
    (has("program") &&
      options.programs.find((p) => p.id === resumed?.programId)) ||
    (authored ?? options.programs[0]);

  const [step, setStep] = useState<Step>(
    start
      ? "cadence"
      : authored || handedBack?.kit
        ? "program"
        : resumed
          ? "resume"
          : "welcome",
  );
  const [kit, setKit] = useState<Equipment[]>(() =>
    inCatalogOrder(
      handedBack?.kit ?? (has("kit") ? (resumed?.kit ?? owned) : owned),
    ),
  );
  const [programId, setProgramId] = useState(first.id);
  const [days, setDays] = useState<number[]>(() =>
    has("cadence") && resumed
      ? resumed.days
      : initialDays(first, options.trainingDays),
  );
  const [weeks, setWeeks] = useState<number | null>(() =>
    has("cadence") && resumed
      ? resumed.weeks
      : (weeksChoice(first)?.start ?? null),
  );
  const [startDate, setStartDate] = useState(
    has("start") && resumed ? resumed.startDate : options.earliestStartDate,
  );
  // Null until the athlete types, so the prefill can follow the program: see
  // `restPrefill`.
  const [restEdit, setRestEdit] = useState<string | null>(
    resumed?.restEdit ?? null,
  );
  // How many questions are behind the athlete, in order (DN-198). Coming
  // back from the editor, the kit is.
  const [answered, setAnswered] = useState(
    resumed?.answered ?? (handedBack?.kit ? 1 : 0),
  );
  const answer = (question: SetupQuestion) =>
    setAnswered((n) => Math.max(n, questionIndex(question) + 1));

  // The draft follows every change, so leaving from any screen -- a closed
  // tab, a sign-out -- keeps what was answered. Nothing is kept before the
  // first answer, and a start from Programs keeps nothing at all.
  useEffect(() => {
    if (start || !userId || answered === 0) return;
    writeDraft(userId, {
      answered,
      kit,
      programId,
      days,
      weeks,
      startDate,
      restEdit,
    });
  }, [start, userId, answered, kit, programId, days, weeks, startDate, restEdit]);

  const program =
    options.programs.find((p) => p.id === programId) ?? options.programs[0];
  const isFixed = program.scheduleMode === "fixed";
  const restDraft = restEdit ?? restPrefill(program, options.lastRestSeconds);
  const rest = parseRestDraft(restDraft);
  const restWarning = restPaceWarning(program, rest);

  const commit = useMutation({
    mutationFn: async () => {
      // Saved as Settings saves it, and only here: the kit is one more answer
      // the commit carries, not a write of its own on leaving its step. A
      // start from Programs never asked, so it has nothing to say about kit.
      if (!start) await api.updateSettings({ equipment: kit });
      return api.commitSetup({
        programId: program.id,
        // Null for a fixed program, whose days are not the athlete's to
        // choose — the API refuses days here rather than ignoring them.
        trainingDays: isFixed ? null : days,
        weeks,
        startDate,
        // Only where there is a rest between sets to pace -- a pace on Just
        // WODs would be stored and never read.
        defaultRestSeconds: program.hasStraightSets
          ? restSecondsOf(rest)
          : null,
      });
    },
    onSuccess: async ({ onboardedAt }) => {
      // Finished, so there is nothing left to carry on with.
      if (!start && userId) clearDraft(userId);
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
      void navigate("/", { replace: true });
    },
  });

  /**
   * Picking a program re-seeds the answers that belong to *it* — its
   * suggested days, its length — because those are the program's opinion and
   * not the athlete's yet. Picking the same program again changes nothing, so
   * stepping back to look at the list does not undo the days just chosen.
   */
  function chooseProgram(next: SetupProgram) {
    if (next.id !== programId) {
      setProgramId(next.id);
      setDays(initialDays(next, options.trainingDays));
      setWeeks(weeksChoice(next)?.start ?? null);
      // The days now on screen are the new program's, not the athlete's, so
      // a draft saved from here counts them as still to ask.
      setAnswered(questionIndex("program") + 1);
    } else {
      answer("program");
    }
    setStep("cadence");
  }

  const warning = dayCountWarning(program, days);
  const cancel = () => navigate("/programs");

  return (
    <Frame>
      {step === "welcome" && <Welcome onBegin={() => setStep("kit")} />}

      {step === "resume" && (
        <ResumeStep
          answered={answered}
          kit={kit}
          program={program}
          days={isFixed ? program.fixedDays : days}
          weeks={weeks}
          startDate={startDate}
          onCarryOn={() =>
            setStep(SETUP_QUESTIONS[answered]?.step ?? "ready")
          }
          onStartOver={onStartOver ?? (() => setStep("welcome"))}
        />
      )}

      {step === "kit" && (
        <KitStep
          kit={kit}
          onKit={(next) => setKit(inCatalogOrder(next))}
          onBack={() => setStep("welcome")}
          onNext={() => {
            answer("kit");
            setStep("program");
          }}
        />
      )}

      {step === "program" && (
        <ProgramStep
          programs={options.programs}
          chosenId={programId}
          kit={kit}
          onChoose={chooseProgram}
          onBack={() => setStep("kit")}
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
          numbered={!start}
          // From Programs there is no picker behind this step: the program
          // was chosen there, and Cancel below goes back to it.
          onBack={start ? undefined : () => setStep("program")}
          onNext={() => {
            answer("cadence");
            setStep("start");
          }}
        />
      )}

      {step === "start" && (
        <StartDateStep
          options={options}
          chosen={startDate}
          onChoose={setStartDate}
          numbered={!start}
          onBack={() => setStep("cadence")}
          onNext={() => {
            answer("start");
            setStep("ready");
          }}
        />
      )}

      {step === "ready" && (
        <ReadyStep
          ends={start ? { line: endsLine(start.current) } : undefined}
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

      {start && (
        <button
          type="button"
          onClick={cancel}
          className="mt-1 w-full px-4 py-2 text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Cancel
        </button>
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
  return program.defaultDays.length > 0
    ? [...program.defaultDays]
    : [...stored];
}

const questionIndex = (question: SetupQuestion) =>
  SETUP_QUESTIONS.findIndex((q) => q.step === question);

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

/** "01 of 04 · Your kit": where a question sits in the wizard. */
function QuestionMark({ step }: { step: SetupQuestion }) {
  const question = SETUP_QUESTIONS.find((q) => q.step === step);
  return (
    <p
      className="mb-3 text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)]"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {questionNumber(step)} of{" "}
      {String(SETUP_QUESTIONS.length).padStart(2, "0")} · {question?.title}
    </p>
  );
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
        Four questions and you're training. We don't ask what you can do —
        you'll set that yourself on your first workout, one tap per movement.
      </Lede>
      <ol
        className="mt-6 flex flex-col gap-2 p-4 text-sm"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
        }}
      >
        {SETUP_QUESTIONS.map((question) => (
          <li key={question.step} className="flex gap-1 text-[var(--ink-soft)]">
            {/* The spaces are for whoever reads this as one line: a flex
                row drops them on screen, and textContent keeps them. */}
            <span>{questionNumber(question.step)} —</span>{" "}
            <span>
              {question.title}
              {question.hint && (
                <span className="block text-xs text-[var(--ink-faint)]">
                  {" "}
                  {question.hint}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      <PrimaryButton onClick={onBegin}>Begin</PrimaryButton>
    </div>
  );
}

/**
 * Where an athlete who left setup partway lands (DN-198): what they answered,
 * what is left, and the way back in.
 *
 * Each question with its answer rather than a bare "two to go", so the
 * athlete can see the earlier answers are really kept before trusting
 * Carry on with them. The first unanswered number is lit, because that is
 * where Carry on opens.
 */
function ResumeStep({
  answered,
  kit,
  program,
  days,
  weeks,
  startDate,
  onCarryOn,
  onStartOver,
}: {
  answered: number;
  kit: Equipment[];
  program: SetupProgram;
  days: number[];
  weeks: number | null;
  startDate: string;
  onCarryOn: () => void;
  onStartOver: () => void;
}) {
  const answers: Record<SetupQuestion, string> = {
    kit: kitLine(kit),
    program: program.name,
    cadence: `${listDays(days)} · ${weeks === null ? "Open-ended" : `${weeks} weeks`}`,
    start: formatStartDate(startDate),
  };
  const next = SETUP_QUESTIONS[answered];

  return (
    <div>
      <p
        className="mb-3 text-xs uppercase tracking-[0.14em] text-[var(--glow)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Welcome back
      </p>
      <Title>{answersLeft(answered)}</Title>
      <Lede>
        You got halfway through setup last time. Your answers are kept; carry
        on from where you stopped.
      </Lede>
      <ol
        className="mt-6 flex flex-col"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
        }}
      >
        {SETUP_QUESTIONS.map((question, index) => {
          const done = index < answered;
          return (
            <li
              key={question.step}
              className="flex min-h-11 items-center gap-3 px-4 py-3"
              style={{
                borderTop: index > 0 ? "1px solid var(--border)" : undefined,
              }}
            >
              <span
                className="text-xs"
                style={{
                  fontFamily: "var(--font-mono)",
                  color:
                    index === answered ? "var(--glow)" : "var(--ink-faint)",
                }}
              >
                {questionNumber(question.step)}
              </span>{" "}
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm text-[var(--ink)]">
                  {question.title}
                </span>{" "}
                <span className="text-xs text-[var(--ink-faint)]">
                  {done ? answers[question.step] : "Not answered yet"}
                </span>
              </span>
              {done && (
                <svg
                  role="img"
                  aria-label="Answered"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--glow)"
                  strokeWidth="2.5"
                  strokeLinecap="square"
                >
                  <path d="M5 12l5 5 9-10" />
                </svg>
              )}
            </li>
          );
        })}
      </ol>
      <PrimaryButton onClick={onCarryOn}>
        {next
          ? `Carry on: ${next.title.toLowerCase()}`
          : "Carry on: review and start"}
      </PrimaryButton>
      <button
        type="button"
        onClick={onStartOver}
        className="mt-3 w-full px-4 py-2 text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Start over
      </button>
    </div>
  );
}

/**
 * What the athlete has to train with (DN-195), asked before anything is
 * chosen with it.
 *
 * "Start from" only ticks boxes. Nothing remembers which was pressed -- the
 * boxes are the answer, and a preset that stayed lit after the athlete
 * unticked half of it would be claiming a kit they no longer have.
 */
function KitStep({
  kit,
  onKit,
  onBack,
  onNext,
}: {
  kit: Equipment[];
  onKit: (kit: Equipment[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <QuestionMark step="kit" />
      <Title>What do you have to train with?</Title>
      <Lede>
        We only give you movements you can do with it. Nothing at all is fine;
        bodyweight covers a full program.
      </Lede>

      <p className="mt-5 text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)]">
        Start from
      </p>
      <ul className="mt-2 grid grid-cols-3 gap-2">
        {KIT_PRESETS.map((preset) => (
          <li key={preset.name}>
            <button
              type="button"
              onClick={() => onKit([...preset.kit])}
              className="h-full w-full p-3 text-left"
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
              }}
            >
              <span className="block text-sm text-[var(--ink)]">
                {preset.name}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                {preset.hint}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <fieldset className="mt-5">
        <legend className="flex w-full justify-between text-xs uppercase tracking-[0.1em]">
          <span className="text-[var(--ink-faint)]">Then adjust</span>
          <span className="text-[var(--glow)]">
            {kit.length} of {EQUIPMENT_CATALOG.length} ticked
          </span>
        </legend>
        <EquipmentChecklist
          owned={kit}
          onToggle={(piece, next) =>
            onKit(next ? [...kit, piece] : kit.filter((p) => p !== piece))
          }
        />
      </fieldset>

      <p className="mt-3 text-xs text-[var(--ink-faint)]">
        You can change this any time in Settings.
      </p>

      <PrimaryButton onClick={onNext}>Next: your program</PrimaryButton>
      <BackButton onClick={onBack} />
    </div>
  );
}

function ProgramStep({
  programs,
  chosenId,
  kit,
  onChoose,
  onBack,
}: {
  programs: SetupProgram[];
  chosenId: string;
  /** Carried through the editor, so "Build your own" does not lose it. */
  kit: Equipment[];
  onChoose: (program: SetupProgram) => void;
  onBack: () => void;
}) {
  return (
    <div>
      <QuestionMark step="program" />
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
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--ink)",
                }}
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
          {/* Opens the program editor (DN-145), which comes back here with
              what was written already chosen. */}
          <Link
            to="/programs/new?from=setup"
            state={{ kit } satisfies SetupHandBack}
            className="block w-full p-4"
            style={{
              background: "var(--panel)",
              border: "1px dashed var(--border)",
            }}
          >
            <span
              className="block font-semibold uppercase"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
            >
              Build your own
            </span>
            <span className="mt-2 block text-sm text-[var(--ink-soft)]">
              Write your own week, day by day.
            </span>
          </Link>
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
        : `${program.minWeeks}–${program.maxWeeks} weeks${program.allowsNoEnd ? " or no end" : ""}`;
  const cadence =
    program.scheduleMode === "fixed"
      ? `Fixed schedule · ${daysLabel(program.fixedDays.length)}`
      : program.minDaysPerWeek === program.maxDaysPerWeek
        ? `${daysLabel(program.minDaysPerWeek)} a week`
        : `${program.minDaysPerWeek}–${program.maxDaysPerWeek} days a week`;
  return `${length} · ${cadence}`;
}

// An authored program can train a single day (DN-145); the seeded ones never did.
const daysLabel = (n: number | null) => `${n} day${n === 1 ? "" : "s"}`;

function CadenceStep({
  program,
  days,
  weeks,
  warning,
  onToggleDay,
  onWeeks,
  numbered,
  onBack,
  onNext,
}: {
  program: SetupProgram;
  days: number[];
  weeks: number | null;
  warning: string | null;
  onToggleDay: (day: number) => void;
  /** Null is "No end", on a program that offers it (DN-154). */
  onWeeks: (weeks: number | null) => void;
  /** Off on a start from Programs, which asks two of the four. */
  numbered: boolean;
  onBack?: () => void;
  onNext: () => void;
}) {
  const isFixed = program.scheduleMode === "fixed";
  // A fixed program's days are read off the program; a flexible one's are the
  // athlete's own. The strip below renders whichever is in force, which is
  // what makes the locked case a readout rather than a second component.
  const shown = isFixed ? program.fixedDays : days;
  const lengths = weeksChoice(program);
  // The length "No end" hands back to, so trying it and changing your mind
  // does not lose the weeks you had stepped to.
  const [lastWeeks, setLastWeeks] = useState(weeks ?? lengths?.start ?? null);
  const stepWeeks = (next: number) => {
    setLastWeeks(next);
    onWeeks(next);
  };

  return (
    <div>
      {numbered && <QuestionMark step="cadence" />}
      <Title>
        {isFixed ? "Your training week" : "Which days do you train?"}
      </Title>
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

      {lengths && (
        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)]">
            How long
          </p>
          {/* "A number or no end" (DN-154): two answers to one question, so
              a pair of pressed buttons rather than a checkbox that disables
              the stepper beside it. */}
          {lengths.noEnd && (
            <div className="mt-2 flex gap-2">
              <LengthModeButton
                on={weeks !== null}
                onClick={() => onWeeks(lastWeeks ?? lengths.start)}
              >
                Weeks
              </LengthModeButton>
              <LengthModeButton
                on={weeks === null}
                onClick={() => onWeeks(null)}
              >
                No end
              </LengthModeButton>
            </div>
          )}
          {weeks === null ? (
            <p className="mt-3 text-sm text-[var(--ink-soft)]">
              {program.name} repeats its week until you start another program
              from Programs.
            </p>
          ) : (
            <>
              <div className="mt-2 flex items-center gap-4">
                <StepperButton
                  label="Fewer weeks"
                  disabled={weeks <= lengths.min}
                  onClick={() => stepWeeks(weeks - 1)}
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
                  onClick={() => stepWeeks(weeks + 1)}
                >
                  +
                </StepperButton>
              </div>
              <p className="mt-2 text-xs text-[var(--ink-faint)]">
                {weeks === program.defaultWeeks
                  ? `${program.name} is written as ${weeks} weeks.`
                  : `${program.name} is written as ${program.defaultWeeks} weeks — ${weeks} repeats or trims the middle block.`}
              </p>
            </>
          )}
        </div>
      )}

      <PrimaryButton onClick={onNext} disabled={warning !== null}>
        Continue
      </PrimaryButton>
      {onBack && <BackButton onClick={onBack} />}
    </div>
  );
}

function LengthModeButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="h-10 px-4 text-[12px] font-semibold uppercase tracking-[0.1em]"
      style={{
        background: on ? "var(--glow)" : "var(--panel-2)",
        border: "1px solid var(--border)",
        color: on ? "var(--panel)" : "var(--ink-soft)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {children}
    </button>
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
  numbered,
  onBack,
  onNext,
}: {
  options: SetupOptions;
  chosen: string;
  onChoose: (date: string) => void;
  numbered: boolean;
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
      {numbered && <QuestionMark step="start" />}
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
  ends,
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
  /** Set on a start from Programs, with what that start ends, if anything. */
  ends?: { line: string | null };
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
      {ends ? (
        <>
          <Title>Start {program.name}</Title>
          {/* The athlete's movements carry over, so the first-run line about
              defaults would be untrue here. What is worth saying is what
              they are leaving. */}
          {ends.line && <Lede>{ends.line}</Lede>}
        </>
      ) : (
        <>
          <Title>You're ready</Title>
          <Lede>
            Every movement starts on a default. Change any of them with one tap
            on your first workout.
          </Lede>
        </>
      )}

      <dl
        className="mt-5 flex flex-col gap-2 p-4 text-sm"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
        }}
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
        {pending ? "Saving…" : ends ? `Start ${program.name}` : "Go to today"}
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
          Rest days stay rest days — nothing will offer to move a missed session
          onto one. The gaps are as much the program as the sessions.
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
 * trains, not about the program, and for every built-in program it is
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
