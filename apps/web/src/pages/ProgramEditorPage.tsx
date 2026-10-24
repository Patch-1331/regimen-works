import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ApiError, api, type LibraryTier } from "../lib/api";
import type { SetupHandBack } from "./SetupPage";
import { weekdayName } from "../lib/weekdays";
import {
  EMPTY_PROGRAM,
  blankLine,
  changesWeek,
  dayProblems,
  draftProblems,
  duplicateLine,
  fromProgram,
  lineMovementName,
  pickDay,
  pickedDays,
  toCreateProgram,
  type DraftLine,
  type ProgramDraft,
} from "../lib/programDraft";
import {
  BackNext,
  StepBar,
  WizardFooter,
  WizardHeader,
  mono,
  primaryButton,
  primaryStyle,
  stepKey,
  type Step,
  type StepEntry,
} from "./programEditor/chrome";
import { BasicsStep } from "./programEditor/BasicsStep";
import { DayStep } from "./programEditor/DayStep";
import { MovementStep } from "./programEditor/MovementStep";
import { ReviewStep } from "./programEditor/ReviewStep";

/**
 * Writing a program, one page per step (DN-193; was the one-sheet week of
 * DN-145/DN-137).
 *
 * Basics names it and picks its training days; each picked day is then a
 * page of its own, in week order; each movement opens a page of its own from
 * its day; Review shows the whole week and saves it. Nothing is saved before
 * Review, and any step can be gone back to from the step bar. There is no
 * length here -- the week repeats, and how many weeks to run it is asked
 * when the athlete starts it.
 *
 * Reached from the Library and from the setup wizard's "Build your own".
 * `?from=setup` is the second, and saving goes back to the picker with the
 * new program chosen rather than to the list.
 *
 * With an `:id` it edits a saved program instead (DN-146), opening on Review.
 * Once anyone has started that program, a change to its week is saved as a
 * new version and the old one is archived -- and Review says so before the
 * save, not after.
 *
 * `tier="global"` is the admin's route to a global program (DN-148). A new
 * program is the athlete's own unless an admin ticks "publish to everyone"
 * in Basics, which sends it to the admin route instead -- the tier is always
 * which route is called, never a field of the body. A global program may
 * only name global movements, so the picker offers only those.
 *
 * `?copy=<id>` starts a new program from a global one (DN-149), opening on
 * Review: filled from it and saved as the athlete's own through the ordinary
 * create route, with no link back. It is always the athlete's own -- an admin
 * publishes the copy afterwards, like any program of theirs.
 *
 * A program pasted in (DN-152) arrives as router state, `{ pasted }`: the
 * lines the paste box accepted, as an unsaved draft, opening on Basics to be
 * named. The wizard holds them to its own rules from there, as if typed.
 */

export function ProgramEditorPage({ tier: routeTier = "own" }: { tier?: LibraryTier }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { id } = useParams();
  const fromSetup = params.get("from") === "setup";
  const back = fromSetup ? "/setup" : "/programs";
  // The wizard's kit answer (DN-195), handed back however the editor is left,
  // so going to write a program does not undo the question before it.
  const setupKit = (useLocation().state as SetupHandBack | null)?.kit;
  const handBack: SetupHandBack | undefined =
    fromSetup && setupKit ? { kit: setupKit } : undefined;
  const copyId = id === undefined ? params.get("copy") : null;

  const saved = useQuery({
    queryKey: ["program", routeTier, id],
    queryFn: () => api.program(routeTier, id!),
    enabled: id !== undefined,
  });
  const source = useQuery({
    queryKey: ["copyableProgram", copyId],
    queryFn: () => api.copyableProgram(copyId!),
    enabled: copyId !== null,
  });

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  // Offered only when writing something new outside the setup wizard: the
  // wizard is choosing the athlete's own program, not curating the library.
  const canPublish =
    me?.isAdmin === true && id === undefined && copyId === null && !fromSetup;
  const [publish, setPublish] = useState(false);
  const tier: LibraryTier =
    id !== undefined ? routeTier : canPublish && publish ? "global" : "own";

  const { data: everything = [] } = useQuery({
    queryKey: ["exercises"],
    queryFn: api.exercises,
  });
  const library =
    tier === "global" ? everything.filter((e) => e.ownerId === null) : everything;

  const pasted = (useLocation().state as { pasted?: ProgramDraft } | null)
    ?.pasted;
  const [draft, setDraft] = useState<ProgramDraft>(pasted ?? EMPTY_PROGRAM);
  // Filled once from the saved program, then the athlete's: a refetch must
  // not overwrite what they have typed since.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (saved.data && loadedId !== saved.data.id) {
    setDraft(fromProgram(saved.data.program));
    setLoadedId(saved.data.id);
  }
  // A copy shares the source's name until the athlete changes it; the
  // suggestion keeps the two apart in the picker, and lets an admin publish
  // the copy without clashing with the original.
  if (source.data && copyId !== null && loadedId !== copyId) {
    setDraft({ ...fromProgram(source.data), name: `${source.data.name} (copy)` });
    setLoadedId(copyId);
  }

  // A saved program or a copy is already whole, so it opens on Review; a new
  // or pasted one has to be named first. Review counts as having been to
  // every step: what is wrong anywhere is flagged from there on.
  const opensOnReview = id !== undefined || copyId !== null;
  const [step, setStep] = useState<Step>(
    opensOnReview ? { kind: "review" } : { kind: "basics" },
  );
  const [visited, setVisited] = useState<Set<string>>(
    () => new Set([opensOnReview ? "review" : "basics"]),
  );
  // The movement whose page is open, over its day's step.
  const [lineOpen, setLineOpen] = useState<string | null>(null);
  // A day unticked in Basics keeps its lines here, so ticking it again by
  // mistake-and-back brings them back rather than an empty day.
  const dropped = useRef<Partial<Record<number, DraftLine[]>>>({});

  const go = (next: Step) => {
    setStep(next);
    setLineOpen(null);
    setVisited((v) => new Set([...v, stepKey(next)]));
  };
  // Each step starts at its top, as a new page would.
  const here = lineOpen ?? stepKey(step);
  useEffect(() => {
    window.scrollTo?.({ top: 0 });
  }, [here]);

  const days = pickedDays(draft);
  // A day dropped in Basics while it was the step being shown.
  if (step.kind === "day" && !days.includes(step.day)) setStep({ kind: "basics" });

  // A movement picked from the athlete's own library before "publish" was
  // ticked: a global program cannot name it, so it is one more thing to fix.
  const personal =
    tier === "global"
      ? [
          ...new Set(
            Object.values(draft.days)
              .flatMap((lines) => lines ?? [])
              .flatMap((l) =>
                l.exerciseId &&
                everything.some((e) => e.id === l.exerciseId && e.ownerId !== null)
                  ? [lineMovementName(l, everything)]
                  : [],
              ),
          ),
        ]
      : [];
  const onlyYours =
    personal.length > 0
      ? `Only you have ${personal.join(", ")}; pick a library movement.`
      : null;
  const problems = [...draftProblems(draft), ...(onlyYours ? [onlyYours] : [])];

  const editing = saved.data;
  const willFork =
    editing !== undefined && editing.hasRuns && changesWeek(draft, editing.program);

  const save = useMutation({
    mutationFn: async () => {
      const body = toCreateProgram(draft);
      if (!id) return api.createProgram(tier, body);
      return (await api.updateProgram(tier, id, body)).program;
    },
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["programs"] }),
        queryClient.invalidateQueries({ queryKey: ["globalPrograms"] }),
        queryClient.invalidateQueries({ queryKey: ["program"] }),
        // Refetched now, not on the wizard's next mount: the wizard seeds its
        // answers from the first options it renders, and those have to
        // include the program it is being handed back.
        queryClient.invalidateQueries({
          queryKey: ["setup"],
          refetchType: "all",
        }),
      ]);
      if (fromSetup) {
        void navigate("/setup", {
          state: { ...handBack, programId: created.id } satisfies SetupHandBack,
        });
      } else {
        void navigate("/programs");
      }
    },
  });

  if (copyId !== null && !source.data) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Link to={back} state={handBack} className="text-xs text-[var(--ink-faint)]" style={mono}>
          ← BACK
        </Link>
        <p
          className={`mt-4 text-sm ${source.error ? "text-[var(--danger)]" : "text-[var(--ink-faint)]"}`}
        >
          {source.error instanceof ApiError && source.error.status === 404
            ? "That program isn't in the library any more."
            : source.error
              ? "Couldn't load the program."
              : "Loading program…"}
        </p>
      </div>
    );
  }

  if (id !== undefined && !editing) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Link to={back} state={handBack} className="text-xs text-[var(--ink-faint)]" style={mono}>
          ← BACK
        </Link>
        <p
          className={`mt-4 text-sm ${saved.error ? "text-[var(--danger)]" : "text-[var(--ink-faint)]"}`}
        >
          {saved.error instanceof ApiError && saved.error.status === 404
            ? routeTier === "global"
              ? "There's no global program here."
              : "There's no program of yours here."
            : saved.error
              ? "Couldn't load the program."
              : "Loading program…"}
        </p>
      </div>
    );
  }

  const flexible = draft.scheduleMode === "flexible";
  // In order, whenever you can: the days are first, second, third -- the
  // weekday only says where in the order each sits.
  const labelOf = (day: number) =>
    flexible ? `Day ${days.indexOf(day) + 1}` : weekdayName(day).slice(0, 3);
  const nameOf = (day: number) => (flexible ? labelOf(day) : weekdayName(day));

  const basicsWrong = draft.name.trim() === "" || days.length === 0;
  const seen = (s: Step) => visited.has(stepKey(s)) || visited.has("review");
  const stateOf = (s: Step, wrong: boolean): StepEntry["state"] =>
    !seen(s) ? "open" : wrong ? "wrong" : "ok";
  const steps: StepEntry[] = [
    {
      step: { kind: "basics" },
      label: "Basics",
      name: "Basics",
      state: stateOf({ kind: "basics" }, basicsWrong),
    },
    ...days.map((day): StepEntry => {
      const s: Step = { kind: "day", day };
      return {
        step: s,
        label: labelOf(day),
        name: nameOf(day),
        state: stateOf(s, dayProblems(draft, day).length > 0),
      };
    }),
    {
      step: { kind: "review" },
      label: "Review",
      name: "Review",
      state: stateOf({ kind: "review" }, problems.length > 0),
    },
  ];
  const at = steps.findIndex((e) => stepKey(e.step) === stepKey(step));
  const prev = steps[at - 1];
  const next = steps[at + 1];

  const putLines = (day: number, lines: DraftLine[]) =>
    setDraft((d) => ({ ...d, days: { ...d.days, [day]: lines } }));

  const notes: ReactNode = (
    <>
      {pasted && (
        <p className="mt-3 text-[12px] text-[var(--ink-faint)]" role="note">
          Pasted in. Nothing is saved until you save it.
        </p>
      )}
      {source.data && (
        <p className="mt-3 text-[12px] text-[var(--ink-faint)]" role="note">
          Copied from {source.data.name} in the library. This copy is yours to
          change; the original stays as it is.
        </p>
      )}
      {routeTier === "global" && (
        <p className="mt-3 text-[11px] tracking-[0.14em] text-[var(--glow)]" style={mono}>
          GLOBAL — EVERY ATHLETE IS OFFERED THIS
        </p>
      )}
    </>
  );

  // The movement page sits over its day: its own header, no step bar.
  if (step.kind === "day" && lineOpen !== null) {
    const day = step.day;
    const lines = draft.days[day] ?? [];
    const index = lines.findIndex((l) => l.id === lineOpen);
    const line = lines[index];
    if (line) {
      const toDay = () => setLineOpen(null);
      return (
        <div className="mx-auto max-w-md p-6 pb-32">
          <WizardHeader
            cancelTo={back}
            cancelState={handBack}
            right={`MOVEMENT ${index + 1} OF ${lines.length}`}
            back={{ label: nameOf(day), onClick: toDay }}
          />
          <MovementStep
            line={line}
            where={`${nameOf(day)} · movement ${index + 1}`}
            dayName={nameOf(day)}
            library={everything}
            pickable={library}
            canCreate={tier !== "global"}
            onChange={(changed) =>
              putLines(day, lines.map((l) => (l.id === changed.id ? changed : l)))
            }
            onDuplicate={() => {
              const copied = duplicateLine(draft, day, line.id);
              setDraft(copied);
              setLineOpen(copied.days[day]![index + 1].id);
            }}
            onRemove={() => {
              putLines(day, lines.filter((l) => l.id !== line.id));
              toDay();
            }}
          />
          <WizardFooter>
            <button type="button" onClick={toDay} className={primaryButton} style={primaryStyle}>
              Done · back to {nameOf(day)}
            </button>
          </WizardFooter>
        </div>
      );
    }
  }

  return (
    <div className="mx-auto max-w-md p-6 pb-40">
      <WizardHeader
        cancelTo={back}
        cancelState={handBack}
        right={`STEP ${at + 1} OF ${steps.length}`}
      />
      <StepBar steps={steps} current={stepKey(step)} onGo={go} />

      {step.kind === "basics" && (
        <BasicsStep
          draft={draft}
          onChange={setDraft}
          onPickDay={(day, on) => {
            if (!on) dropped.current[day] = draft.days[day];
            setDraft(pickDay(draft, day, on, dropped.current[day]));
          }}
          notes={notes}
          publish={
            canPublish && (
              <label className="mt-5 flex items-start gap-2 text-sm text-[var(--ink-soft)]">
                <input
                  type="checkbox"
                  checked={publish}
                  onChange={(e) => setPublish(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Publish to the global library
                  <span className="block text-[11px] text-[var(--ink-faint)]">
                    Every athlete is offered it, and only library movements can go in
                    it. It won't be in your own programs.
                  </span>
                </span>
              </label>
            )
          }
        />
      )}

      {step.kind === "day" && (
        <DayStep
          key={step.day}
          draft={draft}
          day={step.day}
          title={nameOf(step.day)}
          eyebrow={
            flexible
              ? `${days.indexOf(step.day) + 1} OF ${days.length} · LISTED UNDER ${weekdayName(step.day).toUpperCase()}`
              : `DAY ${days.indexOf(step.day) + 1} OF ${days.length}`
          }
          library={everything}
          pickable={library}
          canCreate={tier !== "global"}
          onChange={setDraft}
          onOpenLine={setLineOpen}
          onAddLine={(choice) => {
            const line = { ...blankLine(), ...choice };
            putLines(step.day, [...(draft.days[step.day] ?? []), line]);
            setLineOpen(line.id);
          }}
        />
      )}

      {step.kind === "review" && (
        <ReviewStep
          draft={draft}
          library={everything}
          labelOf={labelOf}
          notes={notes}
          onGo={go}
        />
      )}

      <WizardFooter>
        {step.kind === "review" ? (
          <>
            {save.error && (
              <p className="mb-2 text-sm text-[var(--danger)]" role="alert">
                {save.error instanceof ApiError
                  ? save.error.message
                  : "Couldn't save the program."}
              </p>
            )}
            {editing?.archived && (
              <p className="mb-2 text-sm text-[var(--ink-soft)]">
                This program is archived. Restore it before changing it.
              </p>
            )}
            {editing?.hasRuns && !editing.archived && (
              <p className="mb-2 text-sm text-[var(--ink-soft)]" role="status">
                {willFork
                  ? "Someone has started this program, so changing its week saves a new version. Runs already under way finish on this one."
                  : "Someone has started this program. Renaming it or its days changes it for them too; changing its week will save a new version."}
              </p>
            )}
            {onlyYours && (
              <p className="mb-1 text-xs text-[var(--danger)]">{onlyYours}</p>
            )}
            {problems.length > 0 && (
              <p className="mb-2 text-xs text-[var(--danger)]" style={mono}>
                {problems.length} {problems.length === 1 ? "thing" : "things"} to
                fix before saving
                {draft.name.trim() === "" ? " — starting with a name" : ""}
              </p>
            )}
            <button
              type="button"
              disabled={problems.length > 0 || save.isPending || editing?.archived}
              onClick={() => save.mutate()}
              className={primaryButton}
              style={primaryStyle}
            >
              {save.isPending
                ? "Saving…"
                : willFork
                  ? "Save as new version"
                  : "Save program"}
            </button>
          </>
        ) : (
          <BackNext
            onBack={prev && (() => go(prev.step))}
            next={next.name}
            onNext={() => go(next.step)}
            // An empty day's own button is the loud one.
            quiet={step.kind === "day" && (draft.days[step.day]?.length ?? 0) === 0}
          />
        )}
      </WizardFooter>
    </div>
  );
}
