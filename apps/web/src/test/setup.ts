import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// Vitest runs without globals, so Testing Library's automatic cleanup (which
// hooks a global `afterEach`) never registers itself. Unmount explicitly, or
// every test after the first queries a document holding all its predecessors.
afterEach(() => {
  cleanup();
});
