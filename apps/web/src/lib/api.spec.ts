import { describe, expect, it } from "vitest";
import { api } from "./api";
import { http, HttpResponse, server } from "../test/server";

/**
 * `api.me()` is the seam the admin UI will branch on (DN-92). Nothing renders
 * off it yet — the write endpoints it would gate are Phase 2 — so this pins
 * the contract now, while the API shape and the client agree.
 */
describe("api.me", () => {
  it("reads the caller's identity and admin flag", async () => {
    await expect(api.me()).resolves.toEqual({
      id: "user_alice",
      isAdmin: false,
    });
  });

  it("carries the admin flag through when the API reports one", async () => {
    server.use(
      http.get("/api/me", () =>
        HttpResponse.json({ id: "user_admin", isAdmin: true }),
      ),
    );
    await expect(api.me()).resolves.toEqual({
      id: "user_admin",
      isAdmin: true,
    });
  });
});
