/**
 * PROTOTYPE — DN-137: "What shape is the routine editor?" Throwaway.
 *
 * Three variants on /prototype/routine-editor, switchable via ?variant=A|B|C:
 *   A  Week sheet     — all seven weekdays on one sheet; empty day = rest
 *   B  Split builder  — name days, fill one at a time, then pin to weekdays
 *   C  Paste it in    — text is the editor, read back line by line
 *
 * All three start from the worked example (DN-131's 25 movements) against
 * the real exercise library, so the refusals are the real ones. Nothing is
 * saved; the STATE panel at the bottom shows what would be.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../lib/api";
import { PrototypeSwitcher } from "../../../components/PrototypeSwitcher";
import { WORKED_EXAMPLE_TEXT, parseRoutine } from "./shared";
import { VariantWeek, name as nameA } from "./VariantWeek";
import { VariantDays, name as nameB } from "./VariantDays";
import { VariantPaste, name as nameC } from "./VariantPaste";

const VARIANTS = [
  { key: "A", name: nameA },
  { key: "B", name: nameB },
  { key: "C", name: nameC },
];

export function RoutineEditorPrototype() {
  const { data: library, isPending, error } = useQuery({ queryKey: ["exercises"], queryFn: api.exercises });
  const [params] = useSearchParams();
  const variant = params.get("variant") ?? "A";
  const seed = useMemo(() => (library ? parseRoutine(WORKED_EXAMPLE_TEXT, library) : null), [library]);

  return (
    <div className="pt-2">
      <p className="mx-4 border border-dashed border-[var(--glow-dim)] px-2 py-1 text-[10px] text-[var(--glow)]" style={{ fontFamily: "var(--font-mono)" }}>
        PROTOTYPE · DN-137 · NOTHING HERE SAVES
      </p>
      {isPending && <p className="p-4 text-sm text-[var(--ink-faint)]">Loading the library…</p>}
      {error && <p className="p-4 text-sm text-[var(--danger)]">Couldn't load /exercises — is the API running?</p>}
      {library && seed && (
        <>
          {variant === "A" && <VariantWeek key="A" library={library} seed={structuredClone(seed)} />}
          {variant === "B" && <VariantDays key="B" library={library} seed={structuredClone(seed)} />}
          {variant === "C" && <VariantPaste key="C" library={library} />}
        </>
      )}
      <PrototypeSwitcher variants={VARIANTS} />
    </div>
  );
}
