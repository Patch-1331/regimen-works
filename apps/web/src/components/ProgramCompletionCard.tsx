/**
 * The program that just finished, above Today (DN-18).
 *
 * The day after a program's last day, the run is retired and Just WODs
 * resumes, so there is always a workout on the screen underneath this. That
 * is the rule this card is built around: **a prompt never blocks a workout.**
 * It is not a modal, it does not cover the day, and ignoring it entirely
 * still gets the athlete training.
 *
 * The figures are the ones snapshotted when the run ended, not recomputed
 * here — what the athlete finished should not change afterwards because the
 * library did.
 *
 * Two offers and no default. "Run it again" is the same program at the same
 * length from today, which needs no questions because none of them have new
 * answers. "See what's next" is the wizard, which is the program picker. And
 * dismissing is a third real answer: an athlete who wants neither should be
 * able to say so once and have the screen stay said.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { CompletedProgram } from "@regimen-works/shared";
import { api } from "../lib/api";
import { summaryText } from "../lib/program-summary";

export function ProgramCompletionCard({ program }: { program: CompletedProgram }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Today carries the card, so every answer to it invalidates today. The
  // Completed list keeps the record either way and is refreshed for the same
  // reason: running it again adds a row to nothing, but dismissing on one
  // screen should not leave a stale list on another.
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["today"] }),
      queryClient.invalidateQueries({ queryKey: ["completed-programs"] }),
    ]);
  }

  const dismiss = useMutation({
    mutationFn: () => api.dismissCompletedProgram(program.enrollmentId),
    onSuccess: refresh,
  });
  const runAgain = useMutation({
    mutationFn: () => api.runProgramAgain(program.enrollmentId),
    onSuccess: refresh,
  });
  const busy = dismiss.isPending || runAgain.isPending;

  return (
    <section
      aria-label={`${program.planName} complete`}
      className="mb-5 rounded-sm p-4"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--glow)",
        boxShadow: "0 0 12px var(--glow-tint)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--glow)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {program.planName} complete
        </h2>
        <button
          onClick={() => dismiss.mutate()}
          disabled={busy}
          aria-label="Dismiss"
          className="shrink-0 px-1 text-sm leading-none text-[var(--ink-faint)]"
        >
          ✕
        </button>
      </div>

      <p className="mt-2 text-sm text-[var(--ink-soft)]">
        {summaryText(program)}
      </p>

      <div className="mt-4 flex gap-2.5">
        <button
          onClick={() => runAgain.mutate()}
          disabled={busy}
          className="flex-1 rounded-sm py-2.5 text-center text-xs font-semibold tracking-[0.14em]"
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--glow)",
            color: "var(--panel)",
          }}
        >
          RUN IT AGAIN
        </button>
        <button
          onClick={() => navigate("/setup")}
          disabled={busy}
          className="flex-1 rounded-sm border border-[var(--ink-faint)] py-2.5 text-center text-xs font-semibold tracking-[0.14em] text-[var(--ink)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          SEE WHAT'S NEXT
        </button>
      </div>

      {(dismiss.isError || runAgain.isError) && (
        <p className="mt-3 text-sm text-[var(--danger)]">
          Couldn't reach the API — your program is still finished, try that
          again.
        </p>
      )}
    </section>
  );
}
