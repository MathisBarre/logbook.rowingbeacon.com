import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { z } from "zod";
import { exportJson } from "./export";
import { useClubOverviewStore } from "../store/clubOverview.store";
import { BoatTypeEnum } from "../business/boat.rules";
import { SeriousnessCategoryEnum } from "../business/seriousness.rules";
import { AgeCategoryEnum } from "../business/ageCategory.rules";

const BoatSchema = z.object({
  id: z.string(),
  name: z.string(),
  isInMaintenance: z.boolean().optional(),
  type: z.nativeEnum(BoatTypeEnum).optional(),
  note: z.string().optional(),
  archivedAt: z.string().optional(),
});

const RouteSchema = z.object({
  id: z.string(),
  name: z.string(),
  archivedAt: z.string().optional(),
});

const RowerSchema = z.object({
  id: z.string(),
  name: z.string(),
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
  const rowers = store.clubOverview.rowers;

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
        "Le fichier ne contient pas de données valides. Erreur de validation : " +
          singleResult.error.message
      );
    }
  }

  const store = useClubOverviewStore.getState();
  const allBoats = store.clubOverview.boats;
  const allRoutes = store.clubOverview.routes;
  const allRowers = store.clubOverview.rowers;

  let boatsAdded = 0;
  let routesAdded = 0;
  let rowersAdded = 0;

  if (importData.boats) {
    for (const boat of importData.boats) {
      if (boat.archivedAt) continue;

      const existingBoat = allBoats.find(
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
      if (route.archivedAt) continue;

      const existingRoute = allRoutes.find(
        (r) => r.name.toLowerCase() === route.name.toLowerCase()
      );
      if (!existingRoute) {
        store.addRoute(route.name);
        routesAdded++;
      }
    }
  }

  if (importData.rowers) {
    for (const rower of importData.rowers) {
      if (rower.archivedAt) continue;

      const existingRower = allRowers.find(
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
