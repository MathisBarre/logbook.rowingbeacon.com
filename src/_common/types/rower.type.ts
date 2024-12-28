import {
  RowerCategoryEnum,
  RowerTypeEnum,
} from "../store/boatLevelConfig.store";

export interface Rower {
  id: string;
  name: string;
  type: RowerTypeEnum;
  category: RowerCategoryEnum;
}
