export enum BoatTypeEnum {
  "ONE_ROWER_COXLESS" = "ONE_ROWER_COXLESS",
  "TWO_ROWERS_COXLESS" = "TWO_ROWERS_COXLESS",
  "TWO_ROWERS_COXED" = "TWO_ROWERS_COXED",
  "FOUR_ROWERS_COXLESS" = "FOUR_ROWERS_COXLESS",
  "FOUR_ROWERS_COXED" = "FOUR_ROWERS_COXED",
  "EIGHT_ROWERS_COXED" = "EIGHT_ROWERS_COXED",
  "OTHER" = "OTHER",
}

export const boathTypeWithLabel = [
  { type: BoatTypeEnum.ONE_ROWER_COXLESS, label: "1x" },
  { type: BoatTypeEnum.TWO_ROWERS_COXLESS, label: "2x / 2-" },
  { type: BoatTypeEnum.TWO_ROWERS_COXED, label: "2+" },
  { type: BoatTypeEnum.FOUR_ROWERS_COXLESS, label: "4x / 4-" },
  { type: BoatTypeEnum.FOUR_ROWERS_COXED, label: "4+" },
  { type: BoatTypeEnum.EIGHT_ROWERS_COXED, label: "8x / 8+" },
  { type: BoatTypeEnum.OTHER, label: "Autre" },
];

export interface Boat {
  id: string;
  name: string;
  isInMaintenance?: boolean;
  type?: BoatTypeEnum;
  rowersQuantity?: number;
}
