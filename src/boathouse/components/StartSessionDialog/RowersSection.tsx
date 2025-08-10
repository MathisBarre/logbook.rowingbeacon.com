import React, { useState } from "react";
import { Label } from "../../../_common/components/Label";
import { ReactSelect } from "../../../_common/components/ReactSelect";
import { Rower, isGuestRower } from "../../../_common/business/rower.rules";
import {
  areStringSimilar,
  simplifyString,
} from "../../../_common/utils/string.utils";
import { getSeriousnessTypeTranslation } from "../../../_common/business/seriousness.rules";
import { components } from "react-select";
import { UserPlusIcon } from "lucide-react";
import Button from "../../../_common/components/Button";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";

interface RowersSectionProps {
  rowers: Rower[];
  onChange: (
    value: {
      id: string;
      name: string;
    }[]
  ) => void;
  values: {
    id: string;
    name: string;
  }[];
  errorMessage?: string;
  onAddGuestRower?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MenuList = (props: any) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
  const limitedChildren = React.Children.toArray(props.children).slice(0, 5);

  return (
    <components.MenuList {...props}>{limitedChildren}</components.MenuList>
  );
};

export const RowersSection = ({
  onChange,
  values,
  errorMessage,
  onAddGuestRower,
}: Omit<RowersSectionProps, "rowers">) => {
  const [input, setInput] = useState("");

  // Récupérer la liste mise à jour des rameurs depuis le store
  const { getAllRowers } = useClubOverviewStore();
  const allRowers = getAllRowers();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Label>Rameurs</Label>
        <Button
          type="button"
          variant="outlined"
          onClick={onAddGuestRower}
          className="text-xs px-2 py-1 h-auto"
        >
          <UserPlusIcon className="h-3 w-3 mr-1" />
          Ajouter un invité
        </Button>
      </div>

      <ReactSelect
        components={{ MenuList }}
        maxMenuHeight={208}
        isMulti
        name="rowersIds"
        options={getOptions(allRowers, input)}
        onInputChange={(input) => setInput(input)}
        onChange={(selected) => {
          if (!isArrayOfOptions(selected)) {
            return;
          }

          onChange(
            selected.map((option) => ({
              id: option.value,
              name: option.label,
            }))
          );
        }}
        value={values.map((value) => ({
          value: value.id,
          label: value.name,
        }))}
      />
      {errorMessage && <p className="form-error">{errorMessage}</p>}
    </div>
  );
};

const isArrayOfOptions = (
  value: unknown
): value is { value: string; label: string }[] => {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        typeof item.value === "string" &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        typeof item.label === "string"
    )
  );
};

const getOptions = (rowers: Rower[], searchInput: string) => {
  return rowers
    .map((rower) => {
      const append = [
        rower.category,
        getSeriousnessTypeTranslation(rower.type),
      ].filter(Boolean);

      // Ajouter un indicateur pour les rameurs invités
      const guestIndicator = isGuestRower(rower) ? " 👤 Invité" : "";

      return {
        value: rower.id,
        label: `${rower.name}${guestIndicator} ${
          append.length > 0 ? `(${append.join(" - ")})` : ""
        }`,
      };
    })
    .filter((option) => areStringSimilar(option.label, searchInput))
    .sort((a, b) => a.label.localeCompare(b.label))
    .sort((a, b) => {
      const aLabel = simplifyString(a.label);
      const bLabel = simplifyString(b.label);
      const simplifiedInput = simplifyString(searchInput);

      if (
        aLabel.startsWith(simplifiedInput) &&
        !bLabel.startsWith(simplifiedInput)
      ) {
        return -1;
      }

      if (
        !aLabel.startsWith(simplifiedInput) &&
        bLabel.startsWith(simplifiedInput)
      ) {
        return 1;
      }

      return 0;
    });
};
