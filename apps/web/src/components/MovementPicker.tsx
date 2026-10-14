import { useState } from "react";
import type { ApiExercise } from "../lib/api";
import { lineLabel } from "../lib/progressions";
import {
  groupMates,
  searchExercises,
  type DraftLine,
} from "../lib/routineDraft";

const mono = { fontFamily: "var(--font-mono)" } as const;

/**
 * Search first (DN-137): type what you call it, get the library's rows, and
 * see what each would swap to. Beneath each grouped row, the other way to
 * write a line -- any member of the group, resolved by the athlete's kit.
 */
export function MovementPicker({
  library,
  initialQuery = "",
  onPick,
  onClose,
}: {
  library: ApiExercise[];
  /** What to search for on opening -- the pasted name, from the paste box (DN-152). */
  initialQuery?: string;
  onPick: (choice: Pick<DraftLine, "exerciseId" | "movementGroup">) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const hits = searchExercises(query, library).slice(0, 12);
  return (
    <div className="mt-2 border border-[var(--glow-dim)] bg-[var(--bg)] p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movements"
          aria-label="Search movements"
          className="flex-1 border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-sm text-[var(--ink)]"
        />
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-[var(--ink-faint)]"
        >
          close
        </button>
      </div>
      {query.trim() !== "" && hits.length === 0 && (
        <p className="mt-2 text-xs text-[var(--danger)]">
          Nothing in the library is “{query}”. Add it to your movements first,
          or pick the nearest.
        </p>
      )}
      <ul className="mt-2 max-h-64 overflow-auto">
        {hits.map((e, i) => {
          const mates = groupMates(e, library);
          return (
            <li key={e.id} className="border-t border-[var(--border)] py-2">
              <button
                type="button"
                className="w-full text-left"
                onClick={() =>
                  onPick({ exerciseId: e.id, movementGroup: null })
                }
              >
                <span className="text-sm text-[var(--ink)]">{e.name}</span>
                {i === 0 && query.trim() !== "" && (
                  <span
                    className="ml-2 text-[10px] text-[var(--glow)]"
                    style={mono}
                  >
                    BEST MATCH
                  </span>
                )}
                <span className="block text-[11px] text-[var(--ink-faint)]">
                  {mates.length > 0
                    ? `Swaps with ${mates
                        .slice(0, 3)
                        .map((m) => m.name)
                        .join(", ")}`
                    : "No swaps"}
                  {e.equipment.length
                    ? ` · needs ${e.equipment.join(", ")}`
                    : ""}
                </span>
              </button>
              {e.movementGroup && (
                <button
                  type="button"
                  className="mt-1 text-[11px] text-[var(--glow)] underline"
                  onClick={() =>
                    onPick({
                      exerciseId: null,
                      movementGroup:
                        e.movementGroup as DraftLine["movementGroup"],
                    })
                  }
                >
                  or: any {lineLabel(e.movementGroup).toLowerCase()}, chosen by
                  my equipment
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
