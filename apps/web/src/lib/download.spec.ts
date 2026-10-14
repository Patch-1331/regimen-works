import { afterEach, describe, expect, it, vi } from "vitest";
import { saveJson } from "./download";

describe("saveJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("saves the data as a named JSON file, and lets go of it afterwards", async () => {
    let blob: Blob | undefined;
    const create = vi.fn((b: Blob) => {
      blob = b;
      return "blob:file";
    });
    const revoke = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("routines.json");
        expect(this.href).toBe("blob:file");
      });

    saveJson("routines.json", { format: "x", routines: [] });

    expect(click).toHaveBeenCalledOnce();
    expect(blob?.type).toBe("application/json");
    expect(JSON.parse(await blob!.text())).toEqual({ format: "x", routines: [] });
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:file"));
  });
});
