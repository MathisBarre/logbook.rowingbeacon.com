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
): string => {
  return SERIOUSNESS_CATEGORIES.find((t) => t.type === type)?.label || type;
};

export const SERIOUSNESS_CATEGORIES = [
  {
    order: 0,
    type: null,
    label: null,
  },
  {
    order: 1,
    type: SeriousnessCategoryEnum.RECREATIONAL,
    label: "Loisir",
  },
  {
    order: 2,
    type: SeriousnessCategoryEnum.COMPETITOR,
    label: "Compétiteur",
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
