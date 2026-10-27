import { useQuery } from "@tanstack/react-query";
import type { AlternativeSuggestionsRequest } from "@regimen-works/shared";
import { api, type ApiExercise, type LibraryTier } from "../lib/api";

/**
 * The alternatives the muscle match suggests for a movement being written
 * (DN-205), each one tap from being chosen.
 *
 * A suggestion, never a requirement: the author may take one, pick another,
 * or leave it empty and let the scheduler find one on the day. Asked again
 * whenever the draft's muscles, unit or facts change, since each moves the
 * answer. Tapping the chosen one again lets it go.
 */
export function AlternativeSuggestions({
  tier,
  request,
  chosenId,
  onChoose,
}: {
  tier: LibraryTier;
  request: AlternativeSuggestionsRequest | null;
  chosenId: string;
  onChoose: (exercise: ApiExercise | null) => void;
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["alternative-suggestions", tier, request],
    queryFn: () => api.suggestAlternatives(tier, request!),
    enabled: request !== null,
  });

  const note = (text: string) => (
    <p className="mt-2 text-[12px] text-[var(--ink-faint)]">{text}</p>
  );

  if (request === null) return note("Choose the muscle it works to see suggested alternatives.");
  if (isPending) return note("Looking for a close match…");
  if (isError) return note("Couldn't load suggestions — you can still choose one yourself.");
  if (data.length === 0) return note("Nothing in the library is a close match.");

  return (
    <ul aria-label="Suggested alternatives" className="mt-2 flex flex-col gap-2">
      {data.map((e) => {
        const chosen = e.id === chosenId;
        return (
          <li
            key={e.id}
            className="flex min-h-11 items-center justify-between gap-3 border px-3"
            style={{
              borderColor: chosen ? "var(--glow)" : "var(--border)",
              background: chosen ? "var(--glow-tint)" : "transparent",
            }}
          >
            <span className="text-[13px] text-[var(--ink)]">{e.name}</span>
            <button
              type="button"
              aria-pressed={chosen}
              aria-label={chosen ? `Stop using ${e.name}` : `Use ${e.name}`}
              onClick={() => onChoose(chosen ? null : e)}
              className="min-h-9 px-3 text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{
                color: chosen ? "var(--glow)" : "var(--ink-soft)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {chosen ? "Chosen" : "Use"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
