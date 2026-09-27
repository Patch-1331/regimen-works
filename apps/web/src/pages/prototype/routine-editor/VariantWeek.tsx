/**
 * PROTOTYPE — DN-137, variant A: "The week sheet".
 *
 * Stance: the week is the unit. All seven weekdays on one scrolling sheet,
 * Monday next to Thursday. A day with nothing on it IS a rest day — there is
 * no rest slot to add. Movements are picked by searching what the routine
 * calls them. Repetition is "copy this day to…" and "duplicate this line".
 * Length is not asked here; it belongs at enrolment next to the start date.
 */
import { useState } from "react";
import type { ApiExercise } from "../../../lib/api";
import {
  Caps, SchemeFields, SearchPicker, StatePanel, WEEKDAYS, WEEK_ORDER, blankRx, cloneItems,
  display, formatRest, formatScheme, mono, movementName, problemsOf, uid, unitOf,
  type Day, type Draft, type Rx,
} from "./shared";

export const name = "Week sheet";

/** Seven weekday slots, whatever the draft holds. */
function weekOf(draft: Draft): Day[] {
  return WEEK_ORDER.map(
    (wd) => draft.days.find((d) => d.weekday === wd) ?? { id: `empty-${wd}`, name: "", weekday: wd, items: [] },
  );
}

export function VariantWeek({ library, seed }: { library: ApiExercise[]; seed: Draft }) {
  const [draft, setDraft] = useState<Draft>(seed);
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [copying, setCopying] = useState<number | null>(null);

  const week = weekOf(draft);
  const trainingDays = week.filter((d) => d.items.length > 0);

  const putDay = (day: Day) =>
    setDraft((d) => ({
      ...d,
      days: [...d.days.filter((x) => x.weekday !== day.weekday), { ...day, id: day.id.startsWith("empty") ? uid() : day.id }]
        .filter((x) => x.items.length > 0 || x.name),
    }));
  const putRx = (day: Day, rx: Rx) => putDay({ ...day, items: day.items.map((r) => (r.id === rx.id ? rx : r)) });

  return (
    <div className="px-4 pb-4">
      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Name this routine"
        className="mt-2 w-full border-b border-[var(--border)] bg-transparent pb-1 text-2xl font-bold text-[var(--ink)] outline-none"
        style={display}
      />

      {/* Fixed vs flexible, without the words. */}
      <div className="mt-4 border border-[var(--border)] bg-[var(--panel)] p-3">
        <Caps>WHEN YOU TRAIN THEM</Caps>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {[
            [true, "On these weekdays", "Chest is always Monday"],
            [false, `Any ${trainingDays.length} days a week`, "In this order, whenever you can"],
          ].map(([val, title, sub]) => (
            <button
              key={String(val)}
              onClick={() => setDraft({ ...draft, pinned: val as boolean })}
              className={`border p-2 text-left ${draft.pinned === val ? "border-[var(--glow)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--ink-faint)]"}`}
            >
              <span className="block">{title as string}</span>
              <span className="block text-[11px] text-[var(--ink-faint)]">{sub as string}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {week.map((day, i) => {
          const rest = day.items.length === 0;
          const label = draft.pinned ? WEEKDAYS[day.weekday!] : rest ? "—" : `Day ${trainingDays.indexOf(day) + 1}`;
          return (
            <section key={day.weekday} className={`border ${rest ? "border-dashed border-[var(--border)]" : "border-[var(--border)] bg-[var(--panel)]"} p-3`}>
              <header className="flex items-baseline gap-3">
                <span className="w-10 text-xs text-[var(--glow)]" style={mono}>{label.toUpperCase()}</span>
                {rest ? (
                  <span className="flex-1 text-sm text-[var(--ink-faint)]">Rest</span>
                ) : (
                  <input
                    value={day.name}
                    onChange={(e) => putDay({ ...day, name: e.target.value })}
                    className="flex-1 bg-transparent text-base font-semibold text-[var(--ink)] outline-none"
                    style={display}
                  />
                )}
                {!rest && (
                  <button onClick={() => setCopying(copying === i ? null : i)} className="text-[11px] text-[var(--ink-soft)]" style={mono}>
                    COPY TO…
                  </button>
                )}
              </header>

              {copying === i && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {week.filter((d) => d.weekday !== day.weekday).map((target) => (
                    <button
                      key={target.weekday}
                      onClick={() => {
                        putDay({ ...target, name: day.name, items: cloneItems(day.items) });
                        setCopying(null);
                      }}
                      className="border border-[var(--border)] px-2 py-1 text-xs text-[var(--ink-soft)]"
                    >
                      {WEEKDAYS[target.weekday!]}{target.items.length ? " (replace)" : ""}
                    </button>
                  ))}
                </div>
              )}

              <ul className="mt-1">
                {day.items.map((rx) => {
                  const problems = problemsOf(rx);
                  return (
                    <li key={rx.id} className="border-t border-[var(--border)] py-1.5 first:border-t-0">
                      <button className="flex w-full items-baseline gap-2 text-left" onClick={() => setOpen(open === rx.id ? null : rx.id)}>
                        <span className={`flex-1 text-sm ${problems.length ? "text-[var(--danger)]" : "text-[var(--ink)]"}`}>
                          {problems.length ? "✕ " : ""}{movementName(rx, library)}
                        </span>
                        <span className="text-xs text-[var(--ink-soft)]" style={mono}>{formatScheme(rx, unitOf(rx, library))}</span>
                        <span className="w-24 text-right text-[11px] text-[var(--ink-faint)]" style={mono}>{formatRest(rx)}</span>
                      </button>
                      {rx.droppedLoad && (
                        <p className="text-[11px] text-[var(--ink-faint)]">Load “{rx.droppedLoad}” dropped — the app doesn't track weight.</p>
                      )}
                      {open === rx.id && (
                        <div className="pb-2">
                          {problems.map((p) => <p key={p} className="mt-1 text-[11px] text-[var(--danger)]">{p}</p>)}
                          <button onClick={() => setPicking(rx.id)} className="mt-1 text-xs text-[var(--glow)] underline">
                            {rx.exerciseId || rx.group ? "Change movement" : "Choose movement"}
                          </button>
                          {picking === rx.id && (
                            <SearchPicker
                              library={library}
                              initial={rx.source || ""}
                              onClose={() => setPicking(null)}
                              onPick={(p) => { putRx(day, { ...rx, ...p }); setPicking(null); }}
                            />
                          )}
                          <SchemeFields rx={rx} onChange={(r) => putRx(day, r)} />
                          <div className="mt-2 flex gap-3 text-[11px]" style={mono}>
                            <button className="text-[var(--ink-soft)]" onClick={() => {
                              const at = day.items.indexOf(rx);
                              const items = [...day.items];
                              items.splice(at + 1, 0, { ...rx, id: uid() });
                              putDay({ ...day, items });
                            }}>DUPLICATE LINE</button>
                            <button className="text-[var(--danger)]" onClick={() => putDay({ ...day, items: day.items.filter((r) => r.id !== rx.id) })}>REMOVE</button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              <button
                onClick={() => {
                  const rx = blankRx();
                  putDay({ ...day, name: day.name || "New day", items: [...day.items, rx] });
                  setOpen(rx.id);
                  setPicking(rx.id);
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
        No length here: this week repeats. You choose how many weeks — or none — when you start it, next to the start date.
      </p>
      <StatePanel draft={draft} library={library} />
    </div>
  );
}
