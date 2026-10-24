import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { defaultProgramSummary } from "@regimen-works/shared";
import { ApiError, api, type ApiExercise, type LibraryTier } from "../lib/api";
import type { SetupHandBack } from "./SetupPage";
import { MovementPicker } from "../components/MovementPicker";
import { SwapButton, SwapPanel } from "../components/MovementSwap";
import { buildAlternativeRows, canSwap } from "../lib/swapOptions";
import { WEEKDAYS } from "../lib/weekdays";
import {
  EMPTY_PROGRAM,
  SET_PRESETS,
  applyPreset,
  blankLine,
  changesWeek,
  copyDay,
  draftProblems,
  duplicateLine,
  formatRest,
  formatScheme,
  fromProgram,
  lineMovementName,
  lineProblems,
  toCreateProgram,
  toPerSet,
  toSameForAll,
  trainingDays,
  type DraftLine,
  type DraftSet,
  type ProgramDraft,
} from "../lib/programDraft";

/**
 * Writing a program (DN-145): the week sheet DN-137 settled on.
 *
 * All seven weekdays on one sheet. A day with nothing on it reads "Rest" and
 * is saved as no day at all. There is no length here -- the week repeats, and
 * how many weeks to run it is asked when the athlete starts it.
 *
 * Reached from the Library and from the setup wizard's "Build your own".
 * `?from=setup` is the second, and saving goes back to the picker with the
 * new program chosen rather than to the list.
 *
 * With an `:id` it edits a saved program instead (DN-146). Once anyone has
 * started that program, a change to its week is saved as a new version and
 * the old one is archived -- and the sheet says so before the save, not after.
 *
 * `tier="global"` is the admin's route to a global program (DN-148). A new
 * program is the athlete's own unless an admin ticks "publish to everyone",
 * which sends it to the admin route instead -- the tier is always which route
 * is called, never a field of the body. A global program may only name
 * global movements, so the picker offers only those.
 *
 * `?copy=<id>` starts a new program from a global one (DN-149): the sheet is
 * filled from it and saved as the athlete's own through the ordinary create
 * route, with no link back. It is always the athlete's own -- an admin
 * publishes the copy afterwards, like any program of theirs.
 *
 * A program pasted in (DN-152) arrives as router state, `{ pasted }`: the
 * lines the paste box accepted, as an unsaved draft. The sheet holds them to
 * its own rules from there, as if they had been typed.
 */

const mono = { fontFamily: "var(--font-mono)" } as const;
const display = { fontFamily: "var(--font-display)" } as const;

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
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  // The line whose alternatives are showing (DN-185). Apart from `picking` so
  // each control toggles its own panel, and each clears the other's.
  const [swapping, setSwapping] = useState<string | null>(null);
  const [copying, setCopying] = useState<number | null>(null);

  const days = trainingDays(draft);
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
  const problems = [
    ...draftProblems(draft),
    ...(personal.length > 0
      ? [`Only you have ${personal.join(", ")}; pick a library movement.`]
      : []),
  ];

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

  const putLines = (day: number, lines: DraftLine[]) =>
    setDraft((d) => ({ ...d, days: { ...d.days, [day]: lines } }));
  const putLine = (day: number, line: DraftLine) =>
    putLines(
      day,
      (draft.days[day] ?? []).map((l) => (l.id === line.id ? line : l)),
    );

  return (
    <div className="mx-auto max-w-md p-6 pb-32">
      <Link to={back} state={handBack} className="text-xs text-[var(--ink-faint)]" style={mono}>
        ← CANCEL
      </Link>

      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Name this program"
        aria-label="Program name"
        className="mt-4 w-full border-b border-[var(--border)] bg-transparent pb-1 text-2xl font-bold text-[var(--ink)] outline-none"
        style={display}
      />
      <input
        value={draft.summary}
        onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
        placeholder={
          days.length > 0
            ? defaultProgramSummary(draft.scheduleMode, days)
            : "One line about it (optional)"
        }
        aria-label="Summary"
        maxLength={140}
        className="mt-3 w-full border-b border-[var(--border)] bg-transparent pb-1 text-sm text-[var(--ink-soft)] outline-none"
      />

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
      {canPublish && (
        <label className="mt-4 flex items-start gap-2 text-sm text-[var(--ink-soft)]">
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
      )}

      {/* Fixed vs flexible, without the words (DN-137). */}
      <fieldset className="mt-5 border border-[var(--border)] bg-[var(--panel)] p-3">
        <legend
          className="px-1 text-[11px] font-semibold tracking-[0.14em] text-[var(--ink-faint)]"
          style={mono}
        >
          WHEN YOU TRAIN THEM
        </legend>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {(
            [
              ["fixed", "On these weekdays", "The same days every week"],
              [
                "flexible",
                days.length === 1
                  ? "Any 1 day a week"
                  : `Any ${days.length || "N"} days a week`,
                "In this order, whenever you can",
              ],
            ] as const
          ).map(([mode, title, sub]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={draft.scheduleMode === mode}
              onClick={() => setDraft({ ...draft, scheduleMode: mode })}
              className="border p-2 text-left"
              style={{
                borderColor:
                  draft.scheduleMode === mode ? "var(--glow)" : "var(--border)",
                color:
                  draft.scheduleMode === mode
                    ? "var(--ink)"
                    : "var(--ink-faint)",
              }}
            >
              <span className="block">{title}</span>
              <span className="block text-[11px] text-[var(--ink-faint)]">
                {sub}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 space-y-2">
        {WEEKDAYS.map(({ value: day, short }) => {
          const lines = draft.days[day] ?? [];
          const rest = lines.length === 0;
          const label =
            draft.scheduleMode === "fixed" || rest
              ? short
              : `Day ${days.indexOf(day) + 1}`;
          return (
            <section
              key={day}
              aria-label={short}
              className="p-3"
              style={{
                border: `1px ${rest ? "dashed" : "solid"} var(--border)`,
                background: rest ? "transparent" : "var(--panel)",
              }}
            >
              <header className="flex items-baseline gap-3">
                <span className="w-14 text-xs text-[var(--glow)]" style={mono}>
                  {label.toUpperCase()}
                </span>
                <span className="flex-1 text-sm text-[var(--ink-faint)]">
                  {rest
                    ? "Rest"
                    : draft.scheduleMode === "flexible"
                      ? short
                      : ""}
                </span>
                {!rest && (
                  <button
                    type="button"
                    onClick={() => setCopying(copying === day ? null : day)}
                    className="text-[11px] text-[var(--ink-soft)]"
                    style={mono}
                  >
                    COPY TO…
                  </button>
                )}
              </header>

              {!rest && (
                <input
                  value={draft.labels[day] ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      labels: { ...draft.labels, [day]: e.target.value },
                    })
                  }
                  placeholder="Name this day (optional)"
                  aria-label={`Name for ${short}`}
                  maxLength={40}
                  className="mt-1 w-full border-b border-[var(--border)] bg-transparent pb-0.5 text-sm text-[var(--ink)] outline-none"
                />
              )}

              {copying === day && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {WEEKDAYS.filter((d) => d.value !== day).map((target) => (
                    <button
                      key={target.value}
                      type="button"
                      onClick={() => {
                        setDraft(copyDay(draft, day, [target.value]));
                        setCopying(null);
                      }}
                      className="border border-[var(--border)] px-2 py-1 text-xs text-[var(--ink-soft)]"
                    >
                      {target.short}
                      {(draft.days[target.value]?.length ?? 0) > 0
                        ? " (replace)"
                        : ""}
                    </button>
                  ))}
                </div>
              )}

              <ul className="mt-1">
                {lines.map((line) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    library={everything}
                    pickable={library}
                    open={open === line.id}
                    picking={picking === line.id}
                    swapping={swapping === line.id}
                    onToggle={() => setOpen(open === line.id ? null : line.id)}
                    onPick={(on) => {
                      setPicking(on ? line.id : null);
                      if (on) setSwapping(null);
                    }}
                    onSwap={(on) => {
                      setSwapping(on ? line.id : null);
                      if (on) setPicking(null);
                    }}
                    onChange={(next) => putLine(day, next)}
                    onDuplicate={() =>
                      setDraft(duplicateLine(draft, day, line.id))
                    }
                    onRemove={() =>
                      putLines(
                        day,
                        lines.filter((l) => l.id !== line.id),
                      )
                    }
                  />
                ))}
              </ul>

              <button
                type="button"
                onClick={() => {
                  const line = blankLine();
                  putLines(day, [...lines, line]);
                  setOpen(line.id);
                  setPicking(line.id);
                }}
                className="mt-1 text-xs text-[var(--ink-faint)]"
                style={mono}
              >
                + ADD MOVEMENT
              </button>
            </section>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-[var(--ink-faint)]">
        This week repeats. You choose how many weeks when you start it.
      </p>

      <footer
        className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] p-4"
        style={{ background: "var(--bg)" }}
      >
        <div className="mx-auto max-w-md">
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
            className="w-full py-3 text-sm font-semibold uppercase tracking-[0.1em] disabled:opacity-40"
            style={{ ...mono, background: "var(--glow)", color: "var(--bg)" }}
          >
            {save.isPending
              ? "Saving…"
              : willFork
                ? "Save as new version"
                : "Save program"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function LineRow({
  line,
  library,
  pickable,
  open,
  picking,
  swapping,
  onToggle,
  onPick,
  onSwap,
  onChange,
  onDuplicate,
  onRemove,
}: {
  line: DraftLine;
  /** Every movement the athlete can see, for naming what a line holds. */
  library: ApiExercise[];
  /** What this program's tier may name, for choosing a new one. */
  pickable: ApiExercise[];
  open: boolean;
  picking: boolean;
  swapping: boolean;
  onToggle: () => void;
  onPick: (on: boolean) => void;
  onSwap: (on: boolean) => void;
  onChange: (line: DraftLine) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const problems = lineProblems(line);
  const exercise = library.find((e) => e.id === line.exerciseId);
  const unit = exercise?.unit ?? "reps";
  // A group line has no ⇄: it already names any of its members (DN-185).
  const swappable =
    exercise !== undefined &&
    canSwap(exercise, { isSwapped: false, prescribedId: null });
  const panelId = `alternatives-${line.id}`;
  return (
    <li className="border-t border-[var(--border)] py-1.5 first:border-t-0">
      <div className="flex items-center">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
          onClick={onToggle}
        >
          <span
            className="flex-1 text-sm"
            style={{ color: problems.length ? "var(--danger)" : "var(--ink)" }}
          >
            {problems.length ? "✕ " : ""}
            {lineMovementName(line, library)}
          </span>
          <span className="text-xs text-[var(--ink-soft)]" style={mono}>
            {formatScheme(line, unit)}
          </span>
          <span
            className="w-20 text-right text-[11px] text-[var(--ink-faint)]"
            style={mono}
          >
            {formatRest(line)}
          </span>
        </button>
        {swappable && (
          <SwapButton
            name={exercise.name}
            open={swapping}
            panelId={panelId}
            onClick={() => onSwap(!swapping)}
          />
        )}
      </div>
      {swappable && swapping && (
        <LineAlternatives
          id={panelId}
          current={exercise}
          pickable={pickable}
          onPick={(exerciseId) => {
            onChange({ ...line, exerciseId, movementGroup: null });
            onSwap(false);
          }}
        />
      )}
      {open && (
        <div className="pb-2">
          {problems.map((p) => (
            <p key={p} className="mt-1 text-[11px] text-[var(--danger)]">
              {p}
            </p>
          ))}
          <button
            type="button"
            onClick={() => onPick(!picking)}
            className="mt-1 text-xs text-[var(--glow)] underline"
          >
            {line.exerciseId || line.movementGroup
              ? "Change movement"
              : "Choose movement"}
          </button>
          {picking && (
            <MovementPicker
              library={pickable}
              onClose={() => onPick(false)}
              onPick={(choice) => {
                onChange({ ...line, ...choice });
                onPick(false);
              }}
            />
          )}
          <SchemeFields line={line} onChange={onChange} />
          <div className="mt-2 flex gap-3 text-[11px]" style={mono}>
            <button
              type="button"
              className="text-[var(--ink-soft)]"
              onClick={onDuplicate}
            >
              DUPLICATE LINE
            </button>
            <button
              type="button"
              className="text-[var(--danger)]"
              onClick={onRemove}
            >
              REMOVE
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * A line's alternatives, read when the ⇄ opens (DN-185): Today's sections for
 * the movement, narrowed to what this program may name. A pick changes the
 * line being written -- its numbers stay -- and nothing more until Save.
 */
function LineAlternatives({
  id,
  current,
  pickable,
  onPick,
}: {
  id: string;
  current: ApiExercise;
  pickable: ApiExercise[];
  onPick: (exerciseId: string) => void;
}) {
  const { data, isError } = useQuery({
    queryKey: ["exercise-alternatives", current.id],
    queryFn: () => api.exerciseAlternatives(current.id),
  });
  return (
    <SwapPanel
      id={id}
      label="ALTERNATIVES"
      rows={data ? buildAlternativeRows(data, current, pickable) : null}
      failed={isError}
      isSwapped={false}
      prescribedName={null}
      prescribedReason={null}
      onPick={onPick}
      onRevert={() => undefined}
    />
  );
}

// Whole numbers only: anything else reads as blank, which the line then
// reports as missing rather than saving as NaN.
const num = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
// A load step is signed: "-10", "+5", "0". A true minus sign counts too.
const signed = (v: string) => {
  const t = v.trim().replace("\u2212", "-").replace(/%$/, "");
  return /^[+-]?\d+$/.test(t) ? Number(t) : null;
};
const field =
  "w-14 border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-center text-sm text-[var(--ink)]";

/**
 * How much of the movement, and how it is rested. "Same for all sets" is the
 * default; "set by set" and the presets write each set on its own row (ADR
 * 0011). A preset only fills the rows -- its name is not kept.
 */
function SchemeFields({
  line,
  onChange,
}: {
  line: DraftLine;
  onChange: (line: DraftLine) => void;
}) {
  const perSet = line.perSet;
  return (
    <div className="mt-2 text-xs text-[var(--ink-soft)]" style={mono}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={perSet === null}
            onChange={(e) =>
              onChange(e.target.checked ? toSameForAll(line) : toPerSet(line))
            }
          />
          same for all sets
        </label>
      </div>
      <div
        className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]"
        role="group"
        aria-label="Fill sets from a preset"
      >
        <span className="text-[var(--ink-faint)]">PRESET</span>
        {SET_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(applyPreset(line, preset.id))}
            className="border border-[var(--border)] px-1.5 py-0.5 text-[var(--ink-soft)]"
          >
            {preset.label}
          </button>
        ))}
      </div>
      {perSet === null ? (
        <SameForAllFields line={line} onChange={onChange} />
      ) : (
        <PerSetFields
          sets={perSet}
          onChange={(sets) => onChange({ ...line, perSet: sets })}
        />
      )}
    </div>
  );
}

function SameForAllFields({
  line,
  onChange,
}: {
  line: DraftLine;
  onChange: (line: DraftLine) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        className={field}
        inputMode="numeric"
        value={line.sets ?? ""}
        onChange={(e) => onChange({ ...line, sets: num(e.target.value) })}
        aria-label="Sets"
      />
      <span>×</span>
      <CountFields set={line} onChange={(next) => onChange({ ...line, ...next })} />
      <span>rest</span>
      <input
        className={field}
        inputMode="numeric"
        placeholder="—"
        value={line.restSeconds ?? ""}
        onChange={(e) =>
          onChange({ ...line, restSeconds: num(e.target.value) })
        }
        aria-label="Rest seconds"
      />
      <span>s</span>
    </div>
  );
}

/**
 * One row per set: its count, its load step against the set before, and the
 * rest after it. The first set has no step -- nothing comes before it.
 */
function PerSetFields({
  sets,
  onChange,
}: {
  sets: DraftSet[];
  onChange: (sets: DraftSet[]) => void;
}) {
  const put = (i: number, next: Partial<DraftSet>) =>
    onChange(sets.map((s, at) => (at === i ? { ...s, ...next } : s)));
  return (
    <ol className="mt-2 flex flex-col gap-1.5">
      {sets.map((set, i) => {
        const n = i + 1;
        return (
          <li
            key={i}
            className="flex flex-wrap items-center gap-2"
            aria-label={`Set ${n}`}
          >
            <span className="w-10 text-[var(--ink-faint)]">SET {n}</span>
            <CountFields
              set={set}
              label={`Set ${n} `}
              onChange={(next) => put(i, next)}
            />
            {i === 0 ? (
              <span className="w-24 text-center text-[var(--ink-faint)]">
                —
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span>load</span>
                <LoadStepInput
                  value={set.loadStepPercent}
                  onChange={(loadStepPercent) => put(i, { loadStepPercent })}
                  label={`Set ${n} load step percent`}
                />
                <span>%</span>
              </span>
            )}
            <span>rest</span>
            <input
              className={field}
              inputMode="numeric"
              placeholder="—"
              value={set.restSeconds ?? ""}
              onChange={(e) => put(i, { restSeconds: num(e.target.value) })}
              aria-label={`Set ${n} rest seconds`}
            />
            <span>s</span>
            {sets.length > 1 && (
              <button
                type="button"
                className="text-[var(--danger)]"
                onClick={() => onChange(sets.filter((_, at) => at !== i))}
                aria-label={`Remove set ${n}`}
              >
                ✕
              </button>
            )}
          </li>
        );
      })}
      <li>
        <button
          type="button"
          className="text-[11px] text-[var(--glow)]"
          onClick={() => {
            const last = sets[sets.length - 1];
            onChange([
              ...sets,
              last
                ? { ...last, loadStepPercent: null }
                : {
                    reps: 10,
                    repsMax: null,
                    toFailure: false,
                    loadStepPercent: null,
                    restSeconds: null,
                  },
            ]);
          }}
        >
          + ADD SET
        </button>
      </li>
    </ol>
  );
}

/** How a stored step reads in the box: "+5", "-10", "0", or empty. */
const stepText = (v: number | null) => (v === null ? "" : v > 0 ? `+${v}` : String(v));

/**
 * A load step, signed. It keeps what was typed while it is typed, because "-"
 * on its way to "-10" is no number yet, and a box that only held numbers
 * would drop the sign before the digits arrived.
 */
function LoadStepInput({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <input
      className={field}
      inputMode="text"
      placeholder="—"
      value={typed ?? stepText(value)}
      onChange={(e) => {
        setTyped(e.target.value);
        onChange(signed(e.target.value));
      }}
      onBlur={() => setTyped(null)}
      aria-label={label}
    />
  );
}

/** A set's count: a number, a range, or to failure (ADR 0005). */
function CountFields({
  set,
  label = "",
  onChange,
}: {
  set: Pick<DraftSet, "reps" | "repsMax" | "toFailure">;
  /** Prefixed to each field's name, so a row's fields say which set they are. */
  label?: string;
  onChange: (next: Pick<DraftSet, "reps" | "repsMax" | "toFailure">) => void;
}) {
  // "Reps" on its own, "Set 2 reps" on a row.
  const name = (what: string) => (label ? `${label}${what.toLowerCase()}` : what);
  return (
    <>
      {set.toFailure ? (
        <span className="text-[var(--glow)]">failure</span>
      ) : (
        <>
          <input
            className={field}
            inputMode="numeric"
            value={set.reps ?? ""}
            onChange={(e) => onChange({ ...set, reps: num(e.target.value) })}
            aria-label={name("Reps")}
          />
          <span>to</span>
          <input
            className={field}
            inputMode="numeric"
            placeholder="—"
            value={set.repsMax ?? ""}
            onChange={(e) =>
              onChange({ ...set, repsMax: num(e.target.value) })
            }
            aria-label={name("Reps up to")}
          />
        </>
      )}
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={set.toFailure}
          aria-label={label ? name("To failure") : undefined}
          onChange={(e) =>
            onChange({
              toFailure: e.target.checked,
              reps: e.target.checked ? null : 10,
              repsMax: null,
            })
          }
        />
        failure
      </label>
    </>
  );
}
