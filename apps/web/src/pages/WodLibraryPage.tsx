import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateWod } from "@regimen-works/shared";
import { ApiError, api, type ApiWod, type LibraryTier } from "../lib/api";
import { WodForm } from "../components/WodForm";
import { LibraryNav } from "../components/LibraryNav";
import { SeededNote } from "../components/SeededNote";
import { SectionLabel } from "../components/Panel";
import { patternLabel } from "../lib/progressions";
import { movementCount } from "../lib/movementCount";
import {
  EMPTY_WOD_DRAFT,
  movementChoicesFor,
  toWodDraft,
} from "../lib/wodDraft";

type Editing =
  | { kind: "none" }
  | { kind: "create"; tier: LibraryTier }
  | { kind: "edit"; tier: LibraryTier; wod: ApiWod };

const TYPE_LABELS: Record<string, string> = {
  amrap: "AMRAP",
  for_time: "For time",
  emom: "EMOM",
  tabata: "Tabata",
};

/** What a row says about itself under its name — format, cap, shape. */
function summarise(wod: ApiWod): string {
  const parts = [
    TYPE_LABELS[wod.type] ?? wod.type,
    `${wod.timeCapMinutes} min cap`,
    patternLabel(wod.dominantPattern),
  ];
  const ladder = wod.movements.find((m) => m.repScheme.length > 0);
  if (ladder) parts.push(ladder.repScheme.join("-"));
  parts.push(
    wod.movements.length === 1 ? "1 movement" : `${wod.movements.length} movements`,
  );
  return parts.join(" — ");
}

function WodRow({
  wod,
  editable,
  seeded,
  onEdit,
  onArchive,
  onUnarchive,
  busy,
}: {
  wod: ApiWod;
  editable: boolean;
  /** Shown to an admin on a row `wod-seed.ts` owns, in place of controls. */
  seeded: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  busy: boolean;
}) {
  const retired = wod.archivedAt !== null;
  // The name opens the row onto what the workout is made of. Every athlete can
  // read a workout, editable or not, so this is not behind `editable`; and the
  // movements are already in the list response, so opening one costs nothing.
  const [open, setOpen] = useState(false);
  const movementsId = useId();
  const movements = [...wod.movements].sort((a, b) => a.order - b.order);
  return (
    <li style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[14px]"
            style={{ color: retired ? "var(--ink-faint)" : "var(--ink)" }}
          >
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={movementsId}
              className="text-left underline-offset-2 hover:underline"
            >
              <span
                aria-hidden
                className="mr-1.5 inline-block w-2 text-[var(--ink-faint)]"
              >
                {open ? "▾" : "▸"}
              </span>
              {wod.name}
            </button>
            {/* In words rather than by a strikethrough, which a screen reader
              does not read out. Same as the movement library. */}
            {retired && (
              <span className="ml-2 text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                Retired
              </span>
            )}
          </p>
          <p className="truncate text-[11px] text-[var(--ink-faint)]">
            {summarise(wod)}
          </p>
          {seeded && <SeededNote kind="wod" />}
        </div>
        {editable && (
          <div className="flex shrink-0 gap-2">
            {retired ? (
              <button
                type="button"
                disabled={busy}
                onClick={onUnarchive}
                className="px-2 py-1 text-[11px] uppercase tracking-[0.14em] disabled:opacity-50"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--ink-soft)",
                  fontFamily: "var(--font-mono)",
                }}
                aria-label={`Bring back ${wod.name}`}
              >
                Bring back
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  className="px-2 py-1 text-[11px] uppercase tracking-[0.14em]"
                  style={{
                    border: "1px solid var(--border)",
                    color: "var(--ink-soft)",
                    fontFamily: "var(--font-mono)",
                  }}
                  aria-label={`Edit ${wod.name}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onArchive}
                  className="px-2 py-1 text-[11px] uppercase tracking-[0.14em] disabled:opacity-50"
                  style={{
                    border: "1px solid var(--danger)",
                    color: "var(--danger)",
                    fontFamily: "var(--font-mono)",
                  }}
                  aria-label={`Retire ${wod.name}`}
                >
                  Retire
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {open && (
        <div id={movementsId} className="px-4 pb-3 pl-8">
          {wod.description && (
            <p className="mb-2 text-[12px] text-[var(--ink-soft)]">
              {wod.description}
            </p>
          )}
          <ol aria-label={`Movements in ${wod.name}`} className="space-y-1">
            {movements.map((m) => (
              <li key={m.id} className="flex gap-3 text-[13px]">
                <span
                  className="w-16 shrink-0 text-right text-[var(--ink-soft)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {movementCount(m)}
                </span>
                <Link
                  to={`/library/movements/${m.exercise.id}`}
                  className="min-w-0 truncate text-[var(--ink)] underline-offset-2 hover:underline"
                >
                  {m.exercise.name}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

/**
 * The workout library, in the two tiers it is stored in (DN-29).
 *
 * The same shape as the movement library and for the same reasons — two
 * sections so the tier is visible, an Add button per section so it is chosen
 * by the act, `isAdmin` deciding what is rendered and never what is allowed.
 *
 * This is the page that ends the need to seed new WODs by hand.
 */
export function WodLibraryPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>({ kind: "none" });
  const [serverError, setServerError] = useState<string | null>(null);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const {
    data: wods,
    isLoading,
    error,
  } = useQuery({ queryKey: ["libraryWods"], queryFn: api.libraryWods });
  // The pool a workout's movements are chosen from. Retired movements are in
  // this list too and `movementChoicesFor` drops them — the editor needs the
  // same read the movement library does, not a second endpoint.
  const { data: exercises } = useQuery({
    queryKey: ["libraryExercises"],
    queryFn: api.libraryExercises,
  });

  function close() {
    setEditing({ kind: "none" });
    setServerError(null);
  }

  // `wods` is the pool the scheduler plans from, so a workout retired here has
  // to leave it as well as leaving this page's list.
  const mutationOptions = {
    onSuccess: async () => {
      close();
      await queryClient.invalidateQueries({ queryKey: ["libraryWods"] });
      await queryClient.invalidateQueries({ queryKey: ["wods"] });
    },
    onError: (err: unknown) => {
      setServerError(
        err instanceof ApiError ? err.message : "Couldn't reach the API.",
      );
    },
  };

  const create = useMutation({
    mutationFn: ({ tier, body }: { tier: LibraryTier; body: CreateWod }) =>
      api.createWod(tier, body),
    ...mutationOptions,
  });
  const update = useMutation({
    mutationFn: ({
      tier,
      id,
      body,
    }: {
      tier: LibraryTier;
      id: string;
      body: CreateWod;
    }) => api.updateWod(tier, id, body),
    ...mutationOptions,
  });
  const archive = useMutation({
    mutationFn: ({ tier, id }: { tier: LibraryTier; id: string }) =>
      api.archiveWod(tier, id),
    ...mutationOptions,
  });
  const unarchive = useMutation({
    mutationFn: ({ tier, id }: { tier: LibraryTier; id: string }) =>
      api.unarchiveWod(tier, id),
    ...mutationOptions,
  });

  if (isLoading)
    return <p className="p-6 text-[var(--ink-faint)]">Loading workouts…</p>;
  if (error || !wods)
    return (
      <p className="p-6 text-[var(--danger)]">
        Couldn't reach the API — is it running on :3001?
      </p>
    );

  const isAdmin = me?.isAdmin === true;
  const mine = wods.filter((w) => w.ownerId !== null);
  const shared = wods.filter((w) => w.ownerId === null);
  const busy =
    archive.isPending ||
    unarchive.isPending ||
    create.isPending ||
    update.isPending;

  function form(tier: LibraryTier) {
    if (editing.kind === "none" || editing.tier !== tier) return null;
    const wod = editing.kind === "edit" ? editing.wod : null;
    return (
      <WodForm
        // Remounted per target, so opening a second row does not inherit the
        // first row's half-finished edits from the form's own state.
        key={wod?.id ?? `new-${tier}`}
        initial={wod ? toWodDraft(wod) : EMPTY_WOD_DRAFT}
        choices={movementChoicesFor(exercises ?? [], tier)}
        saving={create.isPending || update.isPending}
        serverError={serverError}
        submitLabel={wod ? "Save" : "Add workout"}
        onSubmit={(body) => {
          setServerError(null);
          if (wod) update.mutate({ tier, id: wod.id, body });
          else create.mutate({ tier, body });
        }}
        onCancel={close}
      />
    );
  }

  function addButton(tier: LibraryTier) {
    return (
      <button
        type="button"
        onClick={() => {
          setServerError(null);
          setEditing({ kind: "create", tier });
        }}
        className="mt-3 w-full py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em]"
        style={{
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          color: "var(--glow)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {tier === "own" ? "Add your own workout" : "Add a shared workout"}
      </button>
    );
  }

  function list(
    rows: ApiWod[],
    tier: LibraryTier,
    editable: boolean,
    label: string,
  ) {
    if (rows.length === 0)
      return (
        <p className="mt-3 text-[13px] text-[var(--ink-faint)]">
          Nothing here yet.
        </p>
      );
    return (
      <ul
        aria-label={label}
        className="mt-3"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
        }}
      >
        {rows.map((wod) => (
          <WodRow
            key={wod.id}
            wod={wod}
            // A shared WOD with a key is `wod-seed.ts`'s (ADR 0010): the API
            // refuses to change it, so it says where to instead.
            editable={editable && wod.key === null}
            seeded={editable && wod.key !== null}
            busy={busy}
            onEdit={() => {
              setServerError(null);
              setEditing({ kind: "edit", tier, wod });
            }}
            onArchive={() => archive.mutate({ tier, id: wod.id })}
            onUnarchive={() => unarchive.mutate({ tier, id: wod.id })}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="p-6">
      <h1
        className="text-3xl font-extrabold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        Library
      </h1>
      <LibraryNav />
      <p className="mt-4 text-[13px] text-[var(--ink-faint)]">
        Every workout the app can schedule for you. Retiring one keeps the
        sessions you've already trained and takes it out of future ones.
      </p>

      <SectionLabel>YOUR WORKOUTS</SectionLabel>
      {list(mine, "own", true, "Your workouts")}
      {form("own")}
      {editing.kind === "none" && addButton("own")}

      <SectionLabel>SHARED LIBRARY</SectionLabel>
      <p className="mt-2 text-[12px] text-[var(--ink-faint)]">
        {isAdmin
          ? "Everyone's workouts. What you change here, every athlete gets."
          : "Workouts everyone gets. Add your own above to change what you're given."}
      </p>
      {list(shared, "global", isAdmin, "Shared library")}
      {isAdmin && form("global")}
      {isAdmin && editing.kind === "none" && addButton("global")}
    </div>
  );
}
