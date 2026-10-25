import type { ReactNode } from "react";
import { defaultProgramSummary } from "@regimen-works/shared";
import { pickedDays, type ProgramDraft } from "../../lib/programDraft";
import { WEEKDAYS } from "../../lib/weekdays";
import { caption, display, mono } from "./chrome";

const box =
  "mt-2 w-full border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-[var(--ink)] outline-none";

/**
 * Step 1 (DN-193): the name, the line about it, the days it trains on, and
 * whether those are fixed weekdays or any N days in order. The days picked
 * here are the steps that follow.
 */
export function BasicsStep({
  draft,
  onChange,
  onPickDay,
  notes,
  publish,
}: {
  draft: ProgramDraft;
  onChange: (draft: ProgramDraft) => void;
  onPickDay: (day: number, on: boolean) => void;
  /** Pasted, copied, or global: said on the page the wizard opens on. */
  notes: ReactNode;
  /** The admin's "publish to the global library", where it is offered. */
  publish: ReactNode;
}) {
  const days = pickedDays(draft);
  const sorted = [...days].sort((a, b) => a - b);
  return (
    <>
      <h1 className="mt-8 text-4xl font-bold text-[var(--ink)]" style={display}>
        The basics
      </h1>
      {notes}

      <label className="mt-6 block">
        <span className={caption} style={mono}>
          NAME
        </span>
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="Name this program"
          aria-label="Program name"
          className={`${box} text-2xl font-bold`}
          style={display}
        />
      </label>

      <label className="mt-5 block">
        <span className={caption} style={mono}>
          DESCRIPTION · OPTIONAL
        </span>
        <textarea
          value={draft.summary}
          onChange={(e) => onChange({ ...draft, summary: e.target.value })}
          placeholder={
            days.length > 0
              ? defaultProgramSummary(draft.scheduleMode, sorted)
              : "One line about it"
          }
          aria-label="Summary"
          maxLength={140}
          rows={2}
          className={`${box} resize-none text-base`}
        />
      </label>

      <fieldset className="mt-5">
        <legend className={caption} style={mono}>
          TRAINING DAYS
        </legend>
        <div className="mt-2 grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map(({ value, short }) => {
            const on = days.includes(value);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => onPickDay(value, !on)}
                className="py-3 text-xs uppercase"
                style={{
                  ...mono,
                  border: `1px ${on ? "solid" : "dashed"} ${on ? "var(--glow)" : "var(--border)"}`,
                  background: on ? "var(--panel)" : "transparent",
                  color: on ? "var(--glow)" : "var(--ink-soft)",
                }}
              >
                {short}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          {days.length === 0
            ? "Pick the days you train. You build each one next."
            : `${days.length} training ${days.length === 1 ? "day" : "days"}. You build each one next; the rest are rest days.`}
        </p>
      </fieldset>

      {/* Fixed vs flexible, without the words (DN-137). */}
      <fieldset className="mt-5">
        <legend className={caption} style={mono}>
          WHEN YOU TRAIN THEM
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {(
            [
              ["fixed", "On these weekdays", "Same days every week"],
              [
                "flexible",
                days.length === 1 ? "Any 1 day a week" : `Any ${days.length || "N"} days a week`,
                "In order, whenever you can",
              ],
            ] as const
          ).map(([mode, title, sub]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={draft.scheduleMode === mode}
              onClick={() => onChange({ ...draft, scheduleMode: mode })}
              className="border p-3 text-left"
              style={{
                borderColor: draft.scheduleMode === mode ? "var(--glow)" : "var(--border)",
                background: draft.scheduleMode === mode ? "var(--panel)" : "transparent",
                color: draft.scheduleMode === mode ? "var(--ink)" : "var(--ink-soft)",
              }}
            >
              <span className="block">{title}</span>
              <span className="block text-[12px] text-[var(--ink-faint)]">{sub}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {publish}
    </>
  );
}
