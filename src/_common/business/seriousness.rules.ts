import i18n from "../i18n/config";

export const findSeriousnessCategoryOrder = (
  seriousnessCategory: SeriousnessCategoryEnum | null | undefined
) => {
  return (
    SERIOUSNESS_CATEGORIES.find((t) => t.type === seriousnessCategory)?.order ||
    0
  );
};
export enum SeriousnessCategoryEnum {
  RECREATIONAL = "recreational",
  COMPETITOR = "competitor",
}

export const getSeriousnessTypeTranslation = (
  type: SeriousnessCategoryEnum | null | undefined
): string | null => {
  const category = SERIOUSNESS_CATEGORIES.find((t) => t.type === type);
  if (!category?.translationKey) {
    return type || null;
  }
  return i18n.t(category.translationKey);
};

export const SERIOUSNESS_CATEGORIES = [
  {
    order: 0,
    type: null,
    translationKey: null,
  },
  {
    order: 1,
    type: SeriousnessCategoryEnum.RECREATIONAL,
    translationKey: "seriousness.recreational",
  },
  {
    order: 2,
    type: SeriousnessCategoryEnum.COMPETITOR,
    translationKey: "seriousness.competitor",
  },
] as const;

export const sortByTypeOrder = (
  a: SeriousnessCategoryEnum | undefined,
  b: SeriousnessCategoryEnum | undefined
) => {
  const aOrder = findSeriousnessCategoryOrder(a);
  const bOrder = findSeriousnessCategoryOrder(b);

  return -(aOrder - bOrder);
};
