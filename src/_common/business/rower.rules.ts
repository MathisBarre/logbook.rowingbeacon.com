import { v4 } from "uuid";
import { forEnum } from "../utils/utils";
import { SeriousnessCategoryEnum } from "./seriousness.rules";
import { AgeCategoryEnum } from "./ageCategory.rules";
import i18n from "../i18n/config";

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
    return i18n.t("session.typeNotSpecified");
  }

  return forEnum(rowerType, {
    competitor: () => i18n.t("seriousness.competitor"),
    recreational: () => i18n.t("seriousness.recreational"),
  });
};
