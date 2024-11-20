import {
  ConstructionIcon,
  PencilIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { windowConfirm, windowPrompt } from "../../_common/utils/window.utils";
import {
  boathTypeWithLabel,
  BoatTypeEnum,
} from "../../_common/types/boat.type";
import { sortBoatsByTypeAndName } from "../../_common/business/boat.rules";

export const BoatCrud = () => {
  const store = useClubOverviewStore();
  const { boats } = store.clubOverview;
  const sortedBoats = sortBoatsByTypeAndName(boats);

  const {
    updateBoatType,
    updateBoatName,
    toggleBoatIsInMaintenance,
    deleteBoat,
  } = useClubOverviewStore();

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center">Vos bateaux</h1>
      </div>

      <div className="flex-1 relative">
        <div className="absolute inset-0 overflow-x-auto grid gap-4 grid-cols-2 p-4">
          {sortedBoats.map((boat) => {
            return (
              <div className="border rounded pl-4 flex items-center">
                {boat.name}

                <div className="flex-1"></div>

                <Separator />
                <EditButton
                  onClick={async () => {
                    const newBoatName = await windowPrompt(
                      "Nouveau nom du bateau",
                      boat.name
                    );

                    if (newBoatName) {
                      updateBoatName(boat.id, newBoatName);
                    }
                  }}
                  className="rounded-l"
                >
                  <PencilIcon className="text-steel-blue-800 h-4 w-4" />{" "}
                  <TypeIcon className="text-steel-blue-800 h-4 w-4" />
                </EditButton>
                <Separator />
                <EditButton
                  onClick={() => {
                    toggleBoatIsInMaintenance(boat.id);
                  }}
                >
                  <ConstructionIcon className="text-steel-blue-800 h-4 w-4" />
                </EditButton>
                <Separator />

                <select
                  className="border-none focus:ring-0 h-12"
                  name="boatType"
                  id="boatType"
                  value={boat.type}
                  onChange={(e) => {
                    updateBoatType(boat.id, e.target.value as BoatTypeEnum);
                  }}
                >
                  {boathTypeWithLabel.map((type) => (
                    <option
                      key={type.type}
                      value={type.type}
                      selected={type.type === boat.type}
                    >
                      {type.label}
                    </option>
                  ))}
                </select>

                <Separator />
                <EditButton
                  variant="danger"
                  onClick={async () => {
                    if (
                      await windowConfirm(
                        `Voulez-vous vraiment supprimer définitivement le bateau "${boat.name}" ? Il ne sera plus possible de renseigner des sorties avec ce bateau mais les sorties déjà effectuées resteront enregistrées.`
                      )
                    ) {
                      deleteBoat(boat.id);
                    }
                  }}
                  className=" rounded-r mr-6"
                >
                  <Trash2Icon className="h-4 w-4 cursor-pointer text-error-900" />
                </EditButton>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const EditButton = ({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  variant?: "normal" | "danger";
}) => {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center hover:bg-gray-100 h-12 px-4"
    >
      {children}
    </button>
  );
};

const Separator = () => <div className="h-12 w-[1px] bg-gray-200" />;
