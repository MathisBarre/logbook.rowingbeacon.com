import { TFunction } from "i18next";
import { BoatTypeEnum } from "./boat.rules";

export const getTypeLabelTranslated = (
  type: string | undefined,
  t: TFunction
) => {
  if (!type) return t("common.other");

  switch (type) {
    case BoatTypeEnum.ONE_ROWER_COXLESS:
      return t("boat.oneRowerCoxless");
    case BoatTypeEnum.TWO_ROWERS_COXLESS:
      return t("boat.twoRowersCoxless");
    case BoatTypeEnum.TWO_ROWERS_COXED:
      return t("boat.twoRowersCoxed");
    case BoatTypeEnum.FOUR_ROWERS_COXLESS:
      return t("boat.fourRowersCoxless");
    case BoatTypeEnum.FOUR_ROWERS_COXED:
      return t("boat.fourRowersCoxed");
    case BoatTypeEnum.EIGHT_ROWERS_COXED:
      return t("boat.eightRowersCoxed");
    case BoatTypeEnum.OTHER:
      return t("common.other");
    default:
      return t("common.other");
  }
};
