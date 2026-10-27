import { useCallback, useMemo } from "react";
import { Boat, BoatTypeEnum } from "../../../_common/business/boat.rules";
import {
  getBoatsByType,
  getTypelessBoats,
} from "../../../_common/business/boat.rules";

export const useSearchInBoats = (boats: Boat[], search: string) => {
  const searchFilter = useCallback(
    (boat: Boat) => {
      return boat.name.toLowerCase().includes(search.toLowerCase());
    },
    [search]
  );

  const oneRowerBoats = useMemo(
    () => getBoatsByType(boats, [BoatTypeEnum.ONE_ROWER_COXLESS]), //
    [boats]
  );

  const twoRowerBoats = useMemo(
    () =>
      getBoatsByType(boats, [
        BoatTypeEnum.TWO_ROWERS_COXLESS,
        BoatTypeEnum.TWO_ROWERS_COXED,
      ]),
    [boats]
  );

  const fourRowerBoats = useMemo(
    () =>
      getBoatsByType(boats, [
        BoatTypeEnum.FOUR_ROWERS_COXLESS,
        BoatTypeEnum.FOUR_ROWERS_COXED,
      ]),
    [boats]
  );

  const eightRowerBoats = useMemo(
    () => getBoatsByType(boats, [BoatTypeEnum.EIGHT_ROWERS_COXED]),
    [boats]
  );

  const otherBoats = useMemo(() => getBoatsByType(boats, ["OTHER"]), [boats]);

  const typelessBoat = useMemo(() => getTypelessBoats(boats), [boats]);

  const filteredOneRowerBoats = useMemo(
    () => oneRowerBoats.filter(searchFilter),
    [oneRowerBoats, searchFilter]
  );

  const filteredTwoRowerBoats = useMemo(
    () => twoRowerBoats.filter(searchFilter),
    [twoRowerBoats, searchFilter]
  );

  const filteredFourRowerBoats = useMemo(
    () => fourRowerBoats.filter(searchFilter),
    [fourRowerBoats, searchFilter]
  );

  const filteredEightRowerBoats = useMemo(
    () => eightRowerBoats.filter(searchFilter),
    [eightRowerBoats, searchFilter]
  );

  const filteredOtherBoats = useMemo(
    () => otherBoats.filter(searchFilter),
    [otherBoats, searchFilter]
  );

  const filteredTypelessBoats = useMemo(
    () => typelessBoat.filter(searchFilter),
    [typelessBoat, searchFilter]
  );

  const oneRowerBoatsLabel = getSectionCountLabel(
    filteredOneRowerBoats.length,
    oneRowerBoats.length,
    search
  );

  const twoRowerBoatsLabel = getSectionCountLabel(
    filteredTwoRowerBoats.length,
    twoRowerBoats.length,
    search
  );

  const fourRowerBoatsLabel = getSectionCountLabel(
    filteredFourRowerBoats.length,
    fourRowerBoats.length,
    search
  );

  const eightRowerBoatsLabel = getSectionCountLabel(
    filteredEightRowerBoats.length,
    eightRowerBoats.length,
    search
  );

  const otherAndTypelessBoatsLabel = getSectionCountLabel(
    filteredOtherBoats.length + filteredTypelessBoats.length,
    otherBoats.length + typelessBoat.length,
    search
  );

  return {
    filteredOneRowerBoats,
    filteredTwoRowerBoats,
    filteredFourRowerBoats,
    filteredEightRowerBoats,
    filteredOtherBoats,
    filteredTypelessBoats,
    oneRowerBoatsLabel,
    twoRowerBoatsLabel,
    fourRowerBoatsLabel,
    eightRowerBoatsLabel,
    otherAndTypelessBoatsLabel,
  };
};

export const getSectionCountLabel = (
  filteredCount: number,
  totalCount: number,
  search: string
) => {
  return search ? `${filteredCount} / ${totalCount}` : totalCount.toString();
};
