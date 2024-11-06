import { useState } from "react";
import { BoatListWrapper } from "./BoatListWrapper";
import { BoatListContent } from "./BoatListContent";
import { Boat } from "../../../_common/types/boat.type";

interface BoatListProps {
  boats: Boat[];
  label: string;
  onBoatRowClick: (boat: { id: string; name: string }) => void;
}

export const BoatsList = ({ boats, label, onBoatRowClick }: BoatListProps) => {
  const [search, setSearch] = useState("");
  return (
    <BoatListWrapper search={search} setSearch={setSearch} label={label}>
      <BoatListContent
        search={search}
        boats={boats}
        onBoatRowClick={onBoatRowClick}
      />
    </BoatListWrapper>
  );
};
