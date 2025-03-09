import { describe, it } from "vitest";
import { updateBoatTypeFn } from "./clubOverview.store.functions";
import { BoatTypeEnum } from "../business/boat.rules";

describe.concurrent("clubOverview.store.functions", () => {
  it("updateBoatTypeFn", ({ expect }) => {
    const boats = [{ id: "1", name: "Boat 1" }];

    const updatedBoats = updateBoatTypeFn(
      boats,
      "1",
      BoatTypeEnum.ONE_ROWER_COXLESS
    );

    expect(updatedBoats).toEqual([
      { id: "1", name: "Boat 1", type: BoatTypeEnum.ONE_ROWER_COXLESS },
    ]);
  });
});
