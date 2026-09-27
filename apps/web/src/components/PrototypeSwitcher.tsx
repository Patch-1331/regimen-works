/**
 * PROTOTYPE tooling — floating variant switcher for throwaway UI prototypes.
 * Renders nothing in production builds.
 */
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export function PrototypeSwitcher({ variants }: { variants: { key: string; name: string }[] }) {
  const [params, setParams] = useSearchParams();
  const current = params.get("variant") ?? variants[0].key;
  const idx = Math.max(0, variants.findIndex((v) => v.key === current));

  const go = (delta: number) => {
    const next = variants[(idx + delta + variants.length) % variants.length];
    setParams((p) => { p.set("variant", next.key); return p; }, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;
  return (
    <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-2xl">
      <button onClick={() => go(-1)} aria-label="previous variant">←</button>
      <span>
        {variants[idx].key} ({variants[idx].name})
      </span>
      <button onClick={() => go(1)} aria-label="next variant">→</button>
    </div>
  );
}
