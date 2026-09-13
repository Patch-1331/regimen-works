import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SkillLevel } from "@regimen-works/shared";
import { api, type ApiExercise } from "../lib/api";
import {
  buildMovementChoices,
  lineLabel,
  type MovementChoice,
} from "../lib/progressions";
import { Panel, SectionLabel } from "./Panel";

/**
 * What the athlete has chosen, per movement group (DN-91).
 *
 * This replaced a ladder per line marked done / current / locked. Those words
 * describe an assessment — you graduated past this, you are not allowed that
 * yet — and the app no longer makes one. What is left is what is true: the
 * movement you picked, and the rest of the group in case you want a different
 * one.
 *
 * Tappable here as well as on the plate, because this is the screen you are on
 * when you are thinking about it rather than about to train.
 */
export function MovementChoicesPanel({
  exercises,
  skillLevels,
}: {
  exercises: ApiExercise[];
  skillLevels: SkillLevel[];
}) {
  const queryClient = useQueryClient();
  const [openLine, setOpenLine] = useState<string | null>(null);

  const choose = useMutation({
    mutationFn: ({ line, rung }: { line: string; rung: number }) =>
      api.setSkillLevel(line, { rung }),
    onSuccess: async () => {
      setOpenLine(null);
      await queryClient.invalidateQueries({ queryKey: ["skillLevels"] });
      // Today's plate resolves through this choice, so it has to be re-derived.
      await queryClient.invalidateQueries({ queryKey: ["today"] });
    },
  });

  const choices = buildMovementChoices(exercises, skillLevels);

  // One entry per line the athlete has chosen on, so a new athlete has none
  // (DN-86 — nobody is provisioned onto a movement any more). A bare heading
  // over nothing would read like something failed to load.
  if (choices.length === 0) {
    return (
      <>
        <SectionLabel>YOUR MOVEMENTS</SectionLabel>
        <Panel>
          <p className="text-sm leading-relaxed text-[var(--ink-faint)]">
            Nothing here yet — your workouts come exactly as written. Swap a
            movement before a session and what you picked is remembered here.
          </p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <SectionLabel>YOUR MOVEMENTS</SectionLabel>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {choices.map((choice) => (
          <MovementChoiceCard
            key={choice.line}
            choice={choice}
            open={openLine === choice.line}
            isSaving={choose.isPending}
            onToggle={() =>
              setOpenLine(openLine === choice.line ? null : choice.line)
            }
            onPick={(rung) => choose.mutate({ line: choice.line, rung })}
          />
        ))}
      </div>
    </>
  );
}

function MovementChoiceCard({
  choice,
  open,
  isSaving,
  onToggle,
  onPick,
}: {
  choice: MovementChoice;
  open: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onPick: (rung: number) => void;
}) {
  const panelId = `movement-choice-${choice.line}`;
  const label = lineLabel(choice.line);

  return (
    <div className="p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span
            className="block text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}
          >
            {label}
          </span>
          <span className="mt-1 block truncate text-sm font-bold text-[var(--ink)]">
            {/* Null only on a data gap — a stored rung with nothing seeded at
                it. Saying so beats naming the wrong movement. */}
            {choice.chosenName ?? "Not on the current library"}
          </span>
        </span>
        <span
          className="shrink-0 text-[10px] tracking-[0.1em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {open ? "CLOSE" : "CHANGE"}
        </span>
      </button>

      {open && (
        <ul id={panelId} className="mt-3 flex flex-col gap-1">
          {choice.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => onPick(option.rung)}
                disabled={isSaving || option.isChosen}
                aria-current={option.isChosen}
                className="flex w-full items-center gap-2 py-1.5 text-left"
              >
                <ChoiceMark chosen={option.isChosen} />
                <span
                  className="truncate text-xs"
                  style={{
                    color: option.isChosen ? "var(--ink)" : "var(--ink-soft)",
                    fontWeight: option.isChosen ? 700 : 400,
                  }}
                >
                  {option.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Marks the chosen movement by shape as well as colour — a filled glowing dot
 * against an empty one. Every other movement is simply unmarked: there is no
 * third state now that nothing is cleared or closed off.
 */
function ChoiceMark({ chosen }: { chosen: boolean }) {
  if (chosen) {
    return (
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: "var(--glow)", boxShadow: "0 0 6px var(--glow)" }}
      />
    );
  }
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ border: "1.5px solid var(--border)" }} />;
}
