import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/", label: "Today" },
  { to: "/history", label: "History" },
  { to: "/stats", label: "Stats" },
  { to: "/library", label: "Library" },
  { to: "/programs", label: "Programs" },
  { to: "/settings", label: "Settings" },
];

/**
 * Six tabs since Programs got its own (DN-179). At 10px and 0.1em they fit a
 * 375px screen with room between them; at the old 11px and 0.14em,
 * PROGRAMS and SETTINGS filled their tabs edge to edge and ran together.
 */
export function TabBar() {
  return (
    <nav
      aria-label="Tabs"
      className="flex"
      style={{ borderTop: "1px solid var(--border)", background: "var(--panel)" }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/"}
          className="flex-1 py-3 text-center text-[10px] font-semibold tracking-[0.1em]"
          style={({ isActive }) => ({
            fontFamily: "var(--font-mono)",
            color: isActive ? "var(--glow)" : "var(--ink-faint)",
            textShadow: isActive ? "0 0 8px var(--glow-tint)" : "none",
          })}
        >
          {tab.label.toUpperCase()}
        </NavLink>
      ))}
    </nav>
  );
}
