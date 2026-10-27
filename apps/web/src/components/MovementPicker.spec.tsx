import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fixtures from "../test/fixtures";
import { HttpResponse, http, server } from "../test/server";
import { MovementPicker } from "./MovementPicker";

/**
 * Choosing a movement, kit first (DN-194). The athlete here owns the designs'
 * example kit -- dumbbells, bench, bands, pull-up bar -- and no barbell, so
 * Barbell Bench Press is the movement they can name but not do.
 */

const library = fixtures.pickerLibrary();

function picker(props: Partial<Parameters<typeof MovementPicker>[0]> = {}) {
  server.use(
    http.get("/api/settings", () =>
      HttpResponse.json(fixtures.settings({ equipment: fixtures.PICKER_KIT })),
    ),
  );
  const onPick = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MovementPicker
        library={library}
        context="Monday · movement 4"
        onPick={onPick}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onPick, onClose, client };
}

const search = () => screen.getByLabelText("Search movements");

/** Settled once the kit has loaded: before then nothing is gated. */
async function kitLoaded() {
  await screen.findByText(/you can do\s+with your kit/);
}

afterEach(() => localStorage.clear());

describe("the movement picker", () => {
  it("opens on recent searches and the movements used most", async () => {
    localStorage.setItem("movement-picker-recent", JSON.stringify(["goblet"]));
    server.use(
      http.get("/api/movement-volume", () =>
        HttpResponse.json([fixtures.movementVolume({ exerciseId: "pull-up", name: "Pull-up" })]),
      ),
    );
    const { onPick } = picker();

    expect(screen.getByRole("dialog", { name: "Add a movement" })).toBeInTheDocument();
    expect(screen.getByText("MONDAY · MOVEMENT 4")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /^Pull-up/ }));
    expect(onPick).toHaveBeenCalledWith({ exerciseId: "pull-up", movementGroup: null });

    await userEvent.click(screen.getByRole("button", { name: "goblet" }));
    expect(search()).toHaveValue("goblet");
  });

  it("lists what the kit can do, and folds away what it can't", async () => {
    const { onPick } = picker();
    await userEvent.type(search(), "press");
    await kitLoaded();

    expect(screen.getByText(/7 movements · 4 you can do\s+with your kit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Band Chest Press BEST MATCH/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Leg Press/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /3 more need kit you don't have/ }));
    expect(screen.getByRole("button", { name: /^Leg Press/ })).toHaveTextContent("NEEDS GYM MACHINES");
    expect(screen.getAllByRole("button", { name: /like it you can do/ })).toHaveLength(3);

    await userEvent.click(screen.getByRole("button", { name: /^Band Chest Press/ }));
    expect(onPick).toHaveBeenCalledWith({ exerciseId: "band-chest", movementGroup: null });
    expect(JSON.parse(localStorage.getItem("movement-picker-recent")!)).toEqual(["press"]);
  });

  it("shows everything when the kit filter is off", async () => {
    picker();
    await userEvent.type(search(), "press");
    await kitLoaded();
    await userEvent.click(screen.getByRole("checkbox", { name: "Only what my kit can do" }));
    expect(screen.getByText("7 movements")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Leg Press/ })).toBeInTheDocument();
  });

  it("leads an exact match the kit can't do with what it can", async () => {
    const { onPick } = picker();
    await userEvent.type(search(), "barbell bench press");

    const card = await screen.findByRole("region", { name: "Barbell Bench Press" });
    expect(card).toHaveTextContent("Needs a barbell, which isn't in your kit.");
    expect(card).toHaveTextContent("Works chest, triceps and shoulders.");
    const closest = screen.getByRole("button", { name: /^Dumbbell Bench Press CLOSEST/ });
    await userEvent.click(closest);
    expect(onPick).toHaveBeenLastCalledWith({ exerciseId: "db-bench", movementGroup: null });

    await userEvent.click(within(card).getByRole("button", { name: "Add it anyway" }));
    expect(onPick).toHaveBeenLastCalledWith({ exerciseId: "bb-bench", movementGroup: null });
  });

  it("adds the missing kit to Settings when the athlete has it after all", async () => {
    const sent: unknown[] = [];
    server.use(
      http.patch("/api/settings", async ({ request }) => {
        const body = (await request.json()) as { equipment: string[] };
        sent.push(body);
        return HttpResponse.json(fixtures.settings({ equipment: body.equipment as never }));
      }),
    );
    picker();
    await userEvent.type(search(), "barbell bench press");
    await userEvent.click(await screen.findByRole("button", { name: "I have a barbell" }));

    expect(sent).toEqual([{ equipment: [...fixtures.PICKER_KIT, "barbell"] }]);
    // Covered now, so the exact match is an ordinary result.
    expect(
      await screen.findByRole("button", { name: /^Barbell Bench Press BEST MATCH/ }),
    ).toBeInTheDocument();
  });

  it("offers a near name, a muscle, or a movement of the athlete's own for a name it lacks", async () => {
    const created = fixtures.apiExercise({ id: "landmine", name: "Landmine Press", ownerId: "me" });
    const posted: unknown[] = [];
    server.use(
      http.post("/api/exercises", async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const { onPick } = picker({ allowCreate: true });
    await userEvent.type(search(), "landmine pres");

    expect(screen.getByRole("heading", { name: "No “landmine pres” in the library" })).toBeInTheDocument();
    expect(screen.getByText(/Did you mean/)).toBeInTheDocument();

    const works = screen.getByRole("group", { name: "What should it work?" });
    await userEvent.click(within(works).getByRole("button", { name: "Shoulders" }));
    expect(screen.getByRole("button", { name: /^Pike Push-up/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Push Press/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Add “Landmine Pres” to my movements/ }));
    const name = screen.getByLabelText("Movement name");
    await userEvent.clear(name);
    await userEvent.type(name, "Landmine Press");
    const form = within(screen.getByRole("form", { name: "New movement" }));
    await userEvent.click(form.getByRole("button", { name: "Shoulders" }));
    await userEvent.click(form.getByRole("button", { name: "Dumbbell" }));
    // The muscle match's suggestion, taken with one tap (DN-205).
    await userEvent.click(await form.findByRole("button", { name: "Use Push-up" }));
    await userEvent.click(screen.getByRole("button", { name: "Add and use it" }));

    await vi.waitFor(() =>
      expect(onPick).toHaveBeenCalledWith({ exerciseId: "landmine", movementGroup: null }),
    );
    expect(posted[0]).toMatchObject({
      name: "Landmine Press",
      equipment: ["dumbbell"],
      unit: "reps",
      primaryMuscles: ["shoulders"],
      fallbackExerciseId: "exercise-1",
    });
  });

  it("offers no movement of their own where the program can't hold one", async () => {
    picker({ allowCreate: false });
    await userEvent.type(search(), "landmine");
    expect(screen.queryByRole("button", { name: /to my movements/ })).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const { onClose } = picker();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
