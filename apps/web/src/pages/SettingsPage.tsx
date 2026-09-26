import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EQUIPMENT_CATALOG, type Equipment, type RestPace, type UpdateSettings } from "@regimen-works/shared";
import { api } from "../lib/api";
import { parseRestDraft, restDraftOf, restSecondsOf } from "../lib/rest";
import { WEEKDAYS } from "../lib/weekdays";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error } = useQuery({ queryKey: ["settings"], queryFn: api.settings });

  // One mutation for every toggle: the PATCH carries only the switch that was
  // flipped, so the others keep whatever the server has for them.
  const toggleMutation = useMutation({
    mutationFn: (patch: UpdateSettings) => api.updateSettings(patch),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["settings"], updated);
      await queryClient.invalidateQueries({ queryKey: ["today"] });
      // Stats draws its cap line from GET /schedule-rule, which since DN-12 is
      // `trainingDays.length` derived server-side — the same fact under a
      // different cache key. Without this, changing the days here leaves Stats
      // drawing the old cap until something else happens to refetch it.
      await queryClient.invalidateQueries({ queryKey: ["scheduleRule"] });
    },
  });

  const restMutation = useMutation({
    mutationFn: (defaultRestSeconds: number | null) => api.updateRestPace({ defaultRestSeconds }),
    onSuccess: async (restPace) => {
      queryClient.setQueryData(["settings"], (previous: typeof settings) =>
        previous ? { ...previous, restPace } : previous,
      );
      // Today's plate shows the rest each movement resolves to, which is this.
      await queryClient.invalidateQueries({ queryKey: ["today"] });
    },
  });

  return (
    <div className="p-6">
      <h1 className="text-3xl font-extrabold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        Settings
      </h1>

      {isLoading && <p className="mt-3 text-[var(--ink-faint)]">Loading…</p>}
      {error && <p className="mt-3 text-[var(--danger)]">Couldn't reach the API — is it running on :3001?</p>}

      {settings && (
        <div className="mt-5 flex flex-col gap-3">
          <SettingRow
            title="Warm-up / cool-down"
            description="Show a short checklist before and after each workout."
            checked={settings.warmupCooldownEnabled}
            pending={toggleMutation.isPending}
            onChange={(warmupCooldownEnabled) => toggleMutation.mutate({ warmupCooldownEnabled })}
          />
          <SettingRow
            title="Stop at the time cap"
            description="End the workout when its time cap runs out. Turn this off to keep the clock running past the cap and finish it yourself."
            checked={settings.autoStopAtCapEnabled}
            pending={toggleMutation.isPending}
            onChange={(autoStopAtCapEnabled) => toggleMutation.mutate({ autoStopAtCapEnabled })}
          />
          <EquipmentSetting
            owned={settings.equipment}
            pending={toggleMutation.isPending}
            onChange={(equipment) => toggleMutation.mutate({ equipment })}
          />
          <TrainingDaysSetting
            days={settings.trainingDays}
            pending={toggleMutation.isPending}
            onChange={(trainingDays) => toggleMutation.mutate({ trainingDays })}
          />
          <PatternCooldownSetting
            days={settings.patternCooldownDays}
            pending={toggleMutation.isPending}
            onChange={(patternCooldownDays) => toggleMutation.mutate({ patternCooldownDays })}
          />
          {/* Only while a program with straight sets is running: the pace
              belongs to the run, and Just WODs has no rest between sets. */}
          {settings.restPace && (
            <RestPaceSetting
              // Keyed on the run, so a draft typed against one program never
              // survives into the next.
              key={settings.restPace.enrollmentId}
              pace={settings.restPace}
              pending={restMutation.isPending}
              error={restMutation.error?.message ?? null}
              onChange={(seconds) => restMutation.mutate(seconds)}
            />
          )}
          {/* A workout already under way keeps the rule it started with, so
              say so rather than leaving the athlete to find out at the cap.
              It covers equipment too, and more sharply: unticking a piece
              does not rewrite a workout already generated for today. */}
          <p className="text-[11px] text-[var(--ink-faint)]">
            A change takes effect on your next workout — one already in progress keeps the setting it started with.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * What the athlete owns (DN-35) — the first setting on this screen that is a
 * set rather than a switch, and the only place the equipment work is
 * reachable from.
 *
 * A group of checkboxes rather than a fourth toggle, because the question is
 * not "is equipment on". Each piece carries the catalog's own description:
 * that copy exists to be read while deciding, and the difference between
 * ticking "box" as a plyo box and ticking it as the bottom stair is the
 * difference between an honest library and a lie.
 *
 * Every piece is listed, the bar included. DN-35 said to leave the bar out as
 * the assumed baseline, and the catalog written after it (DN-77) says the
 * opposite in its own comment -- "this array is the settings list" -- with a
 * description written for someone choosing. The catalog wins: `bar` is the
 * app's *default*, not a floor. An athlete with no doorway to hang from can
 * say so, and until they can, five of the eighteen WODs in the library are
 * ones they cannot do.
 */
function EquipmentSetting({
  owned,
  pending,
  onChange,
}: {
  owned: Equipment[];
  pending: boolean;
  onChange: (equipment: Equipment[]) => void;
}) {
  const ownedSet = new Set(owned);

  // The whole set every time: `equipment` is a whole-set replacement with no
  // add or remove verb, so what is sent has to be built from what the server
  // last said -- `owned` comes straight from the settings query -- and never
  // from state initialised at mount, which a second tab's write would have
  // made stale.
  function toggle(piece: Equipment, next: boolean) {
    onChange(
      next
        ? [...owned, piece]
        : owned.filter((p) => p !== piece),
    );
  }

  return (
    <fieldset className="p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
      <legend className="float-left w-full font-semibold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        Your equipment
      </legend>
      <p className="mt-1 text-xs text-[var(--ink-faint)]">
        What you have to train with. Workouts are built from it — anything you don't own is swapped for a
        movement that needs nothing.
      </p>

      <ul className="mt-3 flex flex-col">
        {EQUIPMENT_CATALOG.map((piece) => {
          const checked = ownedSet.has(piece.value);
          const labelId = `equipment-${piece.value}-label`;
          const descriptionId = `equipment-${piece.value}-description`;
          return (
            <li key={piece.value}>
              <label className="flex cursor-pointer items-start gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={pending}
                  onChange={(event) => toggle(piece.value, event.target.checked)}
                  // The piece names the control and the copy describes it,
                  // rather than the label element naming it with both: read
                  // as one string, "Kettlebell ... a dumbbell held by one end
                  // substitutes for most of the rest" is a checkbox that
                  // announces itself as two pieces of equipment.
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                  // Visually replaced by the box below, but a real checkbox:
                  // it carries the keyboard behaviour and the checked state a
                  // screen reader reads out.
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center transition-colors peer-focus-visible:outline peer-focus-visible:outline-2"
                  style={{
                    background: checked ? "var(--glow)" : "var(--panel-2)",
                    border: "1px solid var(--border)",
                    boxShadow: checked ? "0 0 8px var(--glow-tint)" : "none",
                    opacity: pending ? 0.5 : 1,
                    outlineColor: "var(--glow)",
                  }}
                >
                  {checked && (
                    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="var(--panel)" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    id={labelId}
                    className="block text-[13px] font-semibold tracking-wide"
                    style={{ fontFamily: "var(--font-mono)", color: checked ? "var(--ink)" : "var(--ink-soft)" }}
                  >
                    {piece.label}
                  </span>
                  <span id={descriptionId} className="mt-0.5 block text-[11px] leading-snug text-[var(--ink-faint)]">
                    {piece.description}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {owned.length === 0 && (
        // Not a warning. Bodyweight is a real answer and most of the library
        // needs nothing -- but it is a smaller library, and an athlete who
        // ticked nothing by accident should be able to tell.
        <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
          Nothing ticked — every workout will be built from bodyweight movements alone.
        </p>
      )}
    </fieldset>
  );
}


/**
 * Which weekdays the athlete trains on (DN-12, DN-30).
 *
 * Days rather than a count: the quota this replaced knew how many days but
 * never which, so the same Wednesday was a training day or a rest day
 * depending on the order the week had gone in. The count is still shown —
 * it is what an athlete thinks in — but it is *derived* here exactly as it is
 * derived on the server, so there is no second control stating the same fact.
 *
 * **The last remaining day cannot be unticked.** `trainingDaysSchema` refuses
 * an empty week, so a checkbox that could empty it is a control whose only
 * possible outcome is a rejected write. It is disabled and the reason is said
 * out loud, rather than left to be discovered by clicking.
 */
function TrainingDaysSetting({
  days,
  pending,
  onChange,
}: {
  days: number[];
  pending: boolean;
  onChange: (days: number[]) => void;
}) {
  const trained = new Set(days);
  const isLastDay = days.length === 1;

  // Built from `days`, which comes straight from the settings query, and never
  // from state initialised at mount: `trainingDays` is a whole-set replacement
  // with no add or remove verb, so a second tab's write must not be sent back.
  function toggle(day: number, next: boolean) {
    onChange(next ? [...days, day] : days.filter((d) => d !== day));
  }

  return (
    <fieldset className="p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
      <legend className="float-left w-full font-semibold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        Training days
      </legend>
      <p className="mt-1 text-xs text-[var(--ink-faint)]">
        The days the app expects you. Anything else is a rest day.
      </p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {WEEKDAYS.map((day) => {
          const checked = trained.has(day.value);
          // Only the last *checked* box is frozen. The unchecked ones are
          // still how you get back above one day.
          const frozen = checked && isLastDay;
          return (
            <li key={day.value}>
              <label className={frozen ? "block cursor-not-allowed" : "block cursor-pointer"}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={pending || frozen}
                  onChange={(event) => toggle(day.value, event.target.checked)}
                  // The full day name, because "Mon" read aloud on its own is
                  // an abbreviation the listener has to expand.
                  aria-label={day.full}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="flex h-10 w-12 items-center justify-center text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors peer-focus-visible:outline peer-focus-visible:outline-2"
                  style={{
                    background: checked ? "var(--glow)" : "var(--panel-2)",
                    border: "1px solid var(--border)",
                    boxShadow: checked ? "0 0 8px var(--glow-tint)" : "none",
                    color: checked ? "var(--panel)" : "var(--ink-soft)",
                    fontFamily: "var(--font-mono)",
                    opacity: pending || frozen ? 0.5 : 1,
                    outlineColor: "var(--glow)",
                  }}
                >
                  {day.short}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* Derived, never stored: "days per week" is the length of the set and
          the server computes it the same way (DN-12). */}
      <p className="mt-3 text-[11px] text-[var(--ink-faint)]">
        {days.length === 1 ? "1 day a week" : `${days.length} days a week`}
        {isLastDay && " — keep at least one, or there is nothing to open the app for."}
      </p>
    </fieldset>
  );
}

/** The widest window the scheduler can honour; see `patternCooldownDaysSchema`. */
const MAX_COOLDOWN_DAYS = 30;

/**
 * How long before a workout or its pattern comes round again (DN-27, DN-30).
 *
 * A drafted field rather than a live one: `PATCH /settings` on every keystroke
 * would write 1, then 12, on the way to typing 12. The draft commits on blur
 * or Enter, which is also when a number is finished being typed.
 *
 * Out-of-range input is clamped here and explained, rather than sent for the
 * API to refuse — the bound is a fact about the scheduler (it reads this
 * rule's history with `take: 30`), and a screen that knows it should say so
 * rather than make the athlete discover it as an error.
 */
function PatternCooldownSetting({
  days,
  pending,
  onChange,
}: {
  days: number;
  pending: boolean;
  onChange: (days: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(days);

  function commit() {
    const parsed = Number.parseInt(shown, 10);
    // An unreadable or empty box is not a value — fall back to what is stored
    // rather than guessing at zero, which is a real setting of its own.
    const next = Number.isNaN(parsed)
      ? days
      : Math.min(Math.max(parsed, 0), MAX_COOLDOWN_DAYS);
    setDraft(null);
    if (next !== days) onChange(next);
  }

  return (
    <div className="p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
      <label
        htmlFor="pattern-cooldown"
        className="font-semibold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        Repeat cooldown
      </label>
      <p className="mt-1 text-xs text-[var(--ink-faint)]">
        How long before a workout, or another one working the same pattern, can come round again.
      </p>

      <div className="mt-3 flex items-center gap-3">
        <input
          id="pattern-cooldown"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_COOLDOWN_DAYS}
          value={shown}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="w-20 px-2 py-1.5 text-[14px] disabled:opacity-50"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            color: "var(--ink)",
            fontFamily: "var(--font-mono)",
          }}
        />
        <span className="text-[12px] text-[var(--ink-soft)]">
          {days === 0 ? "Off — a workout can come round the next day." : days === 1 ? "day" : "days"}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
        0 turns it off. {MAX_COOLDOWN_DAYS} is the longest the scheduler can hold to — it looks back{" "}
        {MAX_COOLDOWN_DAYS} days and no further.
      </p>
    </div>
  );
}

/**
 * The rest pace for the program being run (ADR 0005, DN-143) -- the same one
 * number the wizard asked for, changeable while the run goes on.
 *
 * Drafted and committed on blur or Enter, like the cooldown. Blank hands the
 * run back to the program's own rests, which is only an answer where it has
 * them everywhere; where it does not, a blank box is put back rather than
 * sent, and says why.
 */
function RestPaceSetting({
  pace,
  pending,
  error,
  onChange,
}: {
  pace: RestPace;
  pending: boolean;
  error: string | null;
  onChange: (seconds: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const shown = draft ?? restDraftOf(pace.defaultRestSeconds);

  function commit() {
    const parsed = parseRestDraft(shown);
    setDraft(null);
    if (parsed.kind === "invalid") {
      setRefused("Rest is a whole number of seconds — 0 for straight through.");
      return;
    }
    if (parsed.kind === "blank" && pace.required) {
      setRefused(`${pace.planName} leaves some rests unstated, so this run needs a pace.`);
      return;
    }
    setRefused(null);
    const next = restSecondsOf(parsed);
    if (next !== pace.defaultRestSeconds) onChange(next);
  }

  const message = refused ?? error;

  return (
    <div className="p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
      <label
        htmlFor="rest-pace"
        className="font-semibold uppercase"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        Rest between sets
      </label>
      <p className="mt-1 text-xs text-[var(--ink-faint)]">
        For every set of {pace.planName}, for as long as this run lasts.
      </p>

      <div className="mt-3 flex items-center gap-3">
        <input
          id="rest-pace"
          inputMode="numeric"
          value={shown}
          disabled={pending}
          aria-invalid={message !== null}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="w-20 px-2 py-1.5 text-[14px] disabled:opacity-50"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            color: "var(--ink)",
            fontFamily: "var(--font-mono)",
          }}
        />
        <span className="text-[12px] text-[var(--ink-soft)]">
          {pace.defaultRestSeconds === null
            ? `As ${pace.planName} is written`
            : pace.defaultRestSeconds === 0
              ? "Straight through"
              : "seconds"}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
        {pace.required
          ? "0 means straight through."
          : `0 means straight through. Leave it blank to rest as ${pace.planName} is written.`}
      </p>
      {message && (
        <p className="mt-2 text-[12px] text-[var(--danger)]" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

function SettingRow({
  title,
  description,
  checked,
  pending,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  pending: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4" style={{ background: "var(--panel)", border: "1px solid var(--border)" }}>
      <div>
        <p className="font-semibold uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
          {title}
        </p>
        <p className="mt-1 text-xs text-[var(--ink-faint)]">{description}</p>
      </div>
      <ToggleSwitch checked={checked} disabled={pending} onChange={onChange} />
    </div>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50"
      style={{
        background: checked ? "var(--glow)" : "var(--panel-2)",
        border: "1px solid var(--border)",
        boxShadow: checked ? "0 0 8px var(--glow-tint)" : "none",
      }}
    >
      <span
        className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
      />
    </button>
  );
}
