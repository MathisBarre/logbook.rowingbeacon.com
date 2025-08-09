import { useStore } from "zustand";
import {
  getBoatsByType,
  getTypelessBoats,
  isBoatAvailable,
} from "../../../_common/business/boat.rules";
import { FormLabel } from "../../../_common/components/Form";
import { useSessionsStore } from "../../../_common/store/sessions.store";
import { Boat } from "../../../_common/business/boat.rules";
import { boatLevelConfigStoreCore } from "../../../_common/store/boatLevelConfig.store";
import {
  getSeriousnessTypeTranslation,
  SeriousnessCategoryEnum,
} from "../../../_common/business/seriousness.rules";
import { AgeCategoryEnum } from "../../../_common/business/ageCategory.rules";
import { useMemo } from "react";

interface BoatsSectionProps {
  boats: {
    id: string;
    name: string;
    note?: string;
    ageCategory: AgeCategoryEnum | null;
    seriousnessCategory: SeriousnessCategoryEnum | null;
  }[];
  value: {
    id: string;
    name: string;
    note?: string;
  };
  onChange: (value: {
    id: string;
    name: string;
    type?: string;
    note?: string;
    ageCategory?: AgeCategoryEnum | null;
    seriousnessCategory?: SeriousnessCategoryEnum | null;
  }) => void;
}

export const BoatSection = ({
  boats: _boats,
  onChange,
  value,
}: BoatsSectionProps) => {
  const boatLevelConfigStore = useStore(boatLevelConfigStoreCore);

  const boats = useMemo(
    () =>
      _boats.map((boat) => {
        const append = [];

        if (boat.ageCategory) {
          append.push(boat.ageCategory);
        }

        if (boat.seriousnessCategory) {
          append.push(getSeriousnessTypeTranslation(boat.seriousnessCategory));
        }

        return {
          ...boat,
          name: `${boat.name} ${
            append.length > 0 ? `(${append.join(" - ")})` : ""
          }`,
        };
      }),
    [_boats, boatLevelConfigStore]
  );

  return (
    <div className="flex flex-col gap-1 flex-1">
      <FormLabel>Bateau</FormLabel>
      <select
        name="boats"
        id="boat"
        className="input"
        onChange={(e) => {
          const boatId = e.target.value;

          const boat = boats.find((boat) => boat.id === boatId);

          if (boat) {
            onChange(boat);
          }
        }}
        value={value.id}
      >
        <Optgroup
          label="1x"
          boats={getBoatsByType(boats, ["ONE_ROWER_COXLESS"])}
        />
        <Optgroup
          label="2x / 2-"
          boats={getBoatsByType(boats, [
            "TWO_ROWERS_COXLESS",
            "TWO_ROWERS_COXED",
          ])}
        />
        <Optgroup
          label="4x / 4- / 4+"
          boats={getBoatsByType(boats, [
            "FOUR_ROWERS_COXLESS",
            "FOUR_ROWERS_COXED",
          ])}
        />
        <Optgroup
          label="8x / 8+"
          boats={getBoatsByType(boats, ["EIGHT_ROWERS_COXED"])}
        />

        <Optgroup label="Autre" boats={getBoatsByType(_boats, ["OTHER"])} />

        <Optgroup label="Type non précisé" boats={getTypelessBoats(_boats)} />
      </select>
    </div>
  );
};

interface OptgroupProps {
  label: string;
  boats: Boat[];
}

const Optgroup = ({ label, boats }: OptgroupProps) => {
  const ongoingSessions = useSessionsStore().getOngoingSessions();

  return (
    <optgroup label={label}>
      {boats.map((boat) => {
        return isBoatAvailable(boat, ongoingSessions) &&
          !boat.isInMaintenance ? (
          <option key={boat.id} value={boat.id}>
            {boat.name}
          </option>
        ) : (
          <option key={boat.id} value={boat.id} disabled>
            {boat.name}
          </option>
        );
      })}
    </optgroup>
  );
};
