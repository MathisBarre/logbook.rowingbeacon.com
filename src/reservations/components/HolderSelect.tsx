import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import CreatableSelect from "react-select/creatable";
import { SelectStyles } from "../../_common/components/ReactSelect";
import {
  isSamePersonName,
  normalizePersonName,
  personNameIncludes,
} from "../../_common/business/crew.rules";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";

export interface Holder {
  rowerId: string | null;
  personName: string;
}

interface HolderOption {
  value: string;
  label: string;
}

/**
 * Who holds the reservation: a rower found by typing a few letters, or a free
 * name (a crew, a group, a course…) when nobody in the list matches.
 */
export const HolderSelect = ({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Holder;
  onChange: (holder: Holder) => void;
}) => {
  const { t } = useTranslation();
  const allRowers = useClubOverviewStore((state) => state.clubOverview.rowers);

  const activeRowers = useMemo(
    () =>
      allRowers.filter(
        (rower) =>
          !rower.archivedAt && !rower.mergedIntoId && rower.status !== "guest"
      ),
    [allRowers]
  );
  const options: HolderOption[] = useMemo(
    () =>
      activeRowers
        .map((rower) => ({ value: rower.id, label: rower.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [activeRowers]
  );

  // A name typed but not confirmed with Enter is kept when the field loses
  // focus, instead of being silently dropped by the select.
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const commitTypedName = () => {
    const name = normalizePersonName(input);
    if (!name) return;
    const rower = activeRowers.find((rower) =>
      isSamePersonName(rower.name, name)
    );
    onChange(
      rower
        ? { rowerId: rower.id, personName: "" }
        : { rowerId: null, personName: name }
    );
  };

  // A rower archived since stays readable on the reservation being edited.
  const selected: HolderOption | null = value.rowerId
    ? {
        value: value.rowerId,
        label:
          allRowers.find((rower) => rower.id === value.rowerId)?.name ?? "",
      }
    : value.personName
      ? { value: `name:${value.personName}`, label: value.personName }
      : null;

  return (
    <CreatableSelect
      inputId={id}
      styles={SelectStyles}
      maxMenuHeight={208}
      isClearable
      options={options}
      // "Léa  Martin" (two spaces) or "lea" still finds Léa Martin.
      filterOption={(option, search) =>
        personNameIncludes(option.label, search)
      }
      value={selected}
      inputValue={input}
      onInputChange={(text, { action }) => {
        if (action === "input-change") setInput(text);
        else if (action !== "input-blur" && action !== "menu-close")
          setInput("");
      }}
      onBlur={() => {
        commitTypedName();
        setInput("");
      }}
      onMenuOpen={() => setMenuOpen(true)}
      onMenuClose={() => setMenuOpen(false)}
      // Enter with the menu closed (after Esc) would submit the form without
      // the typed name: keep it first, a second Enter submits.
      onKeyDown={(event) => {
        if (event.key !== "Enter" || menuOpen || !input.trim()) return;
        event.preventDefault();
        commitTypedName();
        setInput("");
      }}
      placeholder={t("reservations.holderPlaceholder")}
      noOptionsMessage={() => t("reservations.holderNoOptions")}
      createOptionPosition="last"
      formatCreateLabel={(name) =>
        t("reservations.holderUseName", { name: normalizePersonName(name) })
      }
      // A name that is a rower is picked from the list, not typed.
      isValidNewOption={(name) =>
        name.trim().length > 0 &&
        !activeRowers.some((rower) => isSamePersonName(rower.name, name))
      }
      onCreateOption={(name) => {
        setInput("");
        onChange({ rowerId: null, personName: normalizePersonName(name) });
      }}
      onChange={(option) => {
        setInput("");
        const picked = option as HolderOption | null;
        onChange({ rowerId: picked?.value ?? null, personName: "" });
      }}
    />
  );
};
