import { create } from "zustand";
import { v4 } from "uuid";
import { enqueueWrite } from "../database/writeQueue";
import { saveBoatDamage } from "../database/repositories/club.repository";
import {
  BoatDamage,
  DamageSeverity,
} from "../database/repositories/club.types";
import {
  getOpenDamagesOfBoat,
  getUnusableBoatIds,
  isBoatUnusable,
  sortDamages,
} from "../business/damage.rules";
import { useClubOverviewStore } from "./clubOverview.store";

export interface ReportDamageInput {
  boatId: string;
  severity: DamageSeverity;
  description: string;
  reportedAt?: string;
  reportedByRowerId?: string | null;
  outingId?: string | null;
  incidentId?: string | null;
}

export interface FixDamageInput {
  fixedAt?: string;
  fixedByRowerId?: string | null;
  repairNote?: string | null;
  repairCost?: number | null;
}

type DamageChanges = Partial<
  Pick<
    BoatDamage,
    | "severity"
    | "description"
    | "reportedAt"
    | "reportedByRowerId"
    | "fixedAt"
    | "fixedByRowerId"
    | "repairNote"
    | "repairCost"
  >
>;

interface DamageStoreState {
  damages: BoatDamage[];
  /**
   * Boats still carrying the former maintenance flag because the upgrade
   * could not move it yet: they stay unusable until put back in service.
   */
  legacyMaintenanceBoatIds: Set<string>;
  hydrate: (
    damages: BoatDamage[],
    legacyMaintenanceBoatIds?: Iterable<string>
  ) => void;
  /** Open first, most serious first. */
  getDamages: () => BoatDamage[];
  getDamagesOfBoat: (boatId: string) => BoatDamage[];
  getOpenDamagesOfBoat: (boatId: string) => BoatDamage[];
  reportDamage: (input: ReportDamageInput) => BoatDamage;
  updateDamage: (damageId: string, changes: DamageChanges) => void;
  fixDamage: (damageId: string, input?: FixDamageInput) => void;
  reopenDamage: (damageId: string) => void;
  /**
   * The simple "out of service" switch: on, it adds an "unavailable" entry
   * unless the boat is already unusable; off, it closes every open entry
   * that makes the boat unusable.
   */
  setBoatOutOfService: (boatId: string, outOfService: boolean) => void;
  /** The outing was deleted: SQLite already set `outing_id` to NULL. */
  detachFromSession: (sessionId: string) => void;
  reset: () => void;
}

const write = (damage: BoatDamage) => {
  void enqueueWrite("damage", (db) => saveBoatDamage(db, damage));
};

/** Boats keep an in-memory "unusable" flag that the boathouse reads. */
const syncBoats = (damages: BoatDamage[]) => {
  const unusableBoatIds = getUnusableBoatIds(damages);
  for (const boatId of useDamageStore.getState().legacyMaintenanceBoatIds) {
    unusableBoatIds.add(boatId);
  }
  useClubOverviewStore.getState().syncUnusableBoats(unusableBoatIds);
};

export const useDamageStore = create<DamageStoreState>()((set, get) => {
  const change = (damageId: string, changes: Partial<BoatDamage>) => {
    const current = get().damages.find((damage) => damage.id === damageId);
    if (!current) return;
    const updated = { ...current, ...changes };
    const damages = get().damages.map((damage) =>
      damage.id === damageId ? updated : damage
    );
    set({ damages });
    syncBoats(damages);
    write(updated);
  };

  return {
    damages: [],
    legacyMaintenanceBoatIds: new Set(),
    hydrate(damages, legacyMaintenanceBoatIds = []) {
      set({
        damages,
        legacyMaintenanceBoatIds: new Set(legacyMaintenanceBoatIds),
      });
    },
    getDamages() {
      return sortDamages(get().damages);
    },
    getDamagesOfBoat(boatId) {
      return sortDamages(
        get().damages.filter((damage) => damage.boatId === boatId)
      );
    },
    getOpenDamagesOfBoat(boatId) {
      return getOpenDamagesOfBoat(get().damages, boatId);
    },
    reportDamage(input) {
      const damage: BoatDamage = {
        id: v4(),
        boatId: input.boatId,
        kind: "damage",
        severity: input.severity,
        description: input.description.trim(),
        reportedAt: input.reportedAt ?? new Date().toISOString(),
        reportedByRowerId: input.reportedByRowerId ?? null,
        outingId: input.outingId ?? null,
        incidentId: input.incidentId ?? null,
        fixedAt: null,
        fixedByRowerId: null,
        repairNote: null,
        repairCost: null,
      };
      const damages = [damage, ...get().damages];
      set({ damages });
      syncBoats(damages);
      write(damage);
      return damage;
    },
    updateDamage(damageId, changes) {
      const current = get().damages.find((damage) => damage.id === damageId);
      // An "unavailable" entry stays unusable: that is what it means.
      const severity =
        current?.kind === "unavailable" ? undefined : changes.severity;
      change(damageId, {
        ...changes,
        ...(severity ? { severity } : { severity: current?.severity }),
      });
    },
    fixDamage(damageId, input = {}) {
      const current = get().damages.find((damage) => damage.id === damageId);
      // A field the caller leaves out keeps its value (the simple "back in
      // service" switch gives none).
      change(damageId, {
        fixedAt: input.fixedAt ?? new Date().toISOString(),
        fixedByRowerId: input.fixedByRowerId ?? null,
        repairNote:
          input.repairNote === undefined
            ? (current?.repairNote ?? null)
            : input.repairNote,
        repairCost:
          input.repairCost === undefined
            ? (current?.repairCost ?? null)
            : input.repairCost,
      });
    },
    reopenDamage(damageId) {
      // The note and cost stay: efa2 damages carry notes while open, and the
      // repair form starts from them.
      change(damageId, { fixedAt: null, fixedByRowerId: null });
    },
    setBoatOutOfService(boatId, outOfService) {
      const damages = get().damages;
      if (outOfService) {
        if (isBoatUnusable(damages, boatId)) return;
        const entry: BoatDamage = {
          id: v4(),
          boatId,
          kind: "unavailable",
          severity: "unusable",
          description: "",
          reportedAt: new Date().toISOString(),
          reportedByRowerId: null,
          outingId: null,
          incidentId: null,
          fixedAt: null,
          fixedByRowerId: null,
          repairNote: null,
          repairCost: null,
        };
        const next = [entry, ...damages];
        set({ damages: next });
        syncBoats(next);
        write(entry);
        return;
      }
      for (const damage of getOpenDamagesOfBoat(damages, boatId)) {
        if (damage.severity === "unusable") get().fixDamage(damage.id);
      }
      // A former maintenance flag the upgrade could not move would keep the
      // boat blocked with nothing to close: clear it too.
      void enqueueWrite("boat", (db) =>
        db.execute("UPDATE boat SET is_in_maintenance = 0 WHERE id = $1", [
          boatId,
        ])
      );
      if (get().legacyMaintenanceBoatIds.has(boatId)) {
        const legacyMaintenanceBoatIds = new Set(get().legacyMaintenanceBoatIds);
        legacyMaintenanceBoatIds.delete(boatId);
        set({ legacyMaintenanceBoatIds });
      }
      syncBoats(get().damages);
    },
    detachFromSession(sessionId) {
      set({
        damages: get().damages.map((damage) =>
          damage.outingId === sessionId ? { ...damage, outingId: null } : damage
        ),
      });
    },
    reset() {
      set({ damages: [], legacyMaintenanceBoatIds: new Set() });
    },
  };
});
