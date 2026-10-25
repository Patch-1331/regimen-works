import { useState } from "react";
import {
  SET_PRESETS,
  applyPreset,
  toPerSet,
  toSameForAll,
  type DraftLine,
  type DraftSet,
} from "../../lib/programDraft";
import { mono } from "./chrome";

// Whole numbers only: anything else reads as blank, which the line then
// reports as missing rather than saving as NaN.
const num = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
// A load step is signed: "-10", "+5", "0". A true minus sign counts too.
const signed = (v: string) => {
  const t = v.trim().replace("−", "-").replace(/%$/, "");
  return /^[+-]?\d+$/.test(t) ? Number(t) : null;
};
const field =
  "w-14 border border-[var(--border)] bg-[var(--panel)] px-1 py-1 text-center text-sm text-[var(--ink)]";
const bigField =
  "w-full border border-[var(--border)] bg-[var(--panel)] px-1 py-3 text-center text-xl font-bold text-[var(--ink)]";
const caption = "block text-[11px] tracking-[0.14em] text-[var(--ink-faint)]";

/**
 * How much of the movement, and how it is rested. "Same for all sets" is the
 * default; "set by set" and the presets write each set on its own row (ADR
 * 0011). A preset only fills the rows -- its name is not kept.
 */
export function SchemeFields({
  line,
  onChange,
}: {
  line: DraftLine;
  onChange: (line: DraftLine) => void;
}) {
  const perSet = line.perSet;
  return (
    <div className="mt-5 text-xs text-[var(--ink-soft)]">
      <div className="grid grid-cols-2" role="group" aria-label="How the sets are written">
        {(
          [
            ["Same for all sets", perSet === null, () => onChange(toSameForAll(line))],
            ["Set by set", perSet !== null, () => onChange(toPerSet(line))],
          ] as const
        ).map(([label, on, pick]) => (
          <button
            key={label}
            type="button"
            aria-pressed={on}
            onClick={pick}
            className="border py-2.5 text-sm"
            style={{
              borderColor: on ? "var(--glow)" : "var(--border)",
              color: on ? "var(--glow)" : "var(--ink-soft)",
              background: on ? "var(--panel)" : "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {perSet === null ? (
        <SameForAllFields line={line} onChange={onChange} />
      ) : (
        <PerSetFields sets={perSet} onChange={(sets) => onChange({ ...line, perSet: sets })} />
      )}
      <div
        className="mt-6 flex flex-wrap items-center gap-2 text-sm"
        role="group"
        aria-label="Fill sets from a preset"
      >
        <span className={`${caption} w-full`} style={mono}>
          OR START FROM A PRESET
        </span>
        {SET_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(applyPreset(line, preset.id))}
            className="border border-[var(--border)] px-3 py-2 text-[var(--ink-soft)]"
          >
            {preset.label}
          </button>
        ))}
      </div>
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
    <div className="mt-5" style={mono}>
      <div className="grid grid-cols-3 gap-2">
        <label>
          <span className={caption}>SETS</span>
          <input
            className={`${bigField} mt-1`}
            inputMode="numeric"
            value={line.sets ?? ""}
            onChange={(e) => onChange({ ...line, sets: num(e.target.value) })}
            aria-label="Sets"
          />
        </label>
        <div>
          <span className={caption}>REPS</span>
          {line.toFailure ? (
            <span className={`${bigField} mt-1 block text-[var(--glow)]`}>failure</span>
          ) : (
            <div className="mt-1 flex items-center gap-1">
              <input
                className={bigField}
                inputMode="numeric"
                value={line.reps ?? ""}
                onChange={(e) => onChange({ ...line, reps: num(e.target.value) })}
                aria-label="Reps"
              />
              <span aria-hidden>–</span>
              <input
                className={bigField}
                inputMode="numeric"
                placeholder="—"
                value={line.repsMax ?? ""}
                onChange={(e) => onChange({ ...line, repsMax: num(e.target.value) })}
                aria-label="Reps up to"
              />
            </div>
          )}
        </div>
        <label>
          <span className={caption}>REST · SEC</span>
          <input
            className={`${bigField} mt-1`}
            inputMode="numeric"
            placeholder="—"
            value={line.restSeconds ?? ""}
            onChange={(e) => onChange({ ...line, restSeconds: num(e.target.value) })}
            aria-label="Rest seconds"
          />
        </label>
      </div>
      <label
        className="mt-4 flex items-center gap-3 text-sm text-[var(--ink-soft)]"
        style={{ fontFamily: "inherit" }}
      >
        <input
          type="checkbox"
          className="h-5 w-5"
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
        Every set to failure
      </label>
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
    <ol className="mt-4 flex flex-col gap-2" style={mono}>
      {sets.map((set, i) => {
        const n = i + 1;
        return (
          <li
            key={i}
            className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-2"
            aria-label={`Set ${n}`}
          >
            <span className="w-10 text-[var(--ink-faint)]">SET {n}</span>
            <CountFields set={set} label={`Set ${n} `} onChange={(next) => put(i, next)} />
            {i === 0 ? (
              <span className="w-24 text-center text-[var(--ink-faint)]">—</span>
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
  label,
  onChange,
}: {
  set: Pick<DraftSet, "reps" | "repsMax" | "toFailure">;
  /** Prefixed to each field's name, so a row's fields say which set they are. */
  label: string;
  onChange: (next: Pick<DraftSet, "reps" | "repsMax" | "toFailure">) => void;
}) {
  const name = (what: string) => `${label}${what.toLowerCase()}`;
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
            onChange={(e) => onChange({ ...set, repsMax: num(e.target.value) })}
            aria-label={name("Reps up to")}
          />
        </>
      )}
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={set.toFailure}
          aria-label={name("To failure")}
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
