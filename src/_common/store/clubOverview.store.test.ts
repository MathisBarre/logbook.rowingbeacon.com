import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../database/migrations";
import { createTestSqlClient } from "../database/testing/nodeSqlClient";
import {
  flushWrites,
  resetWriteQueueForTests,
  setWriteClient,
} from "../database/writeQueue";
import { useClubOverviewStore } from "./clubOverview.store";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const club = (boat: string) => ({
  club: { password: "hash" },
  boats: [{ id: `id-${boat}`, name: boat }],
  rowers: [{ id: `id-r-${boat}`, name: "Léa Martin" }],
  routes: [],
});

describe("club set up at onboarding", () => {
  let db: ReturnType<typeof createTestSqlClient>;

  beforeEach(async () => {
    db = createTestSqlClient();
    await applyMigrations(db);
    resetWriteQueueForTests();
    setWriteClient(db);
  });

  it("replaces a club saved by an earlier attempt instead of adding to it", async () => {
    const first = useClubOverviewStore.getState().setClubOverview(club("A"));
    const second = useClubOverviewStore.getState().setClubOverview(club("B"));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    await flushWrites();

    const boats = await db.select<{ name: string }[]>("SELECT name FROM boat");
    expect(boats).toEqual([{ name: "B" }]);
    const rowers = await db.select<{ id: string }[]>("SELECT id FROM rower");
    expect(rowers).toHaveLength(1);
  });
});
