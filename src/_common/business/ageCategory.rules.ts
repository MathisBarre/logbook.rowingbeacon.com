/**
 * ----- Typing -----
 */

export enum AgeCategoryEnum {
  J10 = "J10",
  J12 = "J12",
  J14 = "J14",
  J16 = "J16",
  J18 = "J18",
  SENIOR = "Senior",
}

/**
 * ----- Constants -----
 */

export const AGE_CATEGORIES = [
  {
    order: 0,
    category: null,
  },
  {
    order: 1,
    category: AgeCategoryEnum.J10,
  },
  {
    order: 2,
    category: AgeCategoryEnum.J12,
  },
  {
    order: 3,
    category: AgeCategoryEnum.J14,
  },
  {
    order: 4,
    category: AgeCategoryEnum.J16,
  },
  {
    order: 5,
    category: AgeCategoryEnum.J18,
  },
  {
    order: 7,
    category: AgeCategoryEnum.SENIOR,
  },
] as const;

/**
 * ----- Business rules -----
 */

export const sortByAgeCategoryOrder = (
  a: AgeCategoryEnum | undefined,
  b: AgeCategoryEnum | undefined
) => {
  const aOrder = findAgeCategoryOrder(a);
  const bOrder = findAgeCategoryOrder(b);

  return -(aOrder - bOrder);
};

export const findAgeCategoryOrder = (
  ageCategory: AgeCategoryEnum | null | undefined
) => {
  return AGE_CATEGORIES.find((cat) => cat.category === ageCategory)?.order || 0;
};
