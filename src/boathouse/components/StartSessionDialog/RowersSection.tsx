import { useState } from "react";
import { Label } from "../../../_common/components/Label";
import { ReactSelect } from "../../../_common/components/ReactSelect";
import { Rower } from "../../../_common/types/rower.type";
import {
  areStringSimilar,
  simplifyString,
} from "../../../_common/utils/string.utils";

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
    .map((rower) => ({
      value: rower.id,
      label: rower.name,
    }))
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
    })
    .slice(0, 5);
};
