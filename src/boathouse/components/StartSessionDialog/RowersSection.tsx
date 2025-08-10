import React, { useState } from "react";
import { Label } from "../../../_common/components/Label";
import { ReactSelect } from "../../../_common/components/ReactSelect";
import { Rower } from "../../../_common/business/rower.rules";
import {
  areStringSimilar,
  simplifyString,
} from "../../../_common/utils/string.utils";
import { getSeriousnessTypeTranslation } from "../../../_common/business/seriousness.rules";
import { components } from "react-select";
import { InfoIcon } from "lucide-react";

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
  rowers,
  onChange,
  values,
  errorMessage,
}: RowersSectionProps) => {
  const [input, setInput] = useState("");

  return (
    <div className="flex flex-col gap-1">
      <Label>Rameurs</Label>
      <ReactSelect
        components={{ MenuList }}
        maxMenuHeight={208}
        isMulti
        name="rowersIds"
        options={getOptions(rowers, input)}
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

      {/* Tooltip pour les rameurs invités */}
      <div className="group relative inline-flex items-center gap-2 text-xs text-gray-600 mt-1 cursor-help">
        <InfoIcon className="h-4 w-4 text-gray-500" />
        <span className="font-medium">À propos des rameurs invités</span>

        {/* Tooltip au hover */}
        <div className="absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-20 max-w-64">
          Si vous avez des rameurs invités qui ne sont pas dans la liste, vous
          pouvez les mentionner dans le champ &quot;Commentaire&quot; et ignorer
          l&apos;avertissement qui s&apos;affichera lors du démarrage de la
          séance.
          <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
        </div>
      </div>
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
      return {
        value: rower.id,
        label: `${rower.name} ${
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
