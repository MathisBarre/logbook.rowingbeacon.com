import { describe, expect, it } from "vitest";
import {
  beginDemo,
  consumeDemoGuidePending,
  DEMO_ADMIN_PASSWORD_HINT,
  DEMO_CHECKLIST_KEY,
  DEMO_STATE_KEY,
  DemoStorage,
  endDemo,
  formatLocalNow,
  getActiveDatabaseFile,
  getActiveDatabaseUrl,
  getDatabaseUrl,
  getDemoExitLabelKey,
  isDemoMode,
  markDemoSeeded,
  readDemoChecklist,
  readDemoState,
  scheduleDemoReseed,
  toDemoLocale,
  writeDemoChecklist,
} from "./demoMode";
import { DEMO_ADMIN_PASSWORD } from "./seedDemoClub";

const createStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  const storage: DemoStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
  return { storage, values };
};

/** localStorage as a private window may leave it: every access throws. */
const brokenStorage: DemoStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("demo flag", () => {
  it("is off by default and opens main.db", () => {
    const { storage } = createStorage();
    expect(isDemoMode(storage)).toBe(false);
    expect(getActiveDatabaseUrl(storage)).toBe("sqlite:main.db");
  });

  it("opens demo.db once entered", () => {
    const { storage } = createStorage();
    expect(beginDemo(false, storage)).toBe(true);
    expect(isDemoMode(storage)).toBe(true);
    expect(getActiveDatabaseUrl(storage)).toBe("sqlite:demo.db");
  });

  it("names the open file for the statistics engine", () => {
    const { storage } = createStorage();
    expect(getActiveDatabaseFile(storage)).toBe("main.db");
    beginDemo(false, storage);
    expect(getActiveDatabaseFile(storage)).toBe("demo.db");
    expect(getActiveDatabaseFile(brokenStorage)).toBe("main.db");
  });

  it("maps the mode to the database", () => {
    expect(getDatabaseUrl(false)).toBe("sqlite:main.db");
    expect(getDatabaseUrl(true)).toBe("sqlite:demo.db");
  });

  it("starts with a seed, the guide, and remembers the real club", () => {
    const { storage } = createStorage();
    beginDemo(true, storage);
    expect(readDemoState(storage)).toEqual({
      active: true,
      seedPending: true,
      hadRealClub: true,
      guidePending: true,
    });
  });

  it("keeps the demo club on a restart: no seed once seeded", () => {
    const { storage } = createStorage();
    beginDemo(false, storage);
    markDemoSeeded(storage);
    expect(readDemoState(storage).seedPending).toBe(false);
    expect(isDemoMode(storage)).toBe(true);
  });

  it("seeds again after a reset, without reopening the guide", () => {
    const { storage } = createStorage();
    beginDemo(true, storage);
    markDemoSeeded(storage);
    consumeDemoGuidePending(storage);
    expect(scheduleDemoReseed(storage)).toBe(true);
    expect(readDemoState(storage)).toEqual({
      active: true,
      seedPending: true,
      hadRealClub: true,
      guidePending: false,
    });
  });

  it("does not schedule a reseed outside the demo", () => {
    const { storage, values } = createStorage();
    expect(scheduleDemoReseed(storage)).toBe(false);
    expect(values.size).toBe(0);
  });

  it("opens the guide only once", () => {
    const { storage } = createStorage();
    beginDemo(false, storage);
    expect(consumeDemoGuidePending(storage)).toBe(true);
    expect(consumeDemoGuidePending(storage)).toBe(false);
  });

  it("returns to main.db on exit and forgets the ticks", () => {
    const { storage, values } = createStorage();
    beginDemo(true, storage);
    writeDemoChecklist(["startOuting"], storage);
    expect(endDemo(storage)).toBe(true);
    expect(isDemoMode(storage)).toBe(false);
    expect(getActiveDatabaseUrl(storage)).toBe("sqlite:main.db");
    expect(values.has(DEMO_STATE_KEY)).toBe(false);
    expect(values.has(DEMO_CHECKLIST_KEY)).toBe(false);
  });

  it("clears the ticks when a demo starts or is reset", () => {
    const { storage, values } = createStorage();
    writeDemoChecklist(["old"], storage);
    beginDemo(false, storage);
    expect(values.has(DEMO_CHECKLIST_KEY)).toBe(false);
    writeDemoChecklist(["startOuting"], storage);
    scheduleDemoReseed(storage);
    expect(readDemoChecklist(storage)).toEqual([]);
  });

  it("ignores a corrupted flag", () => {
    expect(
      isDemoMode(createStorage({ [DEMO_STATE_KEY]: "{oops" }).storage)
    ).toBe(false);
    expect(
      isDemoMode(createStorage({ [DEMO_STATE_KEY]: "null" }).storage)
    ).toBe(false);
    expect(
      isDemoMode(
        createStorage({ [DEMO_STATE_KEY]: '{"active":"yes"}' }).storage
      )
    ).toBe(false);
  });

  it("stays on the real club when the storage is blocked", () => {
    expect(isDemoMode(brokenStorage)).toBe(false);
    expect(isDemoMode(null)).toBe(false);
    expect(beginDemo(true, brokenStorage)).toBe(false);
    expect(beginDemo(true, null)).toBe(false);
    expect(endDemo(brokenStorage)).toBe(false);
    expect(getActiveDatabaseUrl(brokenStorage)).toBe("sqlite:main.db");
  });
});

describe("demo checklist", () => {
  it("round-trips the ticked steps", () => {
    const { storage } = createStorage();
    writeDemoChecklist(["a", "b"], storage);
    expect(readDemoChecklist(storage)).toEqual(["a", "b"]);
  });

  it("starts empty and survives garbage and a blocked storage", () => {
    expect(readDemoChecklist(createStorage().storage)).toEqual([]);
    expect(
      readDemoChecklist(createStorage({ [DEMO_CHECKLIST_KEY]: "{" }).storage)
    ).toEqual([]);
    expect(
      readDemoChecklist(
        createStorage({ [DEMO_CHECKLIST_KEY]: '["a", 3, null]' }).storage
      )
    ).toEqual(["a"]);
    expect(readDemoChecklist(brokenStorage)).toEqual([]);
    expect(() => writeDemoChecklist(["a"], brokenStorage)).not.toThrow();
  });
});

describe("getDemoExitLabelKey", () => {
  it("says where leaving the demo goes", () => {
    expect(getDemoExitLabelKey(true)).toBe("demo.banner.backToClub");
    expect(getDemoExitLabelKey(false)).toBe("demo.banner.createClub");
  });
});

describe("toDemoLocale", () => {
  it("keeps the six seeded languages", () => {
    for (const locale of [
      "fr-FR",
      "en-US",
      "en-GB",
      "de-DE",
      "it-IT",
      "nl-NL",
    ]) {
      expect(toDemoLocale(locale)).toBe(locale);
    }
  });

  it("maps the other English variants and unknown values", () => {
    expect(toDemoLocale("en-AU")).toBe("en-GB");
    expect(toDemoLocale("en-NZ")).toBe("en-GB");
    expect(toDemoLocale("en-CA")).toBe("en-US");
    expect(toDemoLocale(null)).toBe("en-US");
  });
});

describe("formatLocalNow", () => {
  it("formats the local date-time without seconds", () => {
    expect(formatLocalNow(new Date(2026, 5, 7, 9, 5, 42))).toBe(
      "2026-06-07T09:05"
    );
    expect(formatLocalNow(new Date(2026, 11, 31, 23, 59))).toBe(
      "2026-12-31T23:59"
    );
  });
});

describe("admin password hint", () => {
  it("is the password the seed sets", () => {
    expect(DEMO_ADMIN_PASSWORD_HINT).toBe(DEMO_ADMIN_PASSWORD);
  });
});
