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
  status?: "member" | "guest" | "other";
  archivedAt?: string | undefined;
  type?: SeriousnessCategoryEnum | undefined;
  category?: AgeCategoryEnum | undefined;
}

/**
 * ----- Business rules -----
 */

/**
 * Split a v1 full name at its first space: "Jean Dupont" gives Jean / Dupont,
 * a single word gives a first name only.
 */
export const splitRowerName = (
  name: string
): { firstName: string; lastName: string } => {
  const normalized = name.trim().replace(/\s+/g, " ");
  const spaceIndex = normalized.indexOf(" ");

  if (spaceIndex === -1) {
    return { firstName: normalized, lastName: "" };
  }

  return {
    firstName: normalized.slice(0, spaceIndex),
    lastName: normalized.slice(spaceIndex + 1),
  };
};

export const getRowerFullName = (rower: {
  firstName: string;
  lastName: string;
}) => {
  return [rower.firstName, rower.lastName].filter(Boolean).join(" ");
};

export const generateRowerId = () => {
  return v4();
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
