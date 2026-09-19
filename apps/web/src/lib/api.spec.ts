import { describe, expect, it } from "vitest";
import { api } from "./api";
import { http, HttpResponse, server } from "../test/server";

/**
 * `api.me()` is the seam the admin UI will branch on (DN-92), and since
 * DN-15 the one the setup gate reads: a null `onboardedAt` is what sends a
 * new athlete into the wizard, so it is a field the client must carry through
 * exactly as sent rather than coerce.
 */
describe("api.me", () => {
  it("reads the caller's identity and admin flag", async () => {
    await expect(api.me()).resolves.toEqual({
      id: "user_alice",
      isAdmin: false,
      onboardedAt: "2026-09-01T08:00:00.000Z",
    });
  });

  it("carries the admin flag through when the API reports one", async () => {
    server.use(
      http.get("/api/me", () =>
        HttpResponse.json({
          id: "user_admin",
          isAdmin: true,
          onboardedAt: "2026-09-01T08:00:00.000Z",
        }),
      ),
    );
    await expect(api.me()).resolves.toEqual({
      id: "user_admin",
      isAdmin: true,
      onboardedAt: "2026-09-01T08:00:00.000Z",
    });
  });

  // The un-onboarded athlete. Null has to survive the round trip as null:
  // anything else -- undefined, a dropped key -- reads as "onboarded" to the
  // gate and puts a brand-new athlete into an app configured by nobody.
  it("carries a null onboardedAt through as null", async () => {
    server.use(
      http.get("/api/me", () =>
        HttpResponse.json({
          id: "user_alice",
          isAdmin: false,
          onboardedAt: null,
        }),
      ),
    );
    await expect(api.me()).resolves.toEqual({
      id: "user_alice",
      isAdmin: false,
      onboardedAt: null,
    });
  });
});
