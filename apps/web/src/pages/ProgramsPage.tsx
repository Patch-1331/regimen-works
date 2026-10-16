import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  DEFAULT_PROGRAM_ID,
  type GlobalProgramSummary,
  type ProgramRun,
  type ProgramSummary,
} from "@regimen-works/shared";
import { ApiError, api, type LibraryTier } from "../lib/api";
import { SectionLabel } from "../components/Panel";
import { WEEKDAYS } from "../lib/weekdays";
import { saveJson } from "../lib/download";
import { shortDate } from "../lib/movementHistory";
import { currentRunLine, pastRunLine } from "../lib/programRuns";

/**
 * The Programs tab (DN-179, ADR 0009 decisions 2 and 5): what is driving the
 * week, everything there is to start, and what came before. Top to bottom:
 *
 * - The run under way, and for Just WODs, plainly that no program is.
 * - Just WODs, pinned, as the "no program" choice.
 * - "Your programs" (DN-145): what this athlete has written, live first and
 *   archived after. "Remove" archives and "Restore" brings back (DN-147);
 *   nothing is deleted, and a removed program keeps every run on it.
 * - The library. Everyone but an admin sees the live global programs as
 *   "From the library", each with "Copy" -- a new program of their own,
 *   filled from it (DN-149). An admin sees the whole global library instead,
 *   with the same actions, and can publish one of their own into it (DN-148).
 *   `isAdmin` decides only what is rendered; every admin route refuses anyone
 *   else on its own.
 * - Writing or pasting a new one.
 * - Past runs, finished and ended, newest first. Never Just WODs.
 *
 * Everything startable carries a Start (DN-180): Just WODs, the athlete's
 * live programs, and the live library. Never the current run, which is
 * already started, and never anything archived, which is not offered.
 * Start opens the wizard's own steps at `/programs/:id/start`.
 */
export function ProgramsPage() {
  const queryClient = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const isAdmin = me?.isAdmin === true;
  const { data: runs, error: runsError } = useQuery({
    queryKey: ["programRuns"],
    queryFn: api.programRuns,
  });
  // Just WODs' own name and summary, as the wizard offers it.
  const { data: setup } = useQuery({ queryKey: ["setup"], queryFn: api.setup });
  const justWods = setup?.programs.find((p) => p.id === DEFAULT_PROGRAM_ID);
  const { data: programs, isLoading, error } = useQuery({
    queryKey: ["programs"],
    queryFn: api.programs,
  });
  const { data: global, error: globalError } = useQuery({
    queryKey: ["globalPrograms"],
    queryFn: api.globalPrograms,
    enabled: isAdmin,
  });
  const { data: copyable, error: copyableError } = useQuery({
    queryKey: ["copyablePrograms"],
    queryFn: api.copyablePrograms,
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
      queryClient.invalidateQueries({ queryKey: ["programs"] }),
      queryClient.invalidateQueries({ queryKey: ["globalPrograms"] }),
      queryClient.invalidateQueries({ queryKey: ["program"] }),
      queryClient.invalidateQueries({ queryKey: ["setup"] }),
    ]);
  };
  const nameOf = (id: string) =>
    [...(programs ?? []), ...(global ?? [])].find((r) => r.id === id)?.name;

  const remove = useMutation({
    mutationFn: ({ tier, id }: { tier: LibraryTier; id: string }) =>
      api.archiveProgram(tier, id),
    onMutate: starting,
    onSuccess: async ({ program, running }) => {
      setNotice(
        running
          ? `Removed ${program.name}. Your run of it carries on to its end; it just won't be offered again.`
          : `Removed ${program.name}. Restore it below if you want it back.`,
      );
      await settled();
    },
    onError: (e) => setFailure(messageOf(e, "Couldn't remove the program.")),
  });
  const restore = useMutation({
    mutationFn: ({ tier, id }: { tier: LibraryTier; id: string }) =>
      api.restoreProgram(tier, id),
    onMutate: starting,
    onSuccess: async (program) => {
      setNotice(`Restored ${program.name}.`);
      await settled();
    },
    onError: (e, { tier, id }) => {
      const name = nameOf(id);
      setFailure(
        e instanceof ApiError && e.status === 409 && name
          ? tier === "global"
            ? `Another global program is called ${name} now. Rename that one first, then restore this.`
            : `Another of your programs is called ${name} now. Rename that one first, then restore this.`
          : messageOf(e, "Couldn't restore the program."),
      );
    },
  });
  const promote = useMutation({
    mutationFn: api.promoteProgram,
    onMutate: starting,
    onSuccess: async (program) => {
      setConfirming(null);
      setNotice(`Published ${program.name}. Every athlete is offered it now.`);
      await settled();
    },
    onError: (e) => {
      setConfirming(null);
      setFailure(messageOf(e, "Couldn't publish the program."));
    },
  });
  const busy = remove.isPending || restore.isPending || promote.isPending;

  const live = programs?.filter((r) => !r.archived) ?? [];
  const archived = programs?.filter((r) => r.archived) ?? [];
  const onJustWods = runs?.current?.programId === DEFAULT_PROGRAM_ID;
  // Held back until the runs are in, so the current run never flashes one.
  const startable = (id: string) =>
    runs !== undefined && runs.current?.programId !== id;

  return (
    <div className="p-6">
      <h1
        className="text-3xl font-extrabold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        Programs
      </h1>

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

      <section aria-label="Current run">
        <SectionLabel>NOW RUNNING</SectionLabel>
        {runsError && (
          <p className="mt-3 text-sm text-[var(--danger)]">
            Couldn't load your runs.
          </p>
        )}
        {runs && <CurrentRun run={runs.current} />}
      </section>

      {justWods && (
        <section aria-label="No program">
          <SectionLabel>NO PROGRAM</SectionLabel>
          <ul
            className="mt-3"
            style={{ border: "1px solid var(--border)", background: "var(--panel)" }}
          >
            <li className="px-4 py-3">
              <span
                className="block font-semibold uppercase"
                style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
              >
                {justWods.name}
              </span>
              <span className="mt-1 block text-sm text-[var(--ink-soft)]">
                {justWods.summary}
              </span>
              {onJustWods && (
                <span
                  className="mt-1 block text-[11px] uppercase tracking-[0.14em] text-[var(--glow)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  What you're on now
                </span>
              )}
              {startable(justWods.id) && (
                <span
                  className="mt-1 block text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  <StartLink id={justWods.id} name={justWods.name} />
                </span>
              )}
            </li>
          </ul>
        </section>
      )}

      <section aria-label="Your programs">
        <SectionLabel>YOUR PROGRAMS</SectionLabel>
        {error && (
          <p className="mt-3 text-sm text-[var(--danger)]">
            Couldn't load your programs.
          </p>
        )}
        {!isLoading && programs?.length === 0 && (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            Nothing yet. A program is one week of training that repeats — write
            the days you train and what you do on them.
          </p>
        )}
        {live.length > 0 && (
          <ProgramList>
            {live.map((program) => (
              <ProgramRow key={program.id} program={program}>
                {confirming === program.id ? (
                  <>
                    <span className="normal-case tracking-normal text-[var(--ink-soft)]">
                      Publish for every athlete? There's no taking it back.
                    </span>
                    <Action
                      label={`Confirm publishing ${program.name}`}
                      disabled={busy}
                      onClick={() => promote.mutate(program.id)}
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
                    {startable(program.id) && (
                      <StartLink id={program.id} name={program.name} />
                    )}
                    <Link
                      to={`/programs/${program.id}/edit`}
                      aria-label={`Edit ${program.name}`}
                    >
                      Edit
                    </Link>
                    {isAdmin && (
                      <Action
                        label={`Publish ${program.name}`}
                        disabled={busy}
                        onClick={() => {
                          starting();
                          setConfirming(program.id);
                        }}
                      >
                        Publish
                      </Action>
                    )}
                    <Action
                      label={`Remove ${program.name}`}
                      disabled={busy}
                      onClick={() => remove.mutate({ tier: "own", id: program.id })}
                    >
                      Remove
                    </Action>
                  </>
                )}
              </ProgramRow>
            ))}
          </ProgramList>
        )}

        {archived.length > 0 && (
          <>
            <SectionLabel>ARCHIVED</SectionLabel>
            <ProgramList>
              {archived.map((program) => (
                <ProgramRow key={program.id} program={program}>
                  <Action
                    label={`Restore ${program.name}`}
                    disabled={busy}
                    onClick={() => restore.mutate({ tier: "own", id: program.id })}
                  >
                    Restore
                  </Action>
                </ProgramRow>
              ))}
            </ProgramList>
          </>
        )}
      </section>

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
            <ProgramList>
              {copyable.map((program) => (
                <ProgramRow key={program.id} program={program}>
                  {startable(program.id) && (
                    <StartLink id={program.id} name={program.name} />
                  )}
                  <CopyLink program={program} />
                </ProgramRow>
              ))}
            </ProgramList>
          )}
        </section>
      )}

      {isAdmin && (
        <GlobalLibrary
          programs={global}
          failed={globalError !== null}
          busy={busy}
          startable={startable}
          onRemove={(id) => remove.mutate({ tier: "global", id })}
          onRestore={(id) => restore.mutate({ tier: "global", id })}
        />
      )}

      <Link
        to="/programs/new"
        className="mt-8 block w-full py-3 text-center text-sm font-semibold uppercase tracking-[0.1em]"
        style={{
          fontFamily: "var(--font-mono)",
          border: "1px solid var(--glow)",
          color: "var(--glow)",
        }}
      >
        + New program
      </Link>
      <Link
        to="/programs/paste"
        className="mt-2 block text-center text-xs text-[var(--ink-soft)] underline"
      >
        Or paste a program in
      </Link>

      {runs && (
        <section aria-label="Past runs">
          <SectionLabel>PAST RUNS</SectionLabel>
          {runs.past.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-soft)]">
              Nothing finished or ended yet.
            </p>
          ) : (
            <ProgramList>
              {runs.past.map((run) => (
                <PastRun key={run.enrollmentId} run={run} />
              ))}
            </ProgramList>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * The run under way. Just WODs is said for what it is -- no program -- rather
 * than dressed up with a week count that means nothing for it.
 */
function CurrentRun({ run }: { run: ProgramRun | null }) {
  if (run === null) {
    return (
      <p className="mt-3 text-sm text-[var(--ink-soft)]">
        Nothing is running. Pick something below to start the next run.
      </p>
    );
  }
  const justWods = run.programId === DEFAULT_PROGRAM_ID;
  return (
    <div
      className="mt-3 px-4 py-3"
      style={{ border: "1px solid var(--glow)", background: "var(--panel)" }}
    >
      <span
        className="block font-semibold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        {run.programName}
      </span>
      {justWods ? (
        <span className="mt-1 block text-sm text-[var(--ink-soft)]">
          No program is driving your week — Today picks a workout a day.
        </span>
      ) : (
        <>
          <span
            className="mt-1 block text-[11px] uppercase tracking-[0.14em] text-[var(--glow)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {currentRunLine(run)}
          </span>
          <span className="mt-1 block text-sm text-[var(--ink-soft)]">
            {run.programSummary}
          </span>
        </>
      )}
    </div>
  );
}

function PastRun({ run }: { run: ProgramRun }) {
  return (
    <li className="px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
      <span
        className="block font-semibold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        {run.programName}
      </span>
      <span
        className="mt-1 block text-[11px] text-[var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {pastRunLine(run)}
        {run.finishedAt && ` · ${shortDate(run.finishedAt.slice(0, 10))}`}
      </span>
    </li>
  );
}

/**
 * The admin's half (DN-148): every global program, live then archived. Just
 * WODs is listed so the library reads whole, marked built in and offered
 * nothing -- every route refuses it anyway.
 *
 * Ticking programs and exporting them saves one file (DN-150), which
 * `npm run programs:import` in the API loads back into an empty library.
 */
function GlobalLibrary({
  programs,
  failed,
  busy,
  startable,
  onRemove,
  onRestore,
}: {
  programs: GlobalProgramSummary[] | undefined;
  failed: boolean;
  busy: boolean;
  startable: (id: string) => boolean;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const exportable = programs?.filter((r) => !r.builtIn) ?? [];
  // A program that has left the list since it was ticked is not exported.
  const chosen = exportable.filter((r) => ticked.has(r.id)).map((r) => r.id);
  const exporting = useMutation({
    mutationFn: () => api.exportPrograms(chosen),
    onSuccess: (file) => {
      saveJson(
        `regimen-works-programs-${new Date().toISOString().slice(0, 10)}.json`,
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
              ? "Tick programs to export"
              : `Export ${chosen.length} program${chosen.length === 1 ? "" : "s"}`}
          </button>
          {exporting.error && (
            <span className="text-sm text-[var(--danger)]" role="alert">
              {messageOf(exporting.error, "Couldn't export the programs.")}
            </span>
          )}
        </div>
      )}
      {programs && (
        <ProgramList>
          {programs.map((program) => (
            <ProgramRow key={program.id} program={program}>
              {!program.builtIn && (
                <input
                  type="checkbox"
                  aria-label={`Include ${program.name} in the export`}
                  checked={ticked.has(program.id)}
                  onChange={(e) => tick(program.id, e.target.checked)}
                />
              )}
              {program.builtIn ? (
                <span>Built in</span>
              ) : program.archived ? (
                <Action
                  label={`Restore ${program.name}`}
                  disabled={busy}
                  onClick={() => onRestore(program.id)}
                >
                  Restore
                </Action>
              ) : (
                <>
                  {startable(program.id) && (
                    <StartLink id={program.id} name={program.name} />
                  )}
                  <CopyLink program={program} />
                  <Link
                    to={`/programs/global/${program.id}/edit`}
                    aria-label={`Edit ${program.name}`}
                  >
                    Edit
                  </Link>
                  <Action
                    label={`Remove ${program.name}`}
                    disabled={busy}
                    onClick={() => onRemove(program.id)}
                  >
                    Remove
                  </Action>
                </>
              )}
            </ProgramRow>
          ))}
        </ProgramList>
      )}
    </section>
  );
}

function StartLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      to={`/programs/${encodeURIComponent(id)}/start`}
      aria-label={`Start ${name}`}
      className="text-[var(--glow)]"
    >
      Start
    </Link>
  );
}

function CopyLink({ program }: { program: ProgramSummary }) {
  return (
    <Link
      to={`/programs/new?copy=${encodeURIComponent(program.id)}`}
      aria-label={`Copy ${program.name} to your programs`}
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

function ProgramList({ children }: { children: ReactNode }) {
  return (
    <ul
      className="mt-3"
      style={{ border: "1px solid var(--border)", background: "var(--panel)" }}
    >
      {children}
    </ul>
  );
}

function ProgramRow({
  program,
  children,
}: {
  program: ProgramSummary;
  children: ReactNode;
}) {
  const days =
    program.scheduleMode === "flexible"
      ? `Any ${program.days.length} day${program.days.length === 1 ? "" : "s"} a week`
      : WEEKDAYS.filter((d) => program.days.includes(d.value))
          .map((d) => d.short)
          .join(" · ");
  return (
    <li
      className="px-4 py-3"
      style={{
        borderTop: "1px solid var(--border)",
        opacity: program.archived ? 0.7 : 1,
      }}
    >
      <span
        className="block font-semibold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        {program.name}
      </span>
      <span className="mt-1 block text-sm text-[var(--ink-soft)]">
        {program.summary}
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
