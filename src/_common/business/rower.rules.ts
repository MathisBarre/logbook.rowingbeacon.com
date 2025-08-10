import { v4 } from "uuid";
import { forEnum } from "../utils/utils";
import { SeriousnessCategoryEnum } from "./seriousness.rules";
import { AgeCategoryEnum } from "./ageCategory.rules";

/**
 * ----- Typing -----
 */

export enum GuestRowerTypeEnum {
  OTHER_CLUB = "other_club",
  NOT_YET_MEMBER = "not_yet_member",
}

export interface Rower {
  id: string;
  name: string;
  archivedAt?: string | undefined;
  type?: SeriousnessCategoryEnum | undefined;
  category?: AgeCategoryEnum | undefined;
  // Champs pour les rameurs invités
  guestType?: GuestRowerTypeEnum | null;
  phoneNumber?: string; // Contact pour les invités "pas encore inscrits"
  email?: string; // Contact pour les invités "pas encore inscrits"
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

export const isGuestRower = (rower: Rower): boolean => {
  return rower.guestType !== null && rower.guestType !== undefined;
};
