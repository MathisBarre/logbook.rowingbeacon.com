import { ReactNode, useState } from "react";
import { BoatListWrapper } from "./BoatListWrapper";
import { BoatListContent } from "./BoatListContent";
import { Boat } from "../../../_common/business/boat.rules";

interface BoatListProps {
  boats: Boat[];
  label: string;
  onBoatRowClick: (boat: { id: string; name: string }) => void;
  icon: ReactNode;
  headerAction?: ReactNode;
}

export const BoatsList = ({
  boats,
  label,
  onBoatRowClick,
  icon,
  headerAction,
}: BoatListProps) => {
  const [search, setSearch] = useState("");
  return (
    <BoatListWrapper
      search={search}
      setSearch={setSearch}
      label={label}
      icon={icon}
      headerAction={headerAction}
    >
      <BoatListContent
        search={search}
        boats={boats}
        onBoatRowClick={onBoatRowClick}
      />
    </BoatListWrapper>
  );
};
