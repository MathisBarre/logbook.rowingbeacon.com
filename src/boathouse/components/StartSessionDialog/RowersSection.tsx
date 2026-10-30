import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "../../../_common/components/Label";
import {
  ReactSelect,
  SelectStyles,
} from "../../../_common/components/ReactSelect";
import { Rower } from "../../../_common/business/rower.rules";
import {
  areStringSimilar,
  simplifyString,
} from "../../../_common/utils/string.utils";
import { getSeriousnessTypeTranslation } from "../../../_common/business/seriousness.rules";
import {
  getCrewMemberKey,
  isSamePersonName,
  normalizePersonName,
  toNewGuestOptionId,
} from "../../../_common/business/crew.rules";
import { components } from "react-select";
import CreatableSelect from "react-select/creatable";
import { SeatSlots } from "./SeatSlots";

export interface CrewOption {
  id: string;
  name: string;
}

interface RowersSectionProps {
  rowers: Rower[];
  onChange: (value: CrewOption[]) => void;
  values: CrewOption[];
  errorMessage?: string;
  /** Number of rowing seats of the chosen configuration, when known. */
  seats?: number | null;
  /** Guests module: a typed name can be added as a guest. */
  allowGuests?: boolean;
  /** Crew already picked in the other field (cox or rowers). */
  excluded?: CrewOption[];
  /** The chosen configuration has a cox, picked in the cox field. */
  coxed?: boolean;
  cox?: CrewOption | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MenuList = (props: any) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
  const children = React.Children.toArray(props.children);
  const last = children[children.length - 1];
  // Keep the "add as guest" entry visible, after the best matches.
  const isNewGuestEntry =
    React.isValidElement<{ data?: { __isNew__?: boolean } }>(last) &&
    last.props.data?.__isNew__ === true;
  const limitedChildren = isNewGuestEntry
    ? [...children.slice(0, Math.min(children.length - 1, 4)), last]
    : children.slice(0, 5);

  return (
    <components.MenuList {...props}>{limitedChildren}</components.MenuList>
  );
};

type SelectOption = { value: string; label: string };

/**
 * Rower picker shared by the rowers and cox fields. With guests allowed, a
 * typed name that matches nobody becomes a new guest option.
 */
const CrewSelect = ({
  rowers,
  isMulti,
  name,
  selected,
  onSelect,
  allowGuests = false,
  excluded = [],
}: {
  rowers: Rower[];
  isMulti: boolean;
  name: string;
  selected: SelectOption[];
  onSelect: (options: SelectOption[]) => void;
  allowGuests?: boolean;
  excluded?: CrewOption[];
}) => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");

  // Nobody can sit twice in the boat, e.g. as a rower and as the cox.
  const takenKeys = new Set(
    [...excluded.map((option) => option.id), ...selected.map((o) => o.value)].map(
      getCrewMemberKey
    )
  );
  const availableRowers = rowers.filter(
    (rower) => !excluded.some((option) => option.id === rower.id)
  );

  const commonProps = {
    components: { MenuList },
    maxMenuHeight: 208,
    isMulti,
    isClearable: !isMulti,
    name,
    options: getOptions(availableRowers, input),
    onInputChange: (newInput: string) => setInput(newInput),
    value: isMulti ? selected : (selected[0] ?? null),
    onChange: (value: unknown) => {
      const options = Array.isArray(value) ? value : value ? [value] : [];
      if (isArrayOfOptions(options)) {
        onSelect(options);
      }
    },
  };

  if (!allowGuests) {
    return <ReactSelect {...commonProps} />;
  }

  return (
    <CreatableSelect
      {...commonProps}
      styles={SelectStyles}
      placeholder=""
      createOptionPosition="last"
      formatCreateLabel={(guestName) =>
        t("session.addGuest", { name: guestName.trim() })
      }
      // A name that is a member, or a guest already in the crew, is not new.
      isValidNewOption={(guestName) =>
        guestName.trim().length > 0 &&
        !rowers.some((rower) => isSamePersonName(rower.name, guestName)) &&
        !takenKeys.has(getCrewMemberKey(toNewGuestOptionId(guestName)))
      }
      onCreateOption={(guestName) => {
        const guest = {
          value: toNewGuestOptionId(guestName),
          label: `${guestName.trim()} (${t("session.guest")})`,
        };
        onSelect(isMulti ? [...selected, guest] : [guest]);
      }}
    />
  );
};

export const RowersSection = ({
  rowers,
  onChange,
  values,
  errorMessage,
  seats,
  allowGuests,
  excluded,
  coxed = false,
  cox = null,
}: RowersSectionProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1">
      <Label>
        {t("session.rowers")}
        {seats ? (
          <span className="text-gray-500 font-normal">
            {" "}
            ({t("session.seatsCount", { count: seats })})
          </span>
        ) : null}
      </Label>
      <CrewSelect
        rowers={rowers}
        isMulti
        name="rowersIds"
        allowGuests={allowGuests}
        excluded={excluded}
        selected={toSelectOptions(values)}
        onSelect={(options) => onChange(fromSelectOptions(options))}
      />
      {seats ? (
        <SeatSlots
          seats={seats}
          rowers={rowers}
          values={values}
          coxed={coxed}
          cox={cox}
        />
      ) : null}
      {errorMessage && <p className="form-error">{errorMessage}</p>}
    </div>
  );
};

export const CoxSection = ({
  rowers,
  onChange,
  value,
  allowGuests,
  excluded,
}: {
  rowers: Rower[];
  onChange: (value: CrewOption | null) => void;
  value: CrewOption | null;
  allowGuests?: boolean;
  excluded?: CrewOption[];
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1">
      <Label>{t("session.cox")}</Label>
      <CrewSelect
        rowers={rowers}
        isMulti={false}
        name="coxId"
        allowGuests={allowGuests}
        excluded={excluded}
        selected={toSelectOptions(value ? [value] : [])}
        onSelect={(options) => onChange(fromSelectOptions(options)[0] ?? null)}
      />
    </div>
  );
};

const toSelectOptions = (values: CrewOption[]): SelectOption[] =>
  values.map((value) => ({ value: value.id, label: value.name }));

const fromSelectOptions = (options: SelectOption[]): CrewOption[] =>
  options.map((option) => ({ id: option.value, name: option.label }));

const isArrayOfOptions = (value: unknown): value is SelectOption[] => {
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

const getOptions = (rowers: Rower[], typedInput: string) => {
  // "Jean  Dupont" (two spaces) still finds Jean Dupont.
  const searchInput = normalizePersonName(typedInput);
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
