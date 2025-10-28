/* eslint-disable @typescript-eslint/no-misused-promises */
import { PencilIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { windowConfirm } from "../../_common/utils/window.utils";
import { BoatTypeEnum, getTypeLabel } from "../../_common/business/boat.rules";
import { sortBoatsByTypeAndName } from "../../_common/business/boat.rules";
import { cn } from "../../_common/utils/utils";
import { Fragment, useState } from "react";
import { Input } from "../../_common/components/Input";
import { areStringSimilar } from "../../_common/utils/string.utils";
import { AddBoatsDialog } from "./dialogs/AddBoatsDialog";
import { BoatStatsDialog } from "./dialogs/BoatStatsDialog";
import { BoatLevelDialog } from "./dialogs/BoatLevelDialog";
import { BoatStatsComparisonsDialog } from "./dialogs/BoatStatsComparisonsDialog";
import { SimpleDialog } from "../../_common/components/SimpleDialog";
import { UpdateBoat } from "./UpdateBoat";

export const BoatCrud = () => {
  const { t } = useTranslation();
  const store = useClubOverviewStore();
  const boats = store.getAllBoats();
  const [search, setSearch] = useState("");
  const searchedBoats = boats.filter((boat) =>
    areStringSimilar(boat.name, search)
  );
  const sortedBoats = sortBoatsByTypeAndName(searchedBoats);

  const { archiveBoat: deleteBoat } = useClubOverviewStore();

  const [editBoat, setEditBoat] = useState<
    | false
    | {
        id: string;
        name: string;
        type?: BoatTypeEnum;
        isInMaintenance?: boolean;
        note?: string;
      }
  >(false);

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center">{t("parameters.yourBoats")}</h1>
      </div>

      <div className="flex-1 flex p-4 flex-col">
        <div className="flex gap-4 mb-4">
          <AddBoatsDialog />
          <BoatStatsComparisonsDialog />

          <div className="relative flex-1">
            <SearchIcon className="absolute h-full w-5 left-3 pt-[0.125rem]" />
            <Input
              placeholder={t("parameters.searchBoat")}
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
                  <Fragment key={boat.id}>
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
                      <div className="py-2">
                        <h3
                          className={cn(
                            boat.isInMaintenance && "text-error-700"
                          )}
                        >
                          {boat.name}{" "}
                          {boat.isInMaintenance && `(${t("parameters.inMaintenance")})`}
                        </h3>
                        {boat.note && boat.note.trim().length > 0 && (
                          <div className="text-xs text-steel-blue-900 bg-steel-blue-50 border border-steel-blue-200 rounded p-2 whitespace-pre-wrap mt-2">
                            <h3 className="font-medium mb-1">
                              {t("session.boatNotes")}
                            </h3>
                            <p>{boat.note}</p>
                          </div>
                        )}
                      </div>

                      <div className="flex-1"></div>

                      <Separator />

                      <BoatStatsDialog boatId={boat.id} boatName={boat.name} />

                      <Separator />

                      <BoatLevelDialog boatId={boat.id} boatName={boat.name} />

                      <Separator />
                      <EditButton
                        onClick={() =>
                          setEditBoat({
                            id: boat.id,
                            name: boat.name,
                            type: boat.type,
                            isInMaintenance: boat.isInMaintenance,
                            note: boat.note,
                          })
                        }
                      >
                        <PencilIcon className="text-steel-blue-800 h-4 w-4" />{" "}
                      </EditButton>

                      <Separator />
                      <EditButton
                        onClick={async () => {
                          if (
                            await windowConfirm(
                              t("parameters.confirmArchiveBoat", { boatName: boat.name })
                            )
                          ) {
                            deleteBoat(boat.id);
                          }
                        }}
                      >
                        <Trash2Icon className="h-4 w-4 cursor-pointer text-error-900" />
                      </EditButton>
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <div className="flex-1" />
          </div>
        </div>
        <SimpleDialog
          modal={true}
          open={!!editBoat}
          onOpenChange={(v) => !v && setEditBoat(false)}
          title={t("parameters.updateBoat")}
        >
          {editBoat && (
            <UpdateBoat boat={editBoat} close={() => setEditBoat(false)} />
          )}
        </SimpleDialog>
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
        "flex items-center justify-center  min-h-12 h-full px-4 min-w-12",
        isActive
          ? "bg-steel-blue-100 border border-dashed border-steel-blue-600 hover:bg-steel-blue-200"
          : "hover:bg-gray-100"
      )}
    >
      {children}
    </button>
  );
};

const Separator = () => <div className="min-h-12 h-full w-[1px] bg-gray-200" />;
