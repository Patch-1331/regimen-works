import type { ComponentProps } from "react";
import { SignIn } from "@clerk/clerk-react";
import { useLocation } from "react-router-dom";
import { Mark } from "../components/Mark";

/**
 * The tokens in index.css, as values rather than `var()`s: Clerk derives
 * shades from its colour variables, which it cannot do with a `var()`, and it
 * sets custom properties of its own inside the form — a `--border` among them
 * — that shadow ours.
 */
const t = {
  bg: "#0d0906",
  panel: "#1c140d",
  ink: "#f2ece2",
  inkSoft: "#b8ab97",
  inkFaint: "#9c8f7a",
  border: "#3a2c1c",
  glow: "#ff9130",
  danger: "#d1503f",
  display: '"Rajdhani", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", monospace',
};

/**
 * Clerk's form in our colours (DN-196).
 *
 * Its own header goes — the page's headline says what the form is for — and
 * so does its footer link: sign-up is invite-only (set in Clerk on
 * 2026-09-07), so "Don't have an account? Sign up" leads nowhere.
 */
const signInAppearance = {
  layout: {
    socialButtonsPlacement: "bottom",
    socialButtonsVariant: "blockButton",
  },
  variables: {
    colorPrimary: t.glow,
    colorPrimaryForeground: t.bg,
    colorBackground: t.bg,
    colorForeground: t.ink,
    colorMutedForeground: t.inkSoft,
    colorInput: t.panel,
    colorInputForeground: t.ink,
    colorBorder: t.border,
    colorNeutral: t.ink,
    colorDanger: t.danger,
    borderRadius: "0",
    fontFamily: t.body,
  },
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", boxShadow: "none", border: "none" },
    card: { background: "transparent", boxShadow: "none", padding: 0 },
    header: { display: "none" },
    footer: { background: "transparent" },
    footerAction: { display: "none" },
    formFieldLabel: {
      fontFamily: t.mono,
      fontSize: "0.6875rem",
      fontWeight: 600,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: t.inkSoft,
    },
    formFieldInput: {
      background: t.panel,
      // Clerk draws borders as box-shadows on a `[data-variant]` rule, which
      // outranks a plain override; `&&` outranks it back.
      "&&[data-variant]": { boxShadow: `0 0 0 1px ${t.border}` },
      "&&[data-variant]:focus": { boxShadow: `0 0 0 1px ${t.glow}` },
      padding: "14px 16px",
      fontSize: "1rem",
    },
    formButtonPrimary: {
      background: t.glow,
      backgroundImage: "none",
      color: t.bg,
      "&&[data-variant]": { boxShadow: "none" },
      padding: "16px 24px",
      fontFamily: t.display,
      fontSize: "1.125rem",
      fontWeight: 700,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      "&:hover": { background: t.glow, filter: "brightness(1.08)" },
      // Clerk's sheen; the lit plate is flat.
      "&::after": { display: "none" },
    },
    dividerLine: { background: t.border },
    dividerText: {
      fontFamily: t.mono,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: t.inkFaint,
    },
    socialButtonsBlockButton: {
      background: "transparent",
      "&&[data-variant]": { boxShadow: `0 0 0 1px ${t.border}` },
      padding: "14px 16px",
      color: t.ink,
    },
    socialButtonsBlockButtonText: { fontSize: "1rem", fontWeight: 400 },
  },
} satisfies ComponentProps<typeof SignIn>["appearance"];

/**
 * What a signed-out visitor sees (DN-196): what the app is, Clerk's sign-in
 * (email code or Google, whatever the instance has switched on), and how
 * someone new gets in, since nothing here lets them.
 *
 * The gate renders this in place, at whatever link was opened, and signing in
 * goes back to that link (DN-199). Clerk's own default is `/`, for both the
 * email code and Google's redirect, so the path has to be handed over; the
 * hash is left off because it is Clerk's (`#/factor-one`, `#/sso-callback`).
 * Setup still comes first for anyone who has not finished it: `SetupGate`
 * sees the link before the page does.
 */
export function SignInPage() {
  const { pathname, search } = useLocation();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 pt-16 pb-10">
      <div className="flex items-center gap-4">
        <Mark />
        <span
          className="text-sm font-semibold tracking-[0.3em] text-[var(--glow)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          REGIMEN WORKS
        </span>
      </div>
      <h1
        className="mt-8 text-[2.75rem] leading-[1.05] font-bold uppercase"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Today's training is already decided.
      </h1>
      <p className="mt-5 text-lg text-[var(--ink-soft)]">Sign in and it's waiting for you.</p>

      <div className="mt-16">
        <SignIn
          routing="hash"
          fallbackRedirectUrl={pathname + search}
          appearance={signInAppearance}
        />
      </div>

      <footer className="mt-auto border-t border-[var(--border)] pt-6">
        <p
          className="text-xs font-semibold tracking-[0.14em] text-[var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          INVITE ONLY
        </p>
        <p className="mt-3 text-[var(--ink-faint)]">
          New here? Open the link in your invite email; it signs you up. There's no other way in yet.
        </p>
      </footer>
    </main>
  );
}
