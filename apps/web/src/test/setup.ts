import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import "@testing-library/jest-dom/vitest";
import { server } from "./server";

// Vitest runs without globals, so Testing Library's automatic cleanup (which
// hooks a global `afterEach`) never registers itself. Unmount explicitly, or
// every test after the first queries a document holding all its predecessors.
afterEach(() => {
  cleanup();
});

// The API is stubbed at the network boundary for every suite (DN-49).
// `onUnhandledRequest: "error"` is the point of it: a page that starts calling
// a new endpoint fails loudly here instead of quietly rendering a loading
// state forever.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
