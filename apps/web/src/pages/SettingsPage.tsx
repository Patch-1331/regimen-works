import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EQUIPMENT_CATALOG, type Equipment, type UpdateSettings } from "@regimen-works/shared";
import { api } from "../lib/api";

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
