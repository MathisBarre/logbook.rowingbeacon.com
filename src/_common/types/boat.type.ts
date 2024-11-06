export enum BoatTypeEnum {
  "ONE_ROWER_COXLESS" = "ONE_ROWER_COXLESS",
  "TWO_ROWERS_COXLESS" = "TWO_ROWERS_COXLESS",
  "TWO_ROWERS_COXED" = "TWO_ROWERS_COXED",
  "FOUR_ROWERS_COXLESS" = "FOUR_ROWERS_COXLESS",
  "FOUR_ROWERS_COXED" = "FOUR_ROWERS_COXED",
  "EIGHT_ROWERS_COXED" = "EIGHT_ROWERS_COXED",
  "OTHER" = "OTHER",
}

export interface Boat {
  id: string;
  name: string;
  isInMaintenance?: boolean;
  type?: BoatTypeEnum;
  rowersQuantity?: number;
}
