/* eslint-disable @typescript-eslint/no-misused-promises */
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { toast } from "sonner";
import Button from "../../_common/components/Button";
import { useState } from "react";
import { Input } from "../../_common/components/Input";
import { Label } from "../../_common/components/Label";
import { areStringSimilar } from "../../_common/utils/string.utils";
import { paginateData } from "../../_common/utils/pagination.utils";
import { windowConfirm } from "../../_common/utils/window.utils";
import { DialogContent } from "../../_common/components/Dialog/DialogContent";
import { Dialog, DialogTrigger } from "../../_common/components/Dialog/Dialog";
import { useLocalStorage } from "../../_common/utils/useLocalStorage";
import { ChartBarIcon } from "@heroicons/react/16/solid";
import { RowerStats } from "./RowerStats";
import { RowerStatsComparisons } from "./RowerStatsComparisons";
import { UpdateRower } from "./UpdateRower";
import { Rower } from "../../_common/types/rower.type";
import { sortByCategoryOrder } from "../../_common/store/boatLevelConfig.store";
import { getRowerTypeLabel } from "../../_common/business/rower.rules";

export const RowersCrud = () => {
  const store = useClubOverviewStore();
  const rowers = store.getAllRowers();

  const deleteRower = async (rower: { id: string; name: string }) => {
    if (
      !(await windowConfirm(
        `Voulez-vous archiver le rameur "${rower.name}" ? Il ne sera plus possible de renseigner des sorties avec ce rameur, mais les données enregistrées ne seront pas impactées.`
      ))
    ) {
      return;
    }

    store.archiveRower(rower.id);
    toast.success("Le rameur a été supprimé");
  };

  const addRowers = () => {
    const rowers = textareaContent
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);

    let rowerAdded = 0;
    const rowersToAddNumber = rowers.length;

    try {
      for (const rower of rowers) {
        if (rower) {
          store.addRower(rower);
          rowerAdded++;
        }
      }
    } finally {
      if (rowerAdded === 0) {
        toast.error("Aucun rameur n'a été ajouté");
      } else if (rowerAdded < rowersToAddNumber) {
        toast.warning(
          `${rowerAdded} rameurs sur ${rowersToAddNumber} ont été ajoutés`
        );
        setTextareaContent("");
      } else {
        toast.success("Tous les rameurs ont été ajoutés");
        setTextareaContent("");
      }
    }
  };

  const [search, setSearch] = useState("");

  const searchedRowers = rowers.filter((rower) =>
    areStringSimilar(rower.name, search)
  );

  const sortedRowers = searchedRowers.sort((a, b) => {
    if (a.category === b.category) {
      return a.name.localeCompare(b.name);
    }

    return sortByCategoryOrder(a.category, b.category);
  });

  const [pageSize, setPageSize] = useLocalStorage("rower-crud-page-size", 32);

  const [currentPage, setCurrentPage] = useState(1);
  const numberOfPages = Math.ceil(sortedRowers.length / pageSize);
  const paginatedRowers = paginateData(sortedRowers, {
    currentPage,
    pageSize: pageSize,
  });

  const [textareaContent, setTextareaContent] = useState("");

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center">Vos rameurs</h1>
      </div>

      <div className="p-4 flex flex-col flex-1">
        <div className="flex gap-4 mb-4">
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button">
                <div className="flex gap-2 items-center">
                  <PlusIcon className="h-4 w-4" />
                  Ajouter des rameurs
                </div>
              </Button>
            </DialogTrigger>
            <DialogContent title="Ajouter des rameurs">
              <Label>Ajouter un ou plusieurs rameurs (un par ligne)</Label>
              <textarea
                className="input flex w-full mb-4 resize-y min-h-16 placeholder:text-gray-300"
                rows={10}
                placeholder={"Rameur 1 \nRameur 2 \nRameur 3"}
                value={textareaContent}
                onChange={(e) => setTextareaContent(e.target.value)}
              />
              <Button type="button" className="w-full" onClick={addRowers}>
                Ajouter le ou les rameurs
              </Button>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <Button type="button">
                <div className="flex gap-2 items-center">
                  <ChartBarIcon className="h-4 w-4" />
                  Statistiques rameurs
                </div>
              </Button>
            </DialogTrigger>
            <DialogContent title="Statistiques rameurs">
              <RowerStatsComparisons />
            </DialogContent>
          </Dialog>

          <div className="relative flex-1">
            <SearchIcon className="absolute h-full w-5 left-3 pt-[0.125rem]" />
            <Input
              placeholder="Rechercher un rameur"
              className="pl-10 mt-0"
              type="search"
              value={search}
              onChange={(e) => {
                setCurrentPage(1);
                setSearch(e.target.value);
              }}
            />
          </div>
        </div>
        <div className="flex-1 relative">
          <div className="overflow-y-auto absolute inset-0 border p-4 pt-0 rounded">
            <div className="grid gap-4 grid-cols-4 ">
              {paginatedRowers.map((rower, i) => {
                const newRowerCategory =
                  sortedRowers[i - 1]?.category !== rower.category;

                return (
                  <>
                    {newRowerCategory && (
                      <div
                        className="col-span-4 bg-gray-100 text-gray-900 p-2 -mx-4 px-4 sticky top-0 z-10"
                        key={rower.category}
                      >
                        {rower.category || "Sans catégorie"}
                      </div>
                    )}
                    <div
                      key={rower.id}
                      className="border rounded flex flex-col"
                    >
                      <div className="px-4 py-3 flex-1 relative">
                        <p className="text-nowrap">{rower.name}</p>
                        {(rower.category || rower.type) && (
                          <p className="bg-steel-blue-50 border border-steel-blue-100 inline-block px-2 rounded-full text-xs absolute top-2 right-2">
                            {rower.category}{" "}
                            {rower.category && rower.type && <>-</>}{" "}
                            {getRowerTypeLabel(rower.type)}
                          </p>
                        )}
                      </div>
                      <div className="flex w-full border-t">
                        <Dialog>
                          <DialogTrigger asChild>
                            <button className="flex items-center justify-center hover:bg-gray-100 h-10 flex-1">
                              <ChartBarIcon className="h-4 w-4 cursor-pointer text-steel-blue-800" />
                            </button>
                          </DialogTrigger>
                          <DialogContent
                            className="max-w-[32rem]"
                            title={`Statistiques de ${rower.name}`}
                          >
                            <RowerStats rowerId={rower.id} />
                          </DialogContent>
                        </Dialog>
                        <div className="h-full w-[1px] bg-gray-200" />

                        <UpdateRowerModal rower={rower} />

                        <div className="h-full w-[1px] bg-gray-200" />
                        <button
                          onClick={async () => {
                            await deleteRower(rower);
                          }}
                          className="flex items-center justify-center hover:bg-gray-100 h-10 flex-1"
                        >
                          <Trash2Icon className="h-4 w-4 cursor-pointer text-error-900" />
                        </button>
                      </div>
                    </div>
                  </>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex justify-center items-center gap-8 mt-4">
          <p className="italic text-center">
            Page {currentPage} sur {numberOfPages}
          </p>
          <div className="flex justify-center gap-4">
            <Button
              type="button"
              variant="outlined"
              onClick={() => {
                setCurrentPage((prev) => Math.max(1, prev - 1));
              }}
              disabled={currentPage === 1}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              type="button"
              variant="outlined"
              onClick={() => {
                setCurrentPage((prev) => Math.min(numberOfPages, prev + 1));
              }}
              disabled={currentPage === numberOfPages}
            >
              <ChevronRightIcon />
            </Button>
          </div>
          <select
            className="input"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
          >
            <option value={16}>16</option>
            <option value={32}>32</option>
            <option value={64}>64</option>
            <option value={128}>128</option>
            <option value={256}>256</option>
          </select>
        </div>
      </div>
    </div>
  );
};

const UpdateRowerModal = ({ rower }: { rower: Rower }) => {
  const [updateModalOpen, setUpdateModalOpen] = useState(false);

  return (
    <Dialog open={updateModalOpen} onOpenChange={setUpdateModalOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center justify-center hover:bg-gray-100 h-10 flex-1">
          <PencilIcon className="h-4 w-4 cursor-pointer text-steel-blue-800" />
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-w-[40rem]"
        title={`Mettre à jour ${rower.name}`}
      >
        <UpdateRower
          rower={rower}
          close={() => {
            setUpdateModalOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
