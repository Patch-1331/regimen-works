import { NavLink } from "react-router-dom";

/**
 * The two halves of the library (DN-29).
 *
 * A sub-nav rather than two bottom tabs: movements and workouts are one
 * library seen two ways, and a five-tab bar that grew to six would be saying
 * they are two unrelated places. It sits under the heading on both screens, so
 * whichever one you land on tells you the other exists.
 */
const views = [
  { to: "/library", label: "Movements", end: true },
  { to: "/library/wods", label: "Workouts", end: false },
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
