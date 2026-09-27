/**
 * PROTOTYPE — DN-137, variant B: "Split builder".
 *
 * Stance: the *day* is the unit, and days are named splits before they are
 * dates. Four steps: name your days → fill one day at a time → say when they
 * land → say how long. Rest days are whatever weekdays you did not assign.
 * Movements are picked group-first ("what kind of movement?"), then
 * optionally narrowed to one exercise — the opposite of variant A's search.
 * Length IS asked in the editor, to feel the difference.
 */
import { useState } from "react";
import type { ApiExercise } from "../../../lib/api";
import {
  Caps, GROUP_LABELS, SchemeFields, StatePanel, WEEKDAYS, WEEK_ORDER, blankRx, cloneItems,
  display, formatRest, formatScheme, mono, movementName, problemsOf, uid, unitOf,
  type Draft, type Rx,
} from "./shared";

export const name = "Split builder";

const STEPS = ["Days", "Movements", "When", "How long"] as const;

function GroupPicker({ library, rx, onPick }: { library: ApiExercise[]; rx: Rx; onPick: (p: Partial<Rx>) => void }) {
  const [group, setGroup] = useState<string | null>(rx.group ?? library.find((e) => e.id === rx.exerciseId)?.movementGroup ?? null);
  const members = library.filter((e) => e.movementGroup === group);
  const loners = library.filter((e) => !e.movementGroup);
  return (
    <div className="mt-2 border border-[var(--glow-dim)] bg-[var(--bg)] p-3">
      {rx.source && <p className="mb-2 text-[11px] text-[var(--ink-faint)]">The routine says: “{rx.source}”</p>}
      <Caps>WHAT KIND OF MOVEMENT?</Caps>
      <div className="mt-2 grid grid-cols-1 gap-1">
        {Object.entries(GROUP_LABELS).map(([g, label]) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={`border px-2 py-1.5 text-left text-xs ${group === g ? "border-[var(--glow)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--ink-soft)]"}`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setGroup("__none")}
          className={`border px-2 py-1.5 text-left text-xs ${group === "__none" ? "border-[var(--glow)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--ink-soft)]"}`}
        >
          Something else — a movement with no substitutes
        </button>
      </div>
      {group && group !== "__none" && (
        <div className="mt-3">
          <button onClick={() => onPick({ group, exerciseId: null })} className="w-full border border-[var(--glow)] bg-[var(--glow-tint)] px-2 py-2 text-left text-sm text-[var(--ink)]">
            Whichever my equipment allows
            <span className="block text-[11px] text-[var(--ink-faint)]">Today picks from: {members.map((m) => m.name).join(", ")}</span>
          </button>
          <Caps>OR EXACTLY</Caps>
          <div className="mt-1 flex flex-wrap gap-1">
            {members.map((e) => (
              <button key={e.id} onClick={() => onPick({ exerciseId: e.id, group: null })} className="border border-[var(--border)] px-2 py-1 text-xs text-[var(--ink-soft)]">
                {e.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {group === "__none" && (
        <div className="mt-3 flex flex-wrap gap-1">
          {loners.map((e) => (
            <button key={e.id} onClick={() => onPick({ exerciseId: e.id, group: null })} className="border border-[var(--border)] px-2 py-1 text-xs text-[var(--ink-soft)]">
              {e.name}
            </button>
          ))}
          <p className="mt-2 w-full text-[11px] text-[var(--danger)]">
            Not here? The library has no curl, raise, shrug or fly yet. The app won't stand one in for another — leave it out for now.
          </p>
        </div>
      )}
    </div>
  );
}

export function VariantDays({ library, seed }: { library: ApiExercise[]; seed: Draft }) {
  const [draft, setDraft] = useState<Draft>(seed);
  const [step, setStep] = useState(0);
  const [dayIdx, setDayIdx] = useState(0);
  const [picking, setPicking] = useState<string | null>(null);

  const day = draft.days[dayIdx];
  const putItems = (items: Rx[]) =>
    setDraft((d) => ({ ...d, days: d.days.map((x, i) => (i === dayIdx ? { ...x, items } : x)) }));
  const putRx = (rx: Rx) => putItems(day.items.map((r) => (r.id === rx.id ? rx : r)));

  return (
    <div className="px-4 pb-4">
      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Name this routine"
        className="mt-2 w-full border-b border-[var(--border)] bg-transparent pb-1 text-2xl font-bold text-[var(--ink)] outline-none"
        style={display}
      />

      <nav className="mt-4 grid grid-cols-4 gap-1">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => setStep(i)} className={`border-b-2 pb-1 text-[11px] ${step === i ? "border-[var(--glow)] text-[var(--glow)]" : "border-[var(--border)] text-[var(--ink-faint)]"}`} style={mono}>
            {i + 1}. {s.toUpperCase()}
          </button>
        ))}
      </nav>

      {step === 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-[var(--ink-soft)]">What are your training days called? Push, Pull, Legs — or just Day 1.</p>
          {draft.days.map((d, i) => (
            <div key={d.id} className="flex items-center gap-2 border border-[var(--border)] bg-[var(--panel)] p-2">
              <span className="w-6 text-xs text-[var(--glow)]" style={mono}>{i + 1}</span>
              <input
                value={d.name}
                onChange={(e) => setDraft({ ...draft, days: draft.days.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)) })}
                className="flex-1 bg-transparent text-sm text-[var(--ink)] outline-none"
              />
              <span className="text-[11px] text-[var(--ink-faint)]" style={mono}>{d.items.length} mvts</span>
              <button className="text-[11px] text-[var(--ink-soft)]" style={mono} onClick={() => setDraft({ ...draft, days: [...draft.days, { ...d, id: uid(), name: `${d.name} (copy)`, weekday: null, items: cloneItems(d.items) }] })}>
                DUPLICATE
              </button>
              <button className="text-[11px] text-[var(--danger)]" style={mono} onClick={() => setDraft({ ...draft, days: draft.days.filter((x) => x.id !== d.id) })}>✕</button>
            </div>
          ))}
          <button className="text-xs text-[var(--ink-faint)]" style={mono} onClick={() => setDraft({ ...draft, days: [...draft.days, { id: uid(), name: `Day ${draft.days.length + 1}`, weekday: null, items: [] }] })}>
            + ADD A DAY
          </button>
        </div>
      )}

      {step === 1 && day && (
        <div className="mt-4">
          <div className="flex gap-1 overflow-x-auto pb-1">
            {draft.days.map((d, i) => (
              <button key={d.id} onClick={() => setDayIdx(i)} className={`shrink-0 border px-2 py-1 text-xs ${i === dayIdx ? "border-[var(--glow)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--ink-faint)]"}`}>
                {d.name}
              </button>
            ))}
          </div>
          <h2 className="mt-3 text-xl font-bold text-[var(--ink)]" style={display}>{day.name}</h2>
          <ol className="mt-2 space-y-2">
            {day.items.map((rx, i) => {
              const problems = problemsOf(rx);
              return (
                <li key={rx.id} className={`border p-3 ${problems.length ? "border-[var(--danger)]" : "border-[var(--border)]"} bg-[var(--panel)]`}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-[var(--glow)]" style={mono}>{i + 1}</span>
                    <button onClick={() => setPicking(picking === rx.id ? null : rx.id)} className="flex-1 text-left text-base text-[var(--ink)]">
                      {movementName(rx, library)}
                    </button>
                    <span className="text-xs text-[var(--ink-soft)]" style={mono}>{formatScheme(rx, unitOf(rx, library))} · {formatRest(rx)}</span>
                  </div>
                  {rx.droppedLoad && <p className="text-[11px] text-[var(--ink-faint)]">Load “{rx.droppedLoad}” dropped — the app doesn't track weight.</p>}
                  {problems.map((p) => <p key={p} className="mt-1 text-[11px] text-[var(--danger)]">{p}</p>)}
                  {picking === rx.id && <GroupPicker library={library} rx={rx} onPick={(p) => { putRx({ ...rx, ...p }); setPicking(null); }} />}
                  <SchemeFields rx={rx} onChange={putRx} />
                  <div className="mt-2 flex gap-3 text-[11px]" style={mono}>
                    <button className="text-[var(--ink-soft)]" onClick={() => { const items = [...day.items]; items.splice(i + 1, 0, { ...rx, id: uid() }); putItems(items); }}>SAME AGAIN</button>
                    <button className="text-[var(--danger)]" onClick={() => putItems(day.items.filter((r) => r.id !== rx.id))}>REMOVE</button>
                  </div>
                </li>
              );
            })}
          </ol>
          <button className="mt-2 text-xs text-[var(--ink-faint)]" style={mono} onClick={() => { const rx = blankRx(); putItems([...day.items, rx]); setPicking(rx.id); }}>
            + ADD MOVEMENT
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="mt-4">
          <Caps>DO THESE DAYS HAVE TO FALL ON PARTICULAR WEEKDAYS?</Caps>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <button onClick={() => setDraft({ ...draft, pinned: true })} className={`border p-2 text-left ${draft.pinned ? "border-[var(--glow)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--ink-faint)]"}`}>
              Yes — pin each one
            </button>
            <button onClick={() => setDraft({ ...draft, pinned: false, days: draft.days.map((d) => ({ ...d, weekday: null })) })} className={`border p-2 text-left ${!draft.pinned ? "border-[var(--glow)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--ink-faint)]"}`}>
              No — any {draft.days.length} days, in order
            </button>
          </div>
          {draft.pinned ? (
            <table className="mt-4 w-full text-xs">
              <thead>
                <tr>
                  <th />
                  {WEEK_ORDER.map((wd) => <th key={wd} className="pb-1 text-[var(--ink-faint)]" style={mono}>{WEEKDAYS[wd][0]}</th>)}
                </tr>
              </thead>
              <tbody>
                {draft.days.map((d) => (
                  <tr key={d.id} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-2 text-[var(--ink)]">{d.name}</td>
                    {WEEK_ORDER.map((wd) => {
                      const takenBy = draft.days.find((x) => x.weekday === wd);
                      const mine = d.weekday === wd;
                      return (
                        <td key={wd} className="text-center">
                          <button
                            disabled={!!takenBy && !mine}
                            onClick={() => setDraft({ ...draft, days: draft.days.map((x) => (x.id === d.id ? { ...x, weekday: mine ? null : wd } : x)) })}
                            className={`h-6 w-6 border ${mine ? "border-[var(--glow)] bg-[var(--glow)]" : takenBy ? "border-transparent opacity-20" : "border-[var(--border)]"}`}
                            aria-label={`${d.name} on ${WEEKDAYS[wd]}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t border-[var(--border)]">
                  <td className="py-2 text-[var(--ink-faint)]">Rest</td>
                  {WEEK_ORDER.map((wd) => (
                    <td key={wd} className="text-center text-[var(--ink-faint)]">{draft.days.some((x) => x.weekday === wd) ? "" : "·"}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="mt-4 text-sm text-[var(--ink-soft)]">
              You'll pick which {draft.days.length} weekdays when you start it. The days run in the order above; everything else is rest.
            </p>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="mt-4 space-y-2">
          <Caps>HOW LONG DOES IT RUN?</Caps>
          <button onClick={() => setDraft({ ...draft, weeks: null })} className={`block w-full border p-2 text-left text-sm ${draft.weeks === null ? "border-[var(--glow)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--ink-faint)]"}`}>
            Until I stop it
          </button>
          <div className={`flex items-center gap-2 border p-2 text-sm ${draft.weeks !== null ? "border-[var(--glow)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--ink-faint)]"}`}>
            <button onClick={() => setDraft({ ...draft, weeks: draft.weeks ?? 8 })}>For</button>
            <input
              value={draft.weeks ?? ""}
              onFocus={() => draft.weeks === null && setDraft({ ...draft, weeks: 8 })}
              onChange={(e) => setDraft({ ...draft, weeks: e.target.value === "" ? null : Number(e.target.value) })}
              className="w-12 border border-[var(--border)] bg-[var(--panel)] px-1 text-center"
            />
            <span>weeks</span>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-between text-xs" style={mono}>
        <button disabled={step === 0} onClick={() => setStep(step - 1)} className="text-[var(--ink-faint)] disabled:opacity-30">← BACK</button>
        <button disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)} className="text-[var(--glow)] disabled:opacity-30">NEXT →</button>
      </div>
      <StatePanel draft={draft} library={library} />
    </div>
  );
}
