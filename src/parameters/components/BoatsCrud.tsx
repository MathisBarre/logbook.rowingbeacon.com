/* eslint-disable @typescript-eslint/no-misused-promises */
import {
  ConstructionIcon,
  PencilIcon,
  PlusIcon,
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
import { cn } from "../../_common/utils/utils";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "../../_common/components/Dialog/Dialog";
import Button from "../../_common/components/Button";
import { Label } from "../../_common/components/Label";
import { useState } from "react";
import { toast } from "sonner";
import { ChartBarIcon } from "@heroicons/react/16/solid";
import { BoatStats } from "./BoatStats";
import { BoatStatsComparisons } from "./BoatStatsComparisons";

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

  const [textareaContent, setTextareaContent] = useState("");

  const addBoats = () => {
    const boats = textareaContent
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);

    let boatsAdded = 0;
    const rowersToAddNumber = boats.length;

    try {
      for (const boat of boats) {
        if (boat) {
          store.addBoat(boat);
          boatsAdded++;
        }
      }
    } finally {
      if (boatsAdded === 0) {
        toast.error("Aucun bateau n'a été ajouté");
      } else if (boatsAdded < rowersToAddNumber) {
        toast.warning(
          `${boatsAdded} bateaux sur ${rowersToAddNumber} ont été ajoutés`
        );
        setTextareaContent("");
      } else {
        toast.success("Tous les bateaux ont été ajoutés");
        setTextareaContent("");
      }
    }
  };

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center">Vos bateaux</h1>
      </div>

      <div className="flex-1 flex p-4 flex-col">
        <div className="flex gap-4 mb-4">
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button">
                <div className="flex gap-2 items-center ">
                  <PlusIcon className="h-4 w-4" />
                  Ajouter des bateaux
                </div>
              </Button>
            </DialogTrigger>
            <DialogContent title="Ajouter des bateaux">
              <Label>Ajouter un ou plusieurs bateaux (un par ligne)</Label>
              <textarea
                className="input flex w-full mb-4 resize-y min-h-16 placeholder:text-gray-300"
                rows={10}
                placeholder={"bateau 1 \nbateau 2 \nbateau 3"}
                value={textareaContent}
                onChange={(e) => setTextareaContent(e.target.value)}
              />
              <Button type="button" className="w-full" onClick={addBoats}>
                Ajouter le ou les bateaux
              </Button>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <Button type="button">
                <div className="flex gap-2 items-center ">
                  <ChartBarIcon className="h-4 w-4" />
                  Statistiques rameurs
                </div>
              </Button>
            </DialogTrigger>
            <DialogContent
              title="Statistiques rameurs"
              className="overflow-auto"
            >
              <BoatStatsComparisons />
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex-1 relative">
          <div className="absolute inset-0 overflow-y-auto p-4 border rounded flex flex-col">
            <div className="grid gap-4 grid-cols-2">
              {sortedBoats.map((boat) => {
                return (
                  <div
                    className="border rounded pl-4 flex items-center"
                    key={boat.id}
                  >
                    {boat.name}

                    <div className="flex-1"></div>

                    <Separator />

                    <Dialog>
                      <DialogTrigger asChild>
                        <button className="flex items-center justify-center hover:bg-gray-100 h-12 w-12">
                          <ChartBarIcon className="h-4 w-4 cursor-pointer text-steel-blue-800" />
                        </button>
                      </DialogTrigger>
                      <DialogContent
                        className="max-w-[24rem]"
                        title={`Statistiques de ${boat.name}`}
                      >
                        <BoatStats boatId={boat.id} />
                      </DialogContent>
                    </Dialog>

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
                    >
                      <PencilIcon className="text-steel-blue-800 h-4 w-4" />{" "}
                      <TypeIcon className="text-steel-blue-800 h-4 w-4" />
                    </EditButton>
                    <Separator />
                    <EditButton
                      onClick={() => {
                        toggleBoatIsInMaintenance(boat.id);
                      }}
                      isActive={boat.isInMaintenance}
                    >
                      <ConstructionIcon className="text-steel-blue-800 h-4 w-4 mr-2" />
                      <p className="text-sm text-steel-blue-800">Maintenance</p>
                    </EditButton>
                    <Separator />

                    <select
                      className="border-none focus:ring-0 h-12 text-steel-blue-800"
                      name="boatType"
                      id="boatType"
                      value={boat.type || BoatTypeEnum.OTHER}
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
                      onClick={async () => {
                        if (
                          await windowConfirm(
                            `Voulez-vous vraiment supprimer définitivement le bateau "${boat.name}" ? Il ne sera plus possible de renseigner des sorties avec ce bateau mais les sorties déjà effectuées resteront enregistrées.`
                          )
                        ) {
                          deleteBoat(boat.id);
                        }
                      }}
                    >
                      <Trash2Icon className="h-4 w-4 cursor-pointer text-error-900" />
                    </EditButton>
                  </div>
                );
              })}
            </div>
            <div className="flex-1" />
          </div>
        </div>
      </div>
    </div>
  );
};

const EditButton = ({
  children,
  onClick,
  isActive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center  h-12 px-4",
        isActive
          ? "bg-steel-blue-100 border border-dashed border-steel-blue-600 hover:bg-steel-blue-200"
          : "hover:bg-gray-100"
      )}
    >
      {children}
    </button>
  );
};

const Separator = () => <div className="h-12 w-[1px] bg-gray-200" />;
