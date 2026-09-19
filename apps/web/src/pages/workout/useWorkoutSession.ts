import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useWakeLock } from "../../lib/useWakeLock";
import { finishCue } from "../../lib/cues";

/**
 * Everything the workout screens share regardless of format: today's WOD,
 * the session (started on arrival if there isn't one), the wake lock, and
 * the finish/cancel actions behind the top bar.
 *
 * The per-format screens own the clock itself — the round-tap stopwatch and
 * the interval countdown tick at different rates and cue different things.
 */
export function useWorkoutSession(assignmentId: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The same cached query TodayPage uses.
  const { data: today, isLoading } = useQuery({ queryKey: ["today"], queryFn: api.today });

  const startMutation = useMutation({
    mutationFn: () => api.startSession(assignmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today"] }),
  });

  const assignment = today?.assignment;
  const session = assignment?.session ?? null;
  const startedSession = startMutation.data;

  // Kick off a session the first time this screen is reached without one.
  useEffect(() => {
    if (assignmentId && !session && !startMutation.isPending && !startedSession) {
      startMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, session]);

  const activeSession = session ?? startedSession ?? null;
  const isFinished = activeSession?.status === "completed";

  useWakeLock(!isFinished && activeSession !== null);

  const hasCooldown = today?.warmupCooldownEnabled && (today?.cooldown?.length ?? 0) > 0;

  const finishMutation = useMutation({
    mutationFn: () => api.finishSession(assignmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["today"] });
      finishCue();
      // Every finished session lets out at the log, whichever runner produced
      // it (DN-126). A straight-sets day used to end on Today instead, because
      // there was nothing there to write -- that hole is closed, and both kinds
      // of day now end with the athlete saying how it went.
      navigate(
        hasCooldown ? `/cooldown/${assignmentId}` : `/log/${assignmentId}`,
      );
    },
  });

  /**
   * Stopping at the time cap is a finish like any other, minus the navigation:
   * the athlete didn't ask to leave the screen, and a capped workout usually
   * has a last round to read off it before logging. Reaching the cap posts
   * this; the screen then shows the clock stopped and offers LOG RESULT.
   */
  const stopAtCapMutation = useMutation({
    mutationFn: () => api.finishSession(assignmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today"] }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelSession(assignmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["today"] });
      navigate("/");
    },
  });

  return {
    isLoading,
    wod: assignment?.wod ?? null,
    session: activeSession,
    isFinished,
    finish: () => finishMutation.mutate(),
    finishPending: finishMutation.isPending,
    stopAtCap: () => stopAtCapMutation.mutate(),
    cancel: () => cancelMutation.mutate(),
    cancelPending: cancelMutation.isPending,
  };
}

/** A `Date.now()` that re-renders every `everyMs` while `active`. */
export function useNow(everyMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs, active]);

  return now;
}
