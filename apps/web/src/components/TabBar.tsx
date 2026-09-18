import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/", label: "Today" },
  { to: "/history", label: "History" },
  { to: "/stats", label: "Stats" },
  { to: "/library", label: "Library" },
  { to: "/settings", label: "Settings" },
];

export function TabBar() {
  return (
    <nav className="flex" style={{ borderTop: "1px solid var(--border)", background: "var(--panel)" }}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/"}
          className="flex-1 py-3 text-center text-[11px] font-semibold tracking-[0.14em]"
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
