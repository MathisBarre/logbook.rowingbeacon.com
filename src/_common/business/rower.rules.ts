import { v4 } from "uuid";
import { forEnum } from "../utils/utils";
import { SeriousnessCategoryEnum } from "./seriousness.rules";
import { AgeCategoryEnum } from "./ageCategory.rules";

/**
 * ----- Typing -----
 */

export interface Rower {
  id: string;
  name: string;
  archivedAt?: string | undefined;
  type?: SeriousnessCategoryEnum | undefined;
  category?: AgeCategoryEnum | undefined;
}

/**
 * ----- Business rules -----
 */

export const generateRowerId = () => {
  return `rower-${v4()}`;
};

export const getRowerTypeLabel = (rowerType: Rower["type"]) => {
  if (rowerType === undefined) {
    return "Non renseigné";
  }

  return forEnum(rowerType, {
    competitor: () => "Compétiteur",
    recreational: () => "Loisir",
  });
};
