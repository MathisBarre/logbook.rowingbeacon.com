import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { z } from "zod";
import { exportJson } from "./export";
import { useClubOverviewStore } from "../store/clubOverview.store";
import { BoatTypeEnum } from "../business/boat.rules";
import { SeriousnessCategoryEnum } from "../business/seriousness.rules";
import { AgeCategoryEnum } from "../business/ageCategory.rules";
import i18n from "../i18n/config";

const BoatSchema = z.object({
  id: z.string(),
  name: z.string().trim(),
  isInMaintenance: z.boolean().optional(),
  type: z.nativeEnum(BoatTypeEnum).optional(),
  note: z.string().optional(),
  archivedAt: z.string().optional(),
});

const RouteSchema = z.object({
  id: z.string(),
  name: z.string().trim(),
  // Distances module: kept so that a backup brings the km back.
  distanceM: z.number().nonnegative().nullable().optional(),
  archivedAt: z.string().optional(),
});

const RowerSchema = z.object({
  id: z.string(),
  name: z.string().trim(),
  archivedAt: z.string().optional(),
  type: z.nativeEnum(SeriousnessCategoryEnum).optional(),
  category: z.nativeEnum(AgeCategoryEnum).optional(),
});

const ExportDataSchema = z.object({
  boats: z.array(BoatSchema),
  routes: z.array(RouteSchema),
  rowers: z.array(RowerSchema),
});

const ExportDataArraySchema = z.array(ExportDataSchema);

export type ExportData = z.infer<typeof ExportDataSchema>;

export const exportAllData = async () => {
  const store = useClubOverviewStore.getState();
  const boats = store.clubOverview.boats;
  const routes = store.clubOverview.routes;
  // Guests have no status in this format: an import would turn them into
  // members, so the export keeps the club's own members only.
  const rowers = store.clubOverview.rowers.filter(
    (rower) => rower.status !== "guest"
  );

  const exportData: ExportData = {
    boats,
    routes,
    rowers,
  };

  const fileName = `rowingbeacon-export-${
    new Date().toISOString().split("T")[0]
  }.json`;

  // Validate data before export
  const validatedData = ExportDataArraySchema.parse([exportData]);

  await exportJson({
    data: validatedData,
    fileName,
    fileType: "json",
  });

  return fileName;
};

export const importAllData = async () => {
  const filePath = await open({
    multiple: false,
    filters: [
      {
        name: "JSON",
        extensions: ["json"],
      },
    ],
  });

  if (!filePath) {
    return null;
  }

  const content = await readTextFile(filePath);
  const parsedJson: unknown = JSON.parse(content);

  // Try to validate as array first, then as single object
  let importData: ExportData;

  const arrayResult = ExportDataArraySchema.safeParse(parsedJson);
  if (arrayResult.success) {
    importData = arrayResult.data[0];
  } else {
    const singleResult = ExportDataSchema.safeParse(parsedJson);
    if (singleResult.success) {
      importData = singleResult.data;
    } else {
      throw new Error(
        i18n.t("import.invalidFile") + " " + singleResult.error.message
      );
    }
  }

  const store = useClubOverviewStore.getState();
  // Read again at each line: a name twice in the file is added once.
  const current = () => useClubOverviewStore.getState().clubOverview;

  let boatsAdded = 0;
  let routesAdded = 0;
  let rowersAdded = 0;

  if (importData.boats) {
    for (const boat of importData.boats) {
      // A hand-edited file may hold a blank name.
      if (boat.archivedAt || !boat.name) continue;

      const existingBoat = current().boats.find(
        (b) => b.name.toLowerCase() === boat.name.toLowerCase()
      );
      if (!existingBoat) {
        store.addBoat({
          name: boat.name,
          type: boat.type,
        });
        boatsAdded++;
      }
    }
  }

  if (importData.routes) {
    for (const route of importData.routes) {
      // A hand-edited file may hold a blank name.
      if (route.archivedAt || !route.name) continue;

      const existingRoute = current().routes.find(
        (r) => r.name.toLowerCase() === route.name.toLowerCase()
      );
      if (!existingRoute) {
        store.addRoute(route.name, route.distanceM);
        routesAdded++;
      }
    }
  }

  if (importData.rowers) {
    for (const rower of importData.rowers) {
      // A hand-edited file may hold a blank name.
      if (rower.archivedAt || !rower.name) continue;

      const existingRower = current().rowers.find(
        (r) => r.name.toLowerCase() === rower.name.toLowerCase()
      );
      if (!existingRower) {
        store.addRower(rower.name, rower.category, rower.type);
        rowersAdded++;
      }
    }
  }

  return {
    boats: boatsAdded,
    routes: routesAdded,
    rowers: rowersAdded,
  };
};
