import {
  RowerCategoryEnum,
  RowerTypeEnum,
} from "../store/boatLevelConfig.business";

export interface Rower {
  id: string;
  name: string;
  archivedAt?: string | undefined;
  type?: RowerTypeEnum | undefined;
  category?: RowerCategoryEnum | undefined;
}
