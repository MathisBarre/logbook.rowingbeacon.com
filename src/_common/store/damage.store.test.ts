import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../database/migrations";
import { createTestSqlClient } from "../database/testing/nodeSqlClient";
import {
  flushWrites,
  resetWriteQueueForTests,
  setWriteClient,
} from "../database/writeQueue";
import { useDamageStore } from "./damage.store";
import { useClubOverviewStore } from "./clubOverview.store";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const NOW = "2026-10-28T08:00:00.000Z";

describe("damage store", () => {
  let db: ReturnType<typeof createTestSqlClient>;

  beforeEach(async () => {
    db = createTestSqlClient();
    await applyMigrations(db);
    resetWriteQueueForTests();
    setWriteClient(db);
    useDamageStore.getState().reset();
    await db.execute(
      "INSERT INTO boat (id, name, created_at, updated_at) VALUES ('boat', 'Boat', $1, $1)",
      [NOW]
    );
    await db.execute(
      "INSERT INTO outing (id, boat_id, start_date_time, created_at, updated_at) VALUES ('outing', 'boat', '2026-10-28T07:00', $1, $1)",
      [NOW]
    );
  });

  it("keeps the repair note when the boat is simply put back in service", () => {
    const store = useDamageStore.getState();
    const damage = store.reportDamage({
      boatId: "boat",
      severity: "unusable",
      description: "Broken rigger",
    });
    store.updateDamage(damage.id, { repairNote: "Part ordered" });

    store.setBoatOutOfService("boat", false);

    const [fixed] = useDamageStore.getState().damages;
    expect(fixed.fixedAt).not.toBeNull();
    expect(fixed.repairNote).toBe("Part ordered");
  });

  it("clears a former maintenance flag that has no entry to close", async () => {
    await db.execute("UPDATE boat SET is_in_maintenance = 1 WHERE id = 'boat'");

    useDamageStore.getState().setBoatOutOfService("boat", false);

    await flushWrites();
    const [boat] = await db.select<{ is_in_maintenance: number }[]>(
      "SELECT is_in_maintenance FROM boat WHERE id = 'boat'"
    );
    expect(boat.is_in_maintenance).toBe(0);
  });

  it("can still save a damage whose outing was deleted", async () => {
    const store = useDamageStore.getState();
    const damage = store.reportDamage({
      boatId: "boat",
      severity: "limited",
      description: "Scratch",
      outingId: "outing",
    });
    await flushWrites();
    await db.execute("DELETE FROM outing WHERE id = 'outing'");

    store.detachFromSession("outing");
    store.fixDamage(damage.id);

    await flushWrites();
    const rows = await db.select<{ fixed_at: string | null }[]>(
      "SELECT fixed_at FROM boat_damage"
    );
    expect(rows[0].fixed_at).not.toBeNull();
  });

  it("keeps a boat with a former maintenance flag blocked when another damage changes", async () => {
    await db.execute(
      "INSERT INTO boat (id, name, created_at, updated_at) VALUES ('flagged', 'Flagged', $1, $1)",
      [NOW]
    );
    useClubOverviewStore.setState((state) => ({
      clubOverview: {
        ...state.clubOverview,
        boats: [
          { id: "boat", name: "Boat", isInMaintenance: false },
          { id: "flagged", name: "Flagged", isInMaintenance: true },
        ] as typeof state.clubOverview.boats,
      },
    }));
    const store = useDamageStore.getState();
    store.hydrate([], ["flagged"]);
    const isBlocked = () =>
      useClubOverviewStore
        .getState()
        .clubOverview.boats.find((boat) => boat.id === "flagged")
        ?.isInMaintenance;

    store.reportDamage({
      boatId: "boat",
      severity: "limited",
      description: "Scratch",
    });
    expect(isBlocked()).toBe(true);

    store.setBoatOutOfService("flagged", false);
    expect(isBlocked()).toBe(false);
  });
});
