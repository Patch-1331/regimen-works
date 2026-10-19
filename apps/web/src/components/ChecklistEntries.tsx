import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  movementPattern,
  type AthleteChecklistEntry,
  type ChecklistKind,
  type MovementPattern,
} from "@regimen-works/shared";
import { api } from "../lib/api";
import { patternLabel } from "../lib/progressions";

/*
 * The athlete's own warm-up and cool-down entries (DN-173). Added from a
 * movement's page, ordered and removed from Settings. The global lists are
 * the seed's and never appear here (ADR-0010): what an athlete writes adds
 * to them, ahead of them on the day.
 */

export const CHECKLIST_ENTRIES_KEY = ["checklist-entries"] as const;

export const KIND_LABEL: Record<ChecklistKind, string> = {
  warmup: "Warm-up",
  cooldown: "Cool-down",
};

/** "Push days", or "Any day" for filler. */
export function dayLabel(pattern: MovementPattern | null): string {
  return pattern === null ? "Any day" : `${patternLabel(pattern)} days`;
}

/** Everything the screens read changes together: the lists and today's checklists. */
function useInvalidateChecklists() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: CHECKLIST_ENTRIES_KEY }),
      queryClient.invalidateQueries({ queryKey: ["today"] }),
    ]);
}

export function useChecklistEntries() {
  return useQuery({ queryKey: CHECKLIST_ENTRIES_KEY, queryFn: api.checklistEntries });
}

export function useRemoveChecklistEntry() {
  const invalidate = useInvalidateChecklists();
  return useMutation({ mutationFn: api.removeChecklistEntry, onSuccess: invalidate });
}

const field = "mt-1 w-full px-3 py-2 text-sm";
const fieldStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  color: "var(--ink)",
  fontFamily: "var(--font-mono)",
};
const mono = { fontFamily: "var(--font-mono)" };

export function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)] disabled:opacity-50"
      style={{ ...mono, border: "1px solid var(--border)" }}
    >
      Remove
    </button>
  );
}

/**
 * The exercise page's half: which of the athlete's lists this movement is on,
 * and a form to put it on another. No add for a retired movement, which the
 * API would refuse: a retired movement drops off every list anyway.
 */
export function ExerciseChecklists({
  exercise,
}: {
  exercise: { id: string; name: string; pattern: string | null; archivedAt: string | null };
}) {
  const { data: entries } = useChecklistEntries();
  const remove = useRemoveChecklistEntry();
  const invalidate = useInvalidateChecklists();

  const ownPattern = movementPattern.safeParse(exercise.pattern);
  const [kind, setKind] = useState<ChecklistKind>("warmup");
  // The movement's own pattern is the likeliest day for it, but only a
  // default: what a movement prepares is not always what it loads (ADR-0008).
  const [pattern, setPattern] = useState<MovementPattern | null>(
    ownPattern.success ? ownPattern.data : null,
  );

  const add = useMutation({
    mutationFn: () => api.addChecklistEntry({ exerciseId: exercise.id, kind, pattern }),
    onSuccess: invalidate,
  });

  const mine = (entries ?? []).filter((e) => e.exercise.id === exercise.id);

  return (
    <section aria-labelledby="exercise-checklists-heading">
      <p
        id="exercise-checklists-heading"
        className="mt-8 text-xs font-semibold tracking-[0.14em] text-[var(--ink-faint)]"
        style={mono}
      >
        YOUR WARM-UP &amp; COOL-DOWN
      </p>

      {entries && mine.length === 0 && (
        <p className="mt-2 text-[13px] text-[var(--ink-faint)]">Not on your warm-up or cool-down.</p>
      )}
      {mine.length > 0 && (
        <ul aria-label="On your lists" className="mt-2 space-y-1">
          {mine.map((entry) => {
            const label = `${KIND_LABEL[entry.kind]} · ${dayLabel(entry.pattern)}`;
            return (
              <li key={entry.id} className="flex items-center justify-between gap-3 text-[14px]">
                <span className="text-[var(--ink)]">{label}</span>
                <RemoveButton
                  label={`Remove from ${label}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(entry.id)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {exercise.archivedAt === null && (
        <form
          className="mt-3 grid grid-cols-2 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <label className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]" style={mono}>
            List
            <select
              className={field}
              style={fieldStyle}
              value={kind}
              onChange={(e) => setKind(e.target.value as ChecklistKind)}
            >
              <option value="warmup">{KIND_LABEL.warmup}</option>
              <option value="cooldown">{KIND_LABEL.cooldown}</option>
            </select>
          </label>
          <label className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]" style={mono}>
            Day
            <select
              className={field}
              style={fieldStyle}
              value={pattern ?? ""}
              onChange={(e) =>
                setPattern(e.target.value === "" ? null : (e.target.value as MovementPattern))
              }
            >
              <option value="">Any day</option>
              {movementPattern.options.map((p) => (
                <option key={p} value={p}>
                  {dayLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={add.isPending}
            className="col-span-2 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] disabled:opacity-50"
            style={{ background: "var(--glow)", color: "var(--panel)", ...mono }}
          >
            {add.isPending ? "Adding…" : "Add to my list"}
          </button>
          {add.error && (
            <p role="alert" className="col-span-2 text-[13px] text-[var(--danger)]">
              {add.error.message}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

/**
 * Settings' half: each of the athlete's lists in the order the checklist
 * shows them, with move up, move down and remove. Each move sends the whole
 * list in its new order; the API refuses one sent from a stale screen.
 */
export function MyChecklistsSetting() {
  const { data: entries } = useChecklistEntries();
  const remove = useRemoveChecklistEntry();
  const invalidate = useInvalidateChecklists();
  const reorder = useMutation({ mutationFn: api.reorderChecklistEntries, onSuccess: invalidate });
  const busy = remove.isPending || reorder.isPending;

  function move(list: AthleteChecklistEntry[], index: number, by: -1 | 1) {
    const ids = list.map((e) => e.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    reorder.mutate({ kind: list[0].kind, entryIds: ids });
  }

  return (
    <section
      aria-labelledby="my-checklists-heading"
      className="p-4"
      style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
    >
      <h2 id="my-checklists-heading" className="font-semibold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        My warm-up &amp; cool-down
      </h2>
      <p className="mt-1 text-xs text-[var(--ink-faint)]">
        Your own movements come first on the day, in this order. Add one from any movement's page in the library.
      </p>

      {(["warmup", "cooldown"] as const).map((kind) => {
        const list = (entries ?? []).filter((e) => e.kind === kind);
        return (
          <div key={kind} className="mt-4">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]" style={mono}>
              {KIND_LABEL[kind]}
            </p>
            {entries && list.length === 0 && (
              <p className="mt-1 text-[13px] text-[var(--ink-faint)]">Nothing of your own yet.</p>
            )}
            {list.length > 0 && (
              <ol aria-label={`My ${KIND_LABEL[kind].toLowerCase()}`} className="mt-1 flex flex-col">
                {list.map((entry, i) => (
                  <li key={entry.id} className="flex items-center gap-2 py-1.5 text-[14px]">
                    <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
                      {entry.exercise.name}
                      <span className="ml-2 text-[11px] text-[var(--ink-faint)]" style={mono}>
                        {dayLabel(entry.pattern)}
                      </span>
                    </span>
                    <ArrowButton
                      label={`Move ${entry.exercise.name} up`}
                      disabled={busy || i === 0}
                      onClick={() => move(list, i, -1)}
                      glyph="↑"
                    />
                    <ArrowButton
                      label={`Move ${entry.exercise.name} down`}
                      disabled={busy || i === list.length - 1}
                      onClick={() => move(list, i, 1)}
                      glyph="↓"
                    />
                    <RemoveButton
                      label={`Remove ${entry.exercise.name} from ${KIND_LABEL[kind].toLowerCase()}`}
                      disabled={busy}
                      onClick={() => remove.mutate(entry.id)}
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}

      {(reorder.error ?? remove.error) && (
        <p role="alert" className="mt-3 text-[13px] text-[var(--danger)]">
          {(reorder.error ?? remove.error)?.message}
        </p>
      )}
    </section>
  );
}

function ArrowButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--ink-soft)] disabled:opacity-30"
      style={{ border: "1px solid var(--border)" }}
    >
      {glyph}
    </button>
  );
}
