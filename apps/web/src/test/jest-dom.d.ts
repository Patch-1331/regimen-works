// The types half of setup.ts's `expect.extend(matchers)`. Declared here, not
// taken from "@testing-library/jest-dom/vitest", so that `vitest` resolves to
// this workspace's copy however npm lays out node_modules.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  interface Assertion<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchersContaining
    extends TestingLibraryMatchers<unknown, unknown> {}
}
