import {
  RowerCategoryEnum,
  RowerTypeEnum,
} from "../store/boatLevelConfig.store";

export interface Rower {
  id: string;
  name: string;
  archivedAt?: string | undefined;
  type?: RowerTypeEnum | undefined;
  category?: RowerCategoryEnum | undefined;
}
