import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { defaultRoutineSummary } from "@regimen-works/shared";
import { ApiError, api, type ApiExercise } from "../lib/api";
import { lineLabel } from "../lib/progressions";
import { WEEKDAYS } from "../lib/weekdays";
import {
  EMPTY_ROUTINE,
  blankLine,
  copyDay,
  draftProblems,
  duplicateLine,
  formatRest,
  formatScheme,
  groupMates,
  lineMovementName,
  lineProblems,
  searchExercises,
  toCreateRoutine,
  trainingDays,
  type DraftLine,
  type RoutineDraft,
} from "../lib/routineDraft";

/**
 * Writing a routine (DN-145): the week sheet DN-137 settled on.
 *
 * All seven weekdays on one sheet. A day with nothing on it reads "Rest" and
 * is saved as no day at all. There is no length here -- the week repeats, and
 * how many weeks to run it is asked when the athlete starts it.
 *
 * Reached from the Library and from the setup wizard's "Build your own".
 * `?from=setup` is the second, and saving goes back to the picker with the
 * new routine chosen rather than to the list.
 */

const mono = { fontFamily: "var(--font-mono)" } as const;
const display = { fontFamily: "var(--font-display)" } as const;

export function RoutineEditorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const fromSetup = params.get("from") === "setup";
  const back = fromSetup ? "/setup" : "/library/routines";

  const { data: library = [] } = useQuery({
    queryKey: ["exercises"],
    queryFn: api.exercises,
  });

  const [draft, setDraft] = useState<RoutineDraft>(EMPTY_ROUTINE);
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [copying, setCopying] = useState<number | null>(null);

  const days = trainingDays(draft);
  const problems = draftProblems(draft);

  const save = useMutation({
    mutationFn: () => api.createRoutine(toCreateRoutine(draft)),
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["routines"] }),
        // Refetched now, not on the wizard's next mount: the wizard seeds its
        // answers from the first options it renders, and those have to
        // include the routine it is being handed back.
        queryClient.invalidateQueries({
          queryKey: ["setup"],
          refetchType: "all",
        }),
      ]);
      if (fromSetup) {
        navigate("/setup", { state: { planId: created.id } });
      } else {
        navigate("/library/routines");
      }
    },
  });

  const putLines = (day: number, lines: DraftLine[]) =>
    setDraft((d) => ({ ...d, days: { ...d.days, [day]: lines } }));
  const putLine = (day: number, line: DraftLine) =>
    putLines(
      day,
      (draft.days[day] ?? []).map((l) => (l.id === line.id ? line : l)),
    );

  return (
    <div className="mx-auto max-w-md p-6 pb-32">
      <Link to={back} className="text-xs text-[var(--ink-faint)]" style={mono}>
        ← CANCEL
      </Link>

      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Name this routine"
        aria-label="Routine name"
        className="mt-4 w-full border-b border-[var(--border)] bg-transparent pb-1 text-2xl font-bold text-[var(--ink)] outline-none"
        style={display}
      />
      <input
        value={draft.summary}
        onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
        placeholder={
          days.length > 0
            ? defaultRoutineSummary(draft.scheduleMode, days)
            : "One line about it (optional)"
        }
        aria-label="Summary"
        maxLength={140}
        className="mt-3 w-full border-b border-[var(--border)] bg-transparent pb-1 text-sm text-[var(--ink-soft)] outline-none"
      />

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
                    library={library}
                    open={open === line.id}
                    picking={picking === line.id}
                    onToggle={() => setOpen(open === line.id ? null : line.id)}
                    onPick={(on) => setPicking(on ? line.id : null)}
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
                : "Couldn't save the routine."}
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
            disabled={problems.length > 0 || save.isPending}
            onClick={() => save.mutate()}
            className="w-full py-3 text-sm font-semibold uppercase tracking-[0.1em] disabled:opacity-40"
            style={{ ...mono, background: "var(--glow)", color: "var(--bg)" }}
          >
            {save.isPending ? "Saving…" : "Save routine"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function LineRow({
  line,
  library,
  open,
  picking,
  onToggle,
  onPick,
  onChange,
  onDuplicate,
  onRemove,
}: {
  line: DraftLine;
  library: ApiExercise[];
  open: boolean;
  picking: boolean;
  onToggle: () => void;
  onPick: (on: boolean) => void;
  onChange: (line: DraftLine) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const problems = lineProblems(line);
  const unit = library.find((e) => e.id === line.exerciseId)?.unit ?? "reps";
  return (
    <li className="border-t border-[var(--border)] py-1.5 first:border-t-0">
      <button
        type="button"
        className="flex w-full items-baseline gap-2 text-left"
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
              library={library}
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
 * Search first (DN-137): type what you call it, get the library's rows, and
 * see what each would swap to. Beneath each grouped row, the other way to
 * write a line -- any member of the group, resolved by the athlete's kit.
 */
function MovementPicker({
  library,
  onPick,
  onClose,
}: {
  library: ApiExercise[];
  onPick: (choice: Pick<DraftLine, "exerciseId" | "movementGroup">) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const hits = searchExercises(query, library).slice(0, 12);
  return (
    <div className="mt-2 border border-[var(--glow-dim)] bg-[var(--bg)] p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movements"
          aria-label="Search movements"
          className="flex-1 border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-sm text-[var(--ink)]"
        />
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-[var(--ink-faint)]"
        >
          close
        </button>
      </div>
      {query.trim() !== "" && hits.length === 0 && (
        <p className="mt-2 text-xs text-[var(--danger)]">
          Nothing in the library is “{query}”. Add it to your movements first,
          or pick the nearest.
        </p>
      )}
      <ul className="mt-2 max-h-64 overflow-auto">
        {hits.map((e, i) => {
          const mates = groupMates(e, library);
          return (
            <li key={e.id} className="border-t border-[var(--border)] py-2">
              <button
                type="button"
                className="w-full text-left"
                onClick={() =>
                  onPick({ exerciseId: e.id, movementGroup: null })
                }
              >
                <span className="text-sm text-[var(--ink)]">{e.name}</span>
                {i === 0 && query.trim() !== "" && (
                  <span
                    className="ml-2 text-[10px] text-[var(--glow)]"
                    style={mono}
                  >
                    BEST MATCH
                  </span>
                )}
                <span className="block text-[11px] text-[var(--ink-faint)]">
                  {mates.length > 0
                    ? `Swaps with ${mates
                        .slice(0, 3)
                        .map((m) => m.name)
                        .join(", ")}`
                    : "No swaps"}
                  {e.equipment.length
                    ? ` · needs ${e.equipment.join(", ")}`
                    : ""}
                </span>
              </button>
              {e.movementGroup && (
                <button
                  type="button"
                  className="mt-1 text-[11px] text-[var(--glow)] underline"
                  onClick={() =>
                    onPick({
                      exerciseId: null,
                      movementGroup:
                        e.movementGroup as DraftLine["movementGroup"],
                    })
                  }
                >
                  or: any {lineLabel(e.movementGroup).toLowerCase()}, chosen by
                  my equipment
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SchemeFields({
  line,
  onChange,
}: {
  line: DraftLine;
  onChange: (line: DraftLine) => void;
}) {
  // Whole numbers only: anything else reads as blank, which the line then
  // reports as missing rather than saving as NaN.
  const num = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
  const field =
    "w-14 border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-center text-sm text-[var(--ink)]";
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-soft)]"
      style={mono}
    >
      <input
        className={field}
        inputMode="numeric"
        value={line.sets ?? ""}
        onChange={(e) => onChange({ ...line, sets: num(e.target.value) })}
        aria-label="Sets"
      />
      <span>×</span>
      {line.toFailure ? (
        <span className="text-[var(--glow)]">failure</span>
      ) : (
        <>
          <input
            className={field}
            inputMode="numeric"
            value={line.reps ?? ""}
            onChange={(e) => onChange({ ...line, reps: num(e.target.value) })}
            aria-label="Reps"
          />
          <span>to</span>
          <input
            className={field}
            inputMode="numeric"
            placeholder="—"
            value={line.repsMax ?? ""}
            onChange={(e) =>
              onChange({ ...line, repsMax: num(e.target.value) })
            }
            aria-label="Reps up to"
          />
        </>
      )}
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={line.toFailure}
          onChange={(e) =>
            onChange({
              ...line,
              toFailure: e.target.checked,
              reps: e.target.checked ? null : 10,
              repsMax: null,
            })
          }
        />
        failure
      </label>
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
