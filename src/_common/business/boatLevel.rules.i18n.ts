import { TFunction } from "i18next";
import { AgeCategoryEnum } from "./ageCategory.rules";
import {
  SERIOUSNESS_CATEGORIES,
  SeriousnessCategoryEnum,
} from "./seriousness.rules";

/** Sentence stating a boat's minimum rower level, or null when it has none. */
export const getBoatLevelRestrictionText = (
  boat: {
    ageCategory: AgeCategoryEnum | null | undefined;
    seriousnessCategory: SeriousnessCategoryEnum | null | undefined;
  },
  t: TFunction
): string | null => {
  const ageCategory = boat.ageCategory || null;
  const seriousnessKey = SERIOUSNESS_CATEGORIES.find(
    (category) => category.type === (boat.seriousnessCategory || null)
  )?.translationKey;
  const seriousnessCategory = seriousnessKey ? t(seriousnessKey) : null;

  if (ageCategory && seriousnessCategory) {
    return t("session.minimumAgeAndSeriousnessCategoryRequired", {
      ageCategory,
      seriousnessCategory,
    });
  }
  if (ageCategory) {
    return t("session.minimumAgeCategoryRequired", { ageCategory });
  }
  if (seriousnessCategory) {
    return t("session.minimumSeriousnessCategoryRequired", {
      seriousnessCategory,
    });
  }
  return null;
};
