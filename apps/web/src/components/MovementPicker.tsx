import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EQUIPMENT_CATALOG,
  equipmentLabel,
  type Equipment,
  type ExerciseUnit,
} from "@regimen-works/shared";
import { api, type ApiExercise } from "../lib/api";
import { lineLabel } from "../lib/progressions";
import type { DraftLine } from "../lib/programDraft";
import {
  MUSCLE_GROUPS,
  MUSCLE_LABEL,
  didYouMean,
  exactMatch,
  findMovements,
  groupOf,
  highlight,
  kitAlternatives,
  kitCovers,
  kitPhrase,
  missingKit,
  musclesOf,
  recentSearches,
  rememberSearch,
  splitByKit,
  usedMost,
  worksGroup,
  type MuscleGroupKey,
} from "../lib/movementPicker";

const mono = { fontFamily: "var(--font-mono)" } as const;
const display = { fontFamily: "var(--font-display)" } as const;

type Choice = Pick<DraftLine, "exerciseId" | "movementGroup">;

/**
 * Choosing a movement, on a page of its own (DN-194; first as an inline box,
 * DN-137).
 *
 * Kit first: what the athlete's kit can do leads, what it can't is folded
 * away beneath, and searching for something it can't do leads with what to
 * do instead. Laid over the page that opened it rather than routed to, so the
 * program being written underneath is never left -- nothing there is saved
 * until the athlete saves it.
 */
export function MovementPicker({
  library,
  initialQuery = "",
  context,
  heading = "Add a movement",
  allowCreate = false,
  onPick,
  onClose,
}: {
  /** What may be picked: a curated program offers only library movements. */
  library: ApiExercise[];
  /** What to search for on opening -- the pasted name, from the paste box (DN-152). */
  initialQuery?: string;
  /** Where the movement goes, as the header says it: "MON · MOVEMENT 4". */
  context?: string;
  heading?: string;
  /** Offer to add a movement the library doesn't have to the athlete's own. */
  allowCreate?: boolean;
  onPick: (choice: Choice) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: volume = [] } = useQuery({
    queryKey: ["movementVolume"],
    queryFn: api.movementVolume,
  });
  const owned = settings?.equipment ?? null;

  const [query, setQuery] = useState(initialQuery);
  const [group, setGroup] = useState<MuscleGroupKey | null>(null);
  const [kitOnly, setKitOnly] = useState(true);
  const [editingKit, setEditingKit] = useState(false);
  // A kit-blocked result's alternatives, opened from its row.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Every match, asked for from an exact match the kit can't do.
  const [listAll, setListAll] = useState(false);
  const [recent] = useState(recentSearches);
  const page = useRef<HTMLDivElement>(null);
  // Opening a movement's alternatives, or going back, starts at the top.
  useEffect(() => {
    // jsdom has no scrollTo.
    page.current?.scrollTo?.({ top: 0 });
  }, [focusId]);

  const saveKit = useMutation({
    mutationFn: (equipment: Equipment[]) => api.updateSettings({ equipment }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["settings"], updated);
      await queryClient.invalidateQueries({ queryKey: ["today"] });
    },
  });

  const search = (next: string) => {
    setQuery(next);
    setFocusId(null);
    setListAll(false);
  };
  const pick = (choice: Choice) => {
    rememberSearch(query);
    onPick(choice);
  };

  const q = query.trim();
  const found = findMovements(q, library, group);
  const { withKit, needsKit } = splitByKit(found, owned);
  const exact = exactMatch(q, library);
  const focus =
    (focusId && library.find((e) => e.id === focusId)) ||
    (kitOnly && !listAll && exact && !kitCovers(exact, owned) ? exact : null);

  let body: ReactNode;
  if (focus) {
    body = (
      <Instead
        target={focus}
        isExact={focus === exact}
        library={library}
        owned={owned}
        savingKit={saveKit.isPending}
        onPick={pick}
        onHaveKit={(pieces) => saveKit.mutate([...(owned ?? []), ...pieces])}
        onSeeGroup={(key) => {
          search("");
          setGroup(key);
        }}
        onBack={
          focusId
            ? () => setFocusId(null)
            : q !== ""
              ? () => setListAll(true)
              : null
        }
        backLabel={focusId ? "← BACK TO RESULTS" : `SEE EVERY MATCH FOR “${q}”`}
      />
    );
  } else if (q !== "" && found.length === 0) {
    const elsewhere = group !== null && findMovements(q, library, null).length > 0;
    body = elsewhere ? (
      <p className="mt-6 text-sm text-[var(--ink-soft)]">
        Nothing in {MUSCLE_GROUPS.find((g) => g.key === group)!.label.toLowerCase()} is “{q}”.{" "}
        <button type="button" className="text-[var(--glow)] underline" onClick={() => setGroup(null)}>
          Search every muscle
        </button>
      </p>
    ) : (
      <NotFound
        query={q}
        library={library}
        owned={owned}
        allowCreate={allowCreate}
        onSearch={search}
        onPick={pick}
      />
    );
  } else if (q !== "" || group !== null) {
    body = (
      <Results
        query={q}
        library={library}
        found={found}
        withKit={withKit}
        needsKit={needsKit}
        owned={owned}
        kitOnly={kitOnly}
        onPick={pick}
        onAlternatives={setFocusId}
      />
    );
  } else {
    body = (
      <Opening
        recent={recent}
        used={usedMost(volume, library)}
        owned={owned}
        onSearch={search}
        onPick={pick}
      />
    );
  }

  return (
    <div
      ref={page}
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg)] text-left"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="mx-auto max-w-md px-6 pb-12 pt-5">
        <header className="flex min-h-11 items-center justify-between text-xs" style={mono}>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 tracking-[0.14em] text-[var(--ink-soft)]"
          >
            × CLOSE
          </button>
          {context && (
            <span className="tracking-[0.14em] text-[var(--ink-faint)]">{context.toUpperCase()}</span>
          )}
        </header>

        {q === "" && group === null && !focus && (
          <h2 className="mt-3 text-[34px] font-bold leading-none text-[var(--ink)]" style={display}>
            {heading}
          </h2>
        )}

        <div className="mt-4 flex items-center gap-3 border border-[var(--border)] bg-[var(--panel)] px-4 focus-within:border-[var(--glow)]">
          <span aria-hidden className="text-[var(--glow)]">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder="Search by name or muscle"
            aria-label="Search movements"
            className="min-h-13 flex-1 bg-transparent py-3 text-base text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
            // The box around it shows focus; the global ring would draw a second one inside.
            style={{ outline: "none" }}
          />
          {query !== "" && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => search("")}
              className="min-h-11 px-1 text-lg text-[var(--ink-faint)]"
            >
              ×
            </button>
          )}
        </div>

        {!focus && (
          <>
            <div
              className="-mx-6 mt-3 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none]"
              role="group"
              aria-label="Muscles"
            >
              {[{ key: null, label: "All" }, ...MUSCLE_GROUPS].map((g) => (
                <Chip key={g.label} pressed={group === g.key} onClick={() => setGroup(g.key)}>
                  {g.label}
                </Chip>
              ))}
            </div>
            <div className="mt-3 flex min-h-11 items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-3 text-sm text-[var(--ink-soft)]">
                <input
                  type="checkbox"
                  checked={kitOnly}
                  onChange={(e) => setKitOnly(e.target.checked)}
                  className="h-5 w-5 accent-[var(--glow)]"
                />
                Only what my kit can do
              </label>
              <button
                type="button"
                aria-expanded={editingKit}
                onClick={() => setEditingKit(!editingKit)}
                className="min-h-11 text-xs tracking-[0.06em] text-[var(--glow)] underline"
                style={mono}
              >
                MY KIT
              </button>
            </div>
            {editingKit && (
              <KitEditor
                owned={owned ?? []}
                pending={saveKit.isPending}
                onChange={(next) => saveKit.mutate(next)}
              />
            )}
          </>
        )}

        <div className="mt-2 border-t border-[var(--border)]">{body}</div>
      </div>
    </div>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="min-h-11 shrink-0 border px-4 text-sm"
      style={{
        borderColor: pressed ? "var(--glow)" : "var(--border)",
        background: pressed ? "var(--glow-tint)" : "transparent",
        color: pressed ? "var(--glow)" : "var(--ink-soft)",
      }}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 mb-2 text-[11px] tracking-[0.14em] text-[var(--ink-soft)]" style={mono}>
      {children}
    </h3>
  );
}

/** The kit a row needs, short: "DUMBBELL · BENCH", or "BODYWEIGHT". */
function kitTag(e: ApiExercise) {
  return e.equipment.length
    ? (e.equipment as Equipment[]).map((p) => equipmentLabel(p).toUpperCase()).join(" · ")
    : "BODYWEIGHT";
}

function musclesLine(e: ApiExercise) {
  return musclesOf(e)
    .slice(0, 3)
    .map((m) => MUSCLE_LABEL[m])
    .join(" · ");
}

/**
 * One movement on offer. The whole row is the button, named by the movement
 * first so it reads as what it picks.
 */
function MovementRow({
  exercise,
  query = "",
  owned,
  badge,
  meter,
  current,
  onPick,
}: {
  exercise: ApiExercise;
  query?: string;
  owned: readonly Equipment[] | null;
  badge?: string;
  meter?: { shared: number; of: number };
  current?: boolean;
  onPick: () => void;
}) {
  const missing = missingKit(exercise, owned);
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 border px-4 py-3 text-left"
      style={{
        borderColor: current ? "var(--glow)" : "var(--border)",
        background: "var(--panel)",
      }}
    >
      <span className="flex flex-1 flex-col gap-0.5">
        <span
          className="text-[15px]"
          style={{ color: query ? "var(--ink-soft)" : "var(--ink)", fontWeight: query ? 400 : 600 }}
        >
          {/* Bare text between the bold runs: a wrapped run loses its spaces from the button's name. */}
          {highlight(exercise.name, query).map((run, i) =>
            run.hit ? (
              <strong key={i} className="font-bold text-[var(--ink)]">
                {run.text}
              </strong>
            ) : (
              run.text
            ),
          )}
          {badge && " "}
          {badge && (
            <span className="ml-1 whitespace-nowrap text-[10px] tracking-[0.12em] text-[var(--glow)]" style={mono}>
              {badge}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-xs text-[var(--ink-faint)]">
          {meter && meter.of > 0 && (
            <span aria-label={`Works ${meter.shared} of its ${meter.of} muscles`} className="flex gap-0.5">
              {Array.from({ length: meter.of }, (_, i) => (
                <span
                  key={i}
                  className="inline-block h-2 w-2"
                  style={{ background: i < meter.shared ? "var(--glow)" : "var(--border)" }}
                />
              ))}
            </span>
          )}
          {musclesLine(exercise)}
        </span>
      </span>
      <span
        className="shrink-0 text-[11px] tracking-[0.08em]"
        style={{ ...mono, color: missing.length ? "var(--danger)" : "var(--ink-soft)" }}
      >
        {missing.length
          ? `NEEDS ${missing.map((p) => equipmentLabel(p).toUpperCase()).join(" · ")}`
          : kitTag(exercise)}
      </span>
    </button>
  );
}

/** "or: any pull, chosen by my equipment" -- the line names the group, not a movement. */
function AnyOfGroup({ exercise, onPick }: { exercise: ApiExercise; onPick: (c: Choice) => void }) {
  if (!exercise.movementGroup) return null;
  return (
    <button
      type="button"
      className="min-h-9 px-4 text-left text-[11px] text-[var(--glow)] underline"
      onClick={() =>
        onPick({
          exerciseId: null,
          movementGroup: exercise.movementGroup as DraftLine["movementGroup"],
        })
      }
    >
      or: any {lineLabel(exercise.movementGroup).toLowerCase()}, chosen by my equipment
    </button>
  );
}

/** A · Before anything is typed: recent searches, and the movements used most. */
function Opening({
  recent,
  used,
  owned,
  onSearch,
  onPick,
}: {
  recent: string[];
  used: ApiExercise[];
  owned: readonly Equipment[] | null;
  onSearch: (q: string) => void;
  onPick: (c: Choice) => void;
}) {
  return (
    <>
      {recent.length > 0 && (
        <>
          <SectionLabel>RECENT SEARCHES</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {recent.map((s) => (
              <Chip key={s} pressed={false} onClick={() => onSearch(s)}>
                <span className="text-[var(--ink)]">{s}</span>
              </Chip>
            ))}
          </div>
        </>
      )}
      {used.length > 0 && (
        <>
          <SectionLabel>YOU USE THESE MOST</SectionLabel>
          <ul className="space-y-2">
            {used.map((e) => (
              <li key={e.id}>
                <MovementRow
                  exercise={e}
                  owned={owned}
                  onPick={() => onPick({ exerciseId: e.id, movementGroup: null })}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {recent.length === 0 && used.length === 0 && (
        <p className="mt-6 text-sm text-[var(--ink-faint)]">
          Type a movement or a muscle, or pick a muscle above.
        </p>
      )}
    </>
  );
}

/** B · What the search found, the kit's first and the rest folded beneath. */
function Results({
  query,
  library,
  found,
  withKit,
  needsKit,
  owned,
  kitOnly,
  onPick,
  onAlternatives,
}: {
  query: string;
  library: ApiExercise[];
  found: ApiExercise[];
  withKit: ApiExercise[];
  needsKit: ApiExercise[];
  owned: readonly Equipment[] | null;
  kitOnly: boolean;
  onPick: (c: Choice) => void;
  onAlternatives: (id: string) => void;
}) {
  const [showNeedsKit, setShowNeedsKit] = useState(false);
  // The group's other way to write a line, under the first row only: under
  // every row it buries the list.
  const row = (e: ApiExercise, i: number) => (
    <li key={e.id}>
      <MovementRow
        exercise={e}
        query={query}
        owned={owned}
        badge={i === 0 && query ? "BEST MATCH" : undefined}
        onPick={() => onPick({ exerciseId: e.id, movementGroup: null })}
      />
      {i === 0 && <AnyOfGroup exercise={e} onPick={onPick} />}
    </li>
  );

  if (!kitOnly || owned === null) {
    return (
      <>
        <p className="mt-3 text-sm text-[var(--ink-faint)]">
          {found.length} {found.length === 1 ? "movement" : "movements"}
        </p>
        <ul className="mt-3 space-y-2">
          {found.map(row)}
        </ul>
      </>
    );
  }

  return (
    <>
      <p className="mt-3 text-sm text-[var(--ink-faint)]">
        {found.length} {found.length === 1 ? "movement" : "movements"} · {withKit.length} you can do
        with your kit
      </p>
      {withKit.length > 0 && (
        <>
          <SectionLabel>WITH YOUR KIT</SectionLabel>
          <ul className="space-y-2">
            {withKit.map(row)}
          </ul>
        </>
      )}
      {needsKit.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showNeedsKit}
            onClick={() => setShowNeedsKit(!showNeedsKit)}
            className="mt-4 flex min-h-12 w-full items-center justify-between border border-dashed border-[var(--border)] px-4 text-left text-sm text-[var(--ink-soft)]"
          >
            {needsKit.length} more {needsKit.length === 1 ? "needs" : "need"} kit you don't have
            <span className="text-[11px] tracking-[0.1em]" style={mono}>
              {showNeedsKit ? "HIDE" : "SHOW"}
            </span>
          </button>
          {showNeedsKit && (
            <ul className="mt-2 space-y-2">
              {needsKit.map((e) => {
                const instead = kitAlternatives(e, library, owned);
                return (
                  <li key={e.id}>
                    <MovementRow
                      exercise={e}
                      query={query}
                      owned={owned}
                      onPick={() => onAlternatives(e.id)}
                    />
                    <button
                      type="button"
                      className="min-h-9 px-4 text-left text-xs text-[var(--glow)] underline"
                      onClick={() => onAlternatives(e.id)}
                    >
                      {instead.length > 0
                        ? `${instead.length} like it you can do →`
                        : "Why it's out, and what to do →"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}

/** C · A movement the kit can't do, and what it can do instead. */
function Instead({
  target,
  isExact,
  library,
  owned,
  savingKit,
  onPick,
  onHaveKit,
  onSeeGroup,
  onBack,
  backLabel,
}: {
  target: ApiExercise;
  isExact: boolean;
  library: ApiExercise[];
  owned: readonly Equipment[] | null;
  savingKit: boolean;
  onPick: (c: Choice) => void;
  onHaveKit: (pieces: Equipment[]) => void;
  onSeeGroup: (key: MuscleGroupKey) => void;
  onBack: (() => void) | null;
  backLabel: string;
}) {
  const missing = missingKit(target, owned);
  const instead = kitAlternatives(target, library, owned).slice(0, 6);
  const muscles = musclesOf(target);
  const prime = target.primaryMuscles[0];
  const piece = kitPhrase(missing);
  return (
    <>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-3 min-h-11 text-xs tracking-[0.06em] text-[var(--glow)]"
          style={mono}
        >
          {backLabel}
        </button>
      )}
      <section aria-label={target.name} className="mt-3 border border-[var(--border)] p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-2xl font-bold text-[var(--ink)]" style={display}>
            {target.name}
          </h2>
          {isExact && (
            <span className="text-[10px] tracking-[0.14em] text-[var(--ink-faint)]" style={mono}>
              EXACT MATCH
            </span>
          )}
        </div>
        <p className="mt-2 text-[15px] leading-snug text-[var(--ink-soft)]">
          {missing.length > 0 ? (
            <>
              Needs {missing.length === 1 ? "a " : ""}
              <strong className="text-[var(--danger)]">{piece}</strong>, which{" "}
              {missing.length === 1 ? "isn't" : "aren't"} in your kit.
            </>
          ) : (
            "Your kit covers it."
          )}
          {muscles.length > 0 &&
            ` Works ${muscles
              .slice(0, 3)
              .map((m) => MUSCLE_LABEL[m].toLowerCase())
              .join(", ")
              .replace(/, ([^,]*)$/, " and $1")}.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPick({ exerciseId: target.id, movementGroup: null })}
            className="min-h-11 border border-[var(--border)] px-4 text-sm text-[var(--ink)]"
          >
            Add it anyway
          </button>
          {missing.length > 0 && (
            <button
              type="button"
              disabled={savingKit}
              onClick={() => onHaveKit(missing)}
              className="min-h-11 border border-[var(--border)] px-4 text-sm text-[var(--ink)] disabled:opacity-50"
            >
              I have {missing.length === 1 ? "a " : ""}
              {piece}
            </button>
          )}
        </div>
        {missing.length > 0 && (
          <p className="mt-3 text-[13px] text-[var(--ink-faint)]">
            If you add it anyway, Today swaps it for the closest one on any day you don't have the{" "}
            {piece}.
          </p>
        )}
      </section>

      <h2 className="mt-6 text-2xl font-bold text-[var(--ink)]" style={display}>
        You can do these instead
      </h2>
      {muscles.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--ink-faint)]">
          Same muscles:
          {muscles.slice(0, 3).map((m) => (
            <span key={m} className="bg-[var(--glow-tint)] px-2 py-0.5 text-[var(--glow)]">
              {MUSCLE_LABEL[m]}
            </span>
          ))}
        </p>
      )}
      {instead.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {instead.map((a, i) => (
            <li key={a.exercise.id}>
              <MovementRow
                exercise={a.exercise}
                owned={owned}
                badge={i === 0 ? "CLOSEST" : undefined}
                meter={a}
                current={i === 0}
                onPick={() => onPick({ exerciseId: a.exercise.id, movementGroup: null })}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[var(--ink-faint)]">
          Nothing in the library works the same muscles with your kit.
        </p>
      )}
      {prime && (
        <button
          type="button"
          onClick={() => onSeeGroup(groupOf(prime).key)}
          className="mt-5 min-h-11 text-xs tracking-[0.06em] text-[var(--glow)] underline"
          style={mono}
        >
          SEE ALL {groupOf(prime).label.toUpperCase()} MOVEMENTS →
        </button>
      )}
    </>
  );
}

/** D · Nothing by that name: a near name, a muscle to work, or a movement of their own. */
function NotFound({
  query,
  library,
  owned,
  allowCreate,
  onSearch,
  onPick,
}: {
  query: string;
  library: ApiExercise[];
  owned: readonly Equipment[] | null;
  allowCreate: boolean;
  onSearch: (q: string) => void;
  onPick: (c: Choice) => void;
}) {
  const [works, setWorks] = useState<MuscleGroupKey | null>(null);
  const [creating, setCreating] = useState(false);
  const near = didYouMean(query, library, owned);
  const working =
    works === null ? [] : library.filter((e) => worksGroup(e, works) && kitCovers(e, owned)).slice(0, 8);
  return (
    <>
      <h2 className="mt-5 text-[28px] font-bold leading-tight text-[var(--ink)]" style={display}>
        No “{query}” in the library
      </h2>
      {near.length > 0 && (
        <p className="mt-1 text-[15px] text-[var(--ink-soft)]">
          Did you mean{" "}
          {near.map((e, i) => (
            <span key={e.id}>
              {i > 0 && (i === near.length - 1 ? " or " : ", ")}
              <span className="whitespace-nowrap">
                <button
                  type="button"
                  className="text-[var(--glow)] underline"
                  onClick={() => onSearch(e.name)}
                >
                  {e.name}
                </button>
                {i === near.length - 1 && "?"}
              </span>
            </span>
          ))}
        </p>
      )}

      <h3 className="mt-6 text-xl font-bold text-[var(--ink)]" style={display}>
        What should it work?
      </h3>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="What should it work?">
        {MUSCLE_GROUPS.map((g) => (
          <Chip key={g.key} pressed={works === g.key} onClick={() => setWorks(works === g.key ? null : g.key)}>
            {g.label}
          </Chip>
        ))}
      </div>
      {works !== null && (
        <>
          <SectionLabel>
            WORKS {MUSCLE_GROUPS.find((g) => g.key === works)!.label.toUpperCase()} · YOUR KIT
          </SectionLabel>
          {working.length > 0 ? (
            <ul className="space-y-2">
              {working.map((e) => (
                <li key={e.id}>
                  <MovementRow
                    exercise={e}
                    owned={owned}
                    onPick={() => onPick({ exerciseId: e.id, movementGroup: null })}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--ink-faint)]">Nothing your kit can do works that.</p>
          )}
        </>
      )}

      {allowCreate &&
        (creating ? (
          <NewMovement name={query} owned={owned} onPick={onPick} onCancel={() => setCreating(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-6 flex w-full items-center gap-4 border border-dashed border-[var(--glow-dim)] px-5 py-4 text-left"
          >
            <span aria-hidden className="text-2xl text-[var(--glow)]">
              +
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] text-[var(--ink)]">Add “{titleCase(query)}” to my movements</span>
              <span className="text-[13px] text-[var(--ink-faint)]">
                Name it, say how it's counted and what kit it needs, and it's yours to use
              </span>
            </span>
          </button>
        ))}
    </>
  );
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * The athlete's own movement, made without leaving the program. Only what a
 * line needs: the library page is where its instructions and swaps are written.
 */
function NewMovement({
  name: initialName,
  owned,
  onPick,
  onCancel,
}: {
  name: string;
  owned: readonly Equipment[] | null;
  onPick: (c: Choice) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(titleCase(initialName));
  const [unit, setUnit] = useState<ExerciseUnit>("reps");
  const [kit, setKit] = useState<Equipment[]>([]);
  const create = useMutation({
    mutationFn: () =>
      api.createExercise("own", {
        name: name.trim(),
        pattern: null,
        equipment: kit,
        scalable: false,
        unit,
        instructions: [],
        movementGroup: null,
        fallbackExerciseId: null,
      }),
    onSuccess: async (created) => {
      queryClient.setQueryData<ApiExercise[]>(["exercises"], (old) => (old ? [...old, created] : old));
      onPick({ exerciseId: created.id, movementGroup: null });
      await queryClient.invalidateQueries({ queryKey: ["exercises"] });
    },
  });
  return (
    <form
      aria-label="New movement"
      className="mt-6 border border-[var(--glow-dim)] p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create.mutate();
      }}
    >
      <label className="block">
        <span className="text-[11px] tracking-[0.14em] text-[var(--ink-soft)]" style={mono}>
          NAME
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Movement name"
          className="mt-1 block min-h-11 w-full border border-[var(--border)] bg-[var(--panel)] px-3 text-base text-[var(--ink)]"
        />
      </label>
      <fieldset className="mt-4">
        <legend className="text-[11px] tracking-[0.14em] text-[var(--ink-soft)]" style={mono}>
          COUNTED IN
        </legend>
        <div className="mt-1 flex gap-2">
          {(["reps", "seconds"] as const).map((u) => (
            <Chip key={u} pressed={unit === u} onClick={() => setUnit(u)}>
              {u === "reps" ? "Reps" : "Seconds"}
            </Chip>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="text-[11px] tracking-[0.14em] text-[var(--ink-soft)]" style={mono}>
          NEEDS
        </legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {EQUIPMENT_CATALOG.filter((p) => owned === null || owned.includes(p.value) || kit.includes(p.value)).map(
            (p) => (
              <Chip
                key={p.value}
                pressed={kit.includes(p.value)}
                onClick={() =>
                  setKit(kit.includes(p.value) ? kit.filter((k) => k !== p.value) : [...kit, p.value])
                }
              >
                {p.label}
              </Chip>
            ),
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--ink-faint)]">Nothing ticked means bodyweight.</p>
      </fieldset>
      {create.isError && (
        <p className="mt-3 text-sm text-[var(--danger)]">
          Couldn't add it: {(create.error as Error).message}
        </p>
      )}
      <div className="mt-5 flex gap-3">
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="min-h-11 bg-[var(--glow)] px-5 text-sm font-bold uppercase tracking-[0.1em] text-[var(--bg)] disabled:opacity-50"
          style={display}
        >
          Add and use it
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 px-3 text-sm text-[var(--ink-faint)]">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The athlete's kit, toggled in place: the same list Settings edits. */
function KitEditor({
  owned,
  pending,
  onChange,
}: {
  owned: readonly Equipment[];
  pending: boolean;
  onChange: (next: Equipment[]) => void;
}) {
  return (
    <div className="mb-3 border border-[var(--border)] p-3">
      <p className="text-xs text-[var(--ink-faint)]">Your kit. Changes save to Settings.</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Your kit">
        {EQUIPMENT_CATALOG.map((p) => {
          const has = owned.includes(p.value);
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={has}
              disabled={pending}
              onClick={() =>
                onChange(has ? owned.filter((k) => k !== p.value) : [...owned, p.value])
              }
              className="min-h-11 border px-3 text-sm disabled:opacity-60"
              style={{
                borderColor: has ? "var(--glow)" : "var(--border)",
                color: has ? "var(--glow)" : "var(--ink-soft)",
                background: has ? "var(--glow-tint)" : "transparent",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
