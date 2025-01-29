import { v4 } from "uuid";
import { forEnum } from "../utils/utils";
import { Rower } from "../types/rower.type";

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
