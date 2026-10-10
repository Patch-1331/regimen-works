import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { server } from "./server";

// Not "@testing-library/jest-dom/vitest": that entry imports `vitest` from
// wherever npm hoisted jest-dom, and Dependabot's lockfile updates sometimes
// nest vitest under the workspace instead. The matchers then never register
// and every `toBeInTheDocument` fails to typecheck. Extending from here
// resolves the workspace's own vitest; jest-dom.d.ts does the same for types.
expect.extend(matchers);

// Vitest runs without globals, so Testing Library's automatic cleanup (which
// hooks a global `afterEach`) never registers itself. Unmount explicitly, or
// every test after the first queries a document holding all its predecessors.
afterEach(() => {
  cleanup();
});

// The API is stubbed at the network boundary for every suite (DN-49).
// `onUnhandledFrame: "error"` is the point of it: a page that starts calling
// a new endpoint fails loudly here instead of quietly rendering a loading
// state forever.
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
