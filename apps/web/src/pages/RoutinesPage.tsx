import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { GlobalRoutineSummary, RoutineSummary } from "@regimen-works/shared";
import { ApiError, api, type LibraryTier } from "../lib/api";
import { LibraryNav } from "../components/LibraryNav";
import { SectionLabel } from "../components/Panel";
import { WEEKDAYS } from "../lib/weekdays";
import { saveJson } from "../lib/download";

/**
 * "My routines" (DN-145): what this athlete has written, live first and
 * archived after. The curated programs are not listed -- they are not yours
 * -- and the setup picker is where every program you can run is offered.
 *
 * "Remove" archives and "Restore" brings back (DN-147). Nothing is deleted:
 * a removed routine keeps every run on it, including one under way.
 *
 * An admin also sees the global library below their own, with the same
 * actions, and can publish one of their own routines into it (DN-148).
 * `isAdmin` decides only what is rendered; every admin route refuses
 * anyone else on its own.
 *
 * Everyone else sees the live global routines as "From the library", each
 * with "Copy" -- a new routine of their own, filled from it (DN-149). An
 * admin copies from their global list instead of a second one.
 */
export function RoutinesPage() {
  const queryClient = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const isAdmin = me?.isAdmin === true;
  const { data: routines, isLoading, error } = useQuery({
    queryKey: ["routines"],
    queryFn: api.routines,
  });
  const { data: global, error: globalError } = useQuery({
    queryKey: ["globalRoutines"],
    queryFn: api.globalRoutines,
    enabled: isAdmin,
  });
  const { data: copyable, error: copyableError } = useQuery({
    queryKey: ["copyableRoutines"],
    queryFn: api.copyableRoutines,
    enabled: me !== undefined && !isAdmin,
  });
  // What the last action did, said once beneath the button.
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Publishing is one-way, so it asks first, on the row itself.
  const [confirming, setConfirming] = useState<string | null>(null);

  const starting = () => {
    setNotice(null);
    setFailure(null);
  };
  const settled = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["routines"] }),
      queryClient.invalidateQueries({ queryKey: ["globalRoutines"] }),
      queryClient.invalidateQueries({ queryKey: ["routine"] }),
      queryClient.invalidateQueries({ queryKey: ["setup"] }),
    ]);
  };
  const nameOf = (id: string) =>
    [...(routines ?? []), ...(global ?? [])].find((r) => r.id === id)?.name;

  const remove = useMutation({
    mutationFn: ({ tier, id }: { tier: LibraryTier; id: string }) =>
      api.archiveRoutine(tier, id),
    onMutate: starting,
    onSuccess: async ({ routine, running }) => {
      setNotice(
        running
          ? `Removed ${routine.name}. Your run of it carries on to its end; it just won't be offered again.`
          : `Removed ${routine.name}. Restore it below if you want it back.`,
      );
      await settled();
    },
    onError: (e) => setFailure(messageOf(e, "Couldn't remove the routine.")),
  });
  const restore = useMutation({
    mutationFn: ({ tier, id }: { tier: LibraryTier; id: string }) =>
      api.restoreRoutine(tier, id),
    onMutate: starting,
    onSuccess: async (routine) => {
      setNotice(`Restored ${routine.name}.`);
      await settled();
    },
    onError: (e, { tier, id }) => {
      const name = nameOf(id);
      setFailure(
        e instanceof ApiError && e.status === 409 && name
          ? tier === "global"
            ? `Another global routine is called ${name} now. Rename that one first, then restore this.`
            : `Another of your routines is called ${name} now. Rename that one first, then restore this.`
          : messageOf(e, "Couldn't restore the routine."),
      );
    },
  });
  const promote = useMutation({
    mutationFn: api.promoteRoutine,
    onMutate: starting,
    onSuccess: async (routine) => {
      setConfirming(null);
      setNotice(`Published ${routine.name}. Every athlete is offered it now.`);
      await settled();
    },
    onError: (e) => {
      setConfirming(null);
      setFailure(messageOf(e, "Couldn't publish the routine."));
    },
  });
  const busy = remove.isPending || restore.isPending || promote.isPending;

  const live = routines?.filter((r) => !r.archived) ?? [];
  const archived = routines?.filter((r) => r.archived) ?? [];

  return (
    <div className="p-6">
      <h1
        className="text-3xl font-extrabold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        Library
      </h1>
      <LibraryNav />

      <Link
        to="/library/routines/new"
        className="mt-5 block w-full py-3 text-center text-sm font-semibold uppercase tracking-[0.1em]"
        style={{
          fontFamily: "var(--font-mono)",
          border: "1px solid var(--glow)",
          color: "var(--glow)",
        }}
      >
        + New routine
      </Link>
      <Link
        to="/library/routines/paste"
        className="mt-2 block text-center text-xs text-[var(--ink-soft)] underline"
      >
        Or paste one in from elsewhere
      </Link>

      {error && (
        <p className="mt-4 text-sm text-[var(--danger)]">
          Couldn't load your routines.
        </p>
      )}
      {notice && (
        <p className="mt-4 text-sm text-[var(--ink-soft)]" role="status">
          {notice}
        </p>
      )}
      {failure && (
        <p className="mt-4 text-sm text-[var(--danger)]" role="alert">
          {failure}
        </p>
      )}
      {!isLoading && routines?.length === 0 && (
        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          Nothing yet. A routine is one week of training that repeats — write
          the days you train and what you do on them.
        </p>
      )}
      {live.length > 0 && (
        <RoutineList>
          {live.map((routine) => (
            <RoutineRow key={routine.id} routine={routine}>
              {confirming === routine.id ? (
                <>
                  <span className="normal-case tracking-normal text-[var(--ink-soft)]">
                    Publish for every athlete? There's no taking it back.
                  </span>
                  <Action
                    label={`Confirm publishing ${routine.name}`}
                    disabled={busy}
                    onClick={() => promote.mutate(routine.id)}
                  >
                    Publish
                  </Action>
                  <Action
                    label="Keep it mine"
                    disabled={busy}
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </Action>
                </>
              ) : (
                <>
                  <Link
                    to={`/library/routines/${routine.id}/edit`}
                    aria-label={`Edit ${routine.name}`}
                  >
                    Edit
                  </Link>
                  {isAdmin && (
                    <Action
                      label={`Publish ${routine.name}`}
                      disabled={busy}
                      onClick={() => {
                        starting();
                        setConfirming(routine.id);
                      }}
                    >
                      Publish
                    </Action>
                  )}
                  <Action
                    label={`Remove ${routine.name}`}
                    disabled={busy}
                    onClick={() => remove.mutate({ tier: "own", id: routine.id })}
                  >
                    Remove
                  </Action>
                </>
              )}
            </RoutineRow>
          ))}
        </RoutineList>
      )}

      {archived.length > 0 && (
        <>
          <SectionLabel>ARCHIVED</SectionLabel>
          <RoutineList>
            {archived.map((routine) => (
              <RoutineRow key={routine.id} routine={routine}>
                <Action
                  label={`Restore ${routine.name}`}
                  disabled={busy}
                  onClick={() => restore.mutate({ tier: "own", id: routine.id })}
                >
                  Restore
                </Action>
              </RoutineRow>
            ))}
          </RoutineList>
        </>
      )}

      {!isAdmin && (copyableError || (copyable?.length ?? 0) > 0) && (
        <section aria-label="From the library">
          <SectionLabel>FROM THE LIBRARY</SectionLabel>
          <p className="mt-1 text-[12px] text-[var(--ink-faint)]">
            Copy one to make it yours — change anything, and the library's
            stays as it is.
          </p>
          {copyableError && (
            <p className="mt-3 text-sm text-[var(--danger)]">
              Couldn't load the library.
            </p>
          )}
          {copyable && (
            <RoutineList>
              {copyable.map((routine) => (
                <RoutineRow key={routine.id} routine={routine}>
                  <CopyLink routine={routine} />
                </RoutineRow>
              ))}
            </RoutineList>
          )}
        </section>
      )}

      {isAdmin && (
        <GlobalLibrary
          routines={global}
          failed={globalError !== null}
          busy={busy}
          onRemove={(id) => remove.mutate({ tier: "global", id })}
          onRestore={(id) => restore.mutate({ tier: "global", id })}
        />
      )}
    </div>
  );
}

/**
 * The admin's half (DN-148): every global routine, live then archived. Just
 * WODs is listed so the library reads whole, marked built in and offered
 * nothing -- every route refuses it anyway.
 *
 * Ticking routines and exporting them saves one file (DN-150), which
 * `npm run routines:import` in the API loads back into an empty library.
 */
function GlobalLibrary({
  routines,
  failed,
  busy,
  onRemove,
  onRestore,
}: {
  routines: GlobalRoutineSummary[] | undefined;
  failed: boolean;
  busy: boolean;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const exportable = routines?.filter((r) => !r.builtIn) ?? [];
  // A routine that has left the list since it was ticked is not exported.
  const chosen = exportable.filter((r) => ticked.has(r.id)).map((r) => r.id);
  const exporting = useMutation({
    mutationFn: () => api.exportRoutines(chosen),
    onSuccess: (file) => {
      saveJson(
        `regimen-works-routines-${new Date().toISOString().slice(0, 10)}.json`,
        file,
      );
      setTicked(new Set());
    },
  });
  const tick = (id: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <section aria-label="Global library">
      <SectionLabel>GLOBAL LIBRARY</SectionLabel>
      <p className="mt-1 text-[12px] text-[var(--ink-faint)]">
        Offered to every athlete. Write one with “publish” ticked, or publish
        one of yours above.
      </p>
      {failed && (
        <p className="mt-3 text-sm text-[var(--danger)]">
          Couldn't load the global library.
        </p>
      )}
      {exportable.length > 0 && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <button
            type="button"
            disabled={chosen.length === 0 || exporting.isPending}
            onClick={() => exporting.mutate()}
            className="text-[11px] uppercase tracking-[0.14em] text-[var(--glow)] disabled:opacity-50"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {chosen.length === 0
              ? "Tick routines to export"
              : `Export ${chosen.length} routine${chosen.length === 1 ? "" : "s"}`}
          </button>
          {exporting.error && (
            <span className="text-sm text-[var(--danger)]" role="alert">
              {messageOf(exporting.error, "Couldn't export the routines.")}
            </span>
          )}
        </div>
      )}
      {routines && (
        <RoutineList>
          {routines.map((routine) => (
            <RoutineRow key={routine.id} routine={routine}>
              {!routine.builtIn && (
                <input
                  type="checkbox"
                  aria-label={`Include ${routine.name} in the export`}
                  checked={ticked.has(routine.id)}
                  onChange={(e) => tick(routine.id, e.target.checked)}
                />
              )}
              {routine.builtIn ? (
                <span>Built in</span>
              ) : routine.archived ? (
                <Action
                  label={`Restore ${routine.name}`}
                  disabled={busy}
                  onClick={() => onRestore(routine.id)}
                >
                  Restore
                </Action>
              ) : (
                <>
                  <CopyLink routine={routine} />
                  <Link
                    to={`/library/routines/global/${routine.id}/edit`}
                    aria-label={`Edit ${routine.name}`}
                  >
                    Edit
                  </Link>
                  <Action
                    label={`Remove ${routine.name}`}
                    disabled={busy}
                    onClick={() => onRemove(routine.id)}
                  >
                    Remove
                  </Action>
                </>
              )}
            </RoutineRow>
          ))}
        </RoutineList>
      )}
    </section>
  );
}

function CopyLink({ routine }: { routine: RoutineSummary }) {
  return (
    <Link
      to={`/library/routines/new?copy=${encodeURIComponent(routine.id)}`}
      aria-label={`Copy ${routine.name} to my routines`}
    >
      Copy
    </Link>
  );
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function Action({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="uppercase disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RoutineList({ children }: { children: ReactNode }) {
  return (
    <ul
      className="mt-3"
      style={{ border: "1px solid var(--border)", background: "var(--panel)" }}
    >
      {children}
    </ul>
  );
}

function RoutineRow({
  routine,
  children,
}: {
  routine: RoutineSummary;
  children: ReactNode;
}) {
  const days =
    routine.scheduleMode === "flexible"
      ? `Any ${routine.days.length} day${routine.days.length === 1 ? "" : "s"} a week`
      : WEEKDAYS.filter((d) => routine.days.includes(d.value))
          .map((d) => d.short)
          .join(" · ");
  return (
    <li
      className="px-4 py-3"
      style={{
        borderTop: "1px solid var(--border)",
        opacity: routine.archived ? 0.7 : 1,
      }}
    >
      <span
        className="block font-semibold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        {routine.name}
      </span>
      <span className="mt-1 block text-sm text-[var(--ink-soft)]">
        {routine.summary}
      </span>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span
          className="text-[11px] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {days}
        </span>
        <span
          className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {children}
        </span>
      </div>
    </li>
  );
}
