/* eslint-disable @typescript-eslint/no-misused-promises */
import {
  ConstructionIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { windowConfirm, windowPrompt } from "../../_common/utils/window.utils";
import {
  boathTypeWithLabel,
  BoatTypeEnum,
  getTypeLabel,
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
import { Input } from "../../_common/components/Input";
import { areStringSimilar } from "../../_common/utils/string.utils";
import { BoatLevelSystem } from "./BoatLevelSystem";

export const BoatCrud = () => {
  const store = useClubOverviewStore();
  const boats = store.DEPRECATED_getAllBoats();
  const [search, setSearch] = useState("");
  const searchedBoats = boats.filter((boat) =>
    areStringSimilar(boat.name, search)
  );
  const sortedBoats = sortBoatsByTypeAndName(searchedBoats);

  const {
    updateBoatType,
    updateBoatName,
    toggleBoatIsInMaintenance,
    archiveBoat: deleteBoat,
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
          store.addBoat({ name: boat, type: addBoatSelect });
          boatsAdded++;
        }
      }

      setAddBoatSelect(BoatTypeEnum.OTHER);
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

  const [addBoatSelect, setAddBoatSelect] = useState(BoatTypeEnum.OTHER);

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
                placeholder={"bateau 1 \nbateau 2 \nbateau 3 \n..."}
                value={textareaContent}
                onChange={(e) => setTextareaContent(e.target.value)}
              />
              <Label className="flex flex-col gap-1 mb-2">
                Importer en tant que
                <select
                  className=" focus:ring-0 h-12 text-steel-blue-800 input"
                  name="boatType"
                  id="boatType"
                  value={addBoatSelect}
                  onChange={(e) => {
                    setAddBoatSelect(e.target.value as BoatTypeEnum);
                  }}
                >
                  {boathTypeWithLabel.map((type) => (
                    <option key={type.type} value={type.type}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </Label>
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
                  Statistiques bateaux
                </div>
              </Button>
            </DialogTrigger>
            <DialogContent
              title="Statistiques bateaux"
              className="overflow-auto"
            >
              <BoatStatsComparisons />
            </DialogContent>
          </Dialog>

          <div className="relative flex-1">
            <SearchIcon className="absolute h-full w-5 left-3 pt-[0.125rem]" />
            <Input
              placeholder="Rechercher un bateau"
              className="pl-10 mt-0"
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
        </div>

        <div className="flex-1 relative">
          <div className="absolute inset-0 overflow-y-auto p-4 pt-0 border rounded flex flex-col">
            <div className="grid gap-4 grid-cols-2">
              {sortedBoats.map((boat, i) => {
                const newBoatType = sortedBoats[i - 1]?.type !== boat.type;

                return (
                  <>
                    {newBoatType && (
                      <div
                        className="col-span-2 bg-gray-100 text-gray-900 p-2 -mx-4 px-4 sticky top-0"
                        key={boat.type}
                      >
                        {getTypeLabel(boat.type)}
                      </div>
                    )}
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
                          className="max-w-[32rem]"
                          title={`Informations à propos de ${boat.name}`}
                        >
                          <BoatStats boatId={boat.id} />
                        </DialogContent>
                      </Dialog>
                      <Separator />

                      <Dialog>
                        <DialogTrigger asChild>
                          <button className="flex items-center justify-center hover:bg-gray-100 h-12 w-12">
                            <ShieldIcon className="h-4 w-4 cursor-pointer text-steel-blue-800" />
                          </button>
                        </DialogTrigger>
                        <DialogContent
                          className="max-w-[40rem]"
                          title={`Gestion niveau de ${boat.name}`}
                        >
                          <BoatLevelSystem boatId={boat.id} />
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
                        <p className="text-sm text-steel-blue-800">
                          Maintenance
                        </p>
                      </EditButton>
                      <Separator />

                      <select
                        className="border-none focus:ring-0 h-12 text-steel-blue-800"
                        name="boatType"
                        id="boatType"
                        value={boat.type || BoatTypeEnum.OTHER}
                        onChange={(e) => {
                          updateBoatType(
                            boat.id,
                            e.target.value as BoatTypeEnum
                          );
                        }}
                      >
                        {boathTypeWithLabel.map((type) => (
                          <option key={type.type} value={type.type}>
                            {type.label}
                          </option>
                        ))}
                      </select>

                      <Separator />
                      <EditButton
                        onClick={async () => {
                          if (
                            await windowConfirm(
                              `Voulez-vous archiver le bateau "${boat.name}" ? Il ne sera plus possible de renseigner des sorties avec ce bateau, mais les données enregistrées ne seront pas impactées.`
                            )
                          ) {
                            deleteBoat(boat.id);
                          }
                        }}
                      >
                        <Trash2Icon className="h-4 w-4 cursor-pointer text-error-900" />
                      </EditButton>
                    </div>
                  </>
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
