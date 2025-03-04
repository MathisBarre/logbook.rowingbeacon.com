import {
  AgeCategoryEnum,
  SeriousnessCategoryEnum,
} from "../store/boatLevelConfig.business";

export interface Rower {
  id: string;
  name: string;
  archivedAt?: string | undefined;
  type?: SeriousnessCategoryEnum | undefined;
  category?: AgeCategoryEnum | undefined;
}
