import { ReactNode, useState } from "react";
import { BoatListWrapper } from "./BoatListWrapper";
import { BoatListContent } from "./BoatListContent";
import { Boat } from "../../../_common/types/boat.type";

interface BoatListProps {
  boats: Boat[];
  label: string;
  onBoatRowClick: (boat: { id: string; name: string }) => void;
  icon: ReactNode;
}

export const BoatsList = ({
  boats,
  label,
  onBoatRowClick,
  icon,
}: BoatListProps) => {
  const [search, setSearch] = useState("");
  return (
    <BoatListWrapper
      search={search}
      setSearch={setSearch}
      label={label}
      icon={icon}
    >
      <BoatListContent
        search={search}
        boats={boats}
        onBoatRowClick={onBoatRowClick}
      />
    </BoatListWrapper>
  );
};
