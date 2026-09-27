import { NavLink } from "react-router-dom";

/**
 * The views of the library (DN-29): movements, workouts, and the routines
 * built from them (DN-145).
 *
 * A sub-nav rather than more bottom tabs: these are one library seen several
 * ways, and a five-tab bar that grew would be saying they are unrelated
 * places. It sits under the heading on every view, so whichever one you land
 * on tells you the others exist.
 */
const views = [
  { to: "/library", label: "Movements", end: true },
  { to: "/library/wods", label: "Workouts", end: false },
  { to: "/library/routines", label: "Routines", end: false },
];

export function LibraryNav() {
  return (
    <nav
      aria-label="Library sections"
      className="mt-4 flex"
      style={{ border: "1px solid var(--border)" }}
    >
      {views.map((view) => (
        <NavLink
          key={view.to}
          to={view.to}
          end={view.end}
          className="flex-1 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={({ isActive }) => ({
            fontFamily: "var(--font-mono)",
            background: isActive ? "var(--panel-2)" : "transparent",
            color: isActive ? "var(--glow)" : "var(--ink-faint)",
          })}
        >
          {view.label}
        </NavLink>
      ))}
    </nav>
  );
}
