import { describe, expect, it } from "vitest";
import {
  humanize,
  isFiltered,
  readFilters,
  searchQuery,
  writeFilters,
  type LibraryFilters,
} from "./libraryFilters";

/**
 * The library's filters as the URL holds them (DN-171): read leniently, since
 * a link is typed or pasted, and written with only what narrows the list.
 */

const read = (search: string) => readFilters(new URLSearchParams(search));

const DEFAULTS: LibraryFilters = {
  q: "",
  muscle: null,
  equipment: null,
  category: null,
  level: null,
  pattern: null,
  owned: true,
  page: 1,
};

describe("readFilters", () => {
  it("reads a bare /library as the default view, kit switch on", () => {
    expect(read("")).toEqual(DEFAULTS);
  });

  it("reads every filter the URL names", () => {
    expect(
      read("q=push&muscle=chest&equipment=dumbbell&category=strength&level=expert&pattern=push&kit=all&page=3"),
    ).toEqual({
      q: "push",
      muscle: "chest",
      equipment: "dumbbell",
      category: "strength",
      level: "expert",
      pattern: "push",
      owned: false,
      page: 3,
    });
  });

  it("drops a value it doesn't know rather than emptying the page", () => {
    expect(read("muscle=elbows&level=godlike&pattern=dance")).toEqual(DEFAULTS);
  });

  it.each(["0", "-2", "1.5", "two", ""])("reads page=%s as the first page", (page) => {
    expect(read(`page=${page}`).page).toBe(1);
  });

  it("keeps the kit switch on for anything but kit=all", () => {
    expect(read("kit=mine").owned).toBe(true);
  });

  it("trims the search", () => {
    expect(read("q=%20%20squat%20").q).toBe("squat");
  });
});

describe("writeFilters", () => {
  it("writes the default view as nothing at all", () => {
    expect(writeFilters(DEFAULTS).toString()).toBe("");
  });

  it("names only what differs from the default", () => {
    expect(
      writeFilters({ ...DEFAULTS, q: "row", level: "beginner", owned: false, page: 2 }).toString(),
    ).toBe("q=row&level=beginner&kit=all&page=2");
  });

  it("round-trips through readFilters", () => {
    const filters: LibraryFilters = { ...DEFAULTS, muscle: "lats", equipment: "bar", page: 4 };
    expect(readFilters(writeFilters(filters))).toEqual(filters);
  });
});

describe("searchQuery", () => {
  it("always tells the API the kit switch and the page", () => {
    // The API's default for `owned` is off, the page's on: leaving it out
    // would show the whole library on the default view.
    expect(searchQuery(DEFAULTS)).toBe("owned=true&page=1");
  });

  it("passes the filters along", () => {
    expect(searchQuery({ ...DEFAULTS, q: "pull up", muscle: "biceps", owned: false })).toBe(
      "q=pull+up&muscle=biceps&owned=false&page=1",
    );
  });
});

describe("isFiltered", () => {
  it("doesn't count the kit switch or the page", () => {
    expect(isFiltered({ ...DEFAULTS, owned: false, page: 3 })).toBe(false);
  });

  it("counts a search or any list filter", () => {
    expect(isFiltered({ ...DEFAULTS, q: "squat" })).toBe(true);
    expect(isFiltered({ ...DEFAULTS, category: "cardio" })).toBe(true);
  });
});

describe("humanize", () => {
  it("reads a dataset value as words", () => {
    expect(humanize("lower_back")).toBe("Lower back");
    expect(humanize("olympic_weightlifting")).toBe("Olympic weightlifting");
    expect(humanize("chest")).toBe("Chest");
  });
});
