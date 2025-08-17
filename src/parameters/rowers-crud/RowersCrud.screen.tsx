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
import { Fragment, useState } from "react";
import { Input } from "../../_common/components/Input";
import { Label } from "../../_common/components/Label";
import { areStringSimilar } from "../../_common/utils/string.utils";
import { paginateData } from "../../_common/utils/pagination.utils";
import { windowConfirm } from "../../_common/utils/window.utils";
import { DialogContent } from "../../_common/components/Dialog/DialogContent";
import { Dialog, DialogTrigger } from "../../_common/components/Dialog/Dialog";
import { useLocalStorage } from "../../_common/utils/useLocalStorage";
import { ChartBarIcon } from "@heroicons/react/16/solid";
import { RowerStatsComparisons } from "./components/RowerStatsComparisons";
import { UpdateRower } from "./components/UpdateRower";
import { Rower } from "../../_common/business/rower.rules";
import { getRowerTypeLabel } from "../../_common/business/rower.rules";
import clsx from "clsx";
import { BulkUpdateRower } from "../components/BulkUpdateRower";
import { sortByTypeOrder } from "../../_common/business/seriousness.rules";
import { sortByAgeCategoryOrder } from "../../_common/business/ageCategory.rules";
import { AGE_CATEGORIES } from "../../_common/business/ageCategory.rules";
import { AgeCategoryEnum } from "../../_common/business/ageCategory.rules";
import {
  SERIOUSNESS_CATEGORIES,
  SeriousnessCategoryEnum,
} from "../../_common/business/seriousness.rules";
import { RowerStats } from "./components/RowerStats";

export const RowersCrudScreen = () => {
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

  const [defaultCategory, setDefaultCategory] =
    useState<AgeCategoryEnum | null>(null);
  const [defaultType, setDefaultType] =
    useState<SeriousnessCategoryEnum | null>(null);

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
          store.addRower(rower, defaultCategory, defaultType);
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
    const isSameCategory = a.category === b.category;
    const isSameType = a.type === b.type;

    if (!isSameCategory) {
      return sortByAgeCategoryOrder(a.category, b.category);
    }

    if (!isSameType) {
      return sortByTypeOrder(a.type, b.type);
    }

    return a.name.localeCompare(b.name);
  });

  const [pageSize, setPageSize] = useLocalStorage("rower-crud-page-size", 32);

  const [currentPage, setCurrentPage] = useState(1);
  const numberOfPages = Math.ceil(sortedRowers.length / pageSize);
  const paginatedRowers = paginateData(sortedRowers, {
    currentPage,
    pageSize: pageSize,
  });

  const [textareaContent, setTextareaContent] = useState("");

  const [bulkEditMode, setBulkEditMode] = useState({
    enabled: false,
    selectedRowers: [] as string[],
  });

  const [createRowerDialogOpen, toggleCreateRowerDialog] = useToggle();

  return (
    <>
      <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
        <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
          <h1 className="text-base ml-2 flex gap-2 items-center">
            Vos rameurs
          </h1>
        </div>

        <div className="p-4 flex flex-col flex-1">
          <header className="flex gap-4 mb-4">
            <Button type="button" onClick={toggleCreateRowerDialog}>
              <div className="flex gap-2 items-center">
                <PlusIcon className="h-4 w-4" />
                Ajouter des rameurs
              </div>
            </Button>

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

            <Button
              type="button"
              variant="outlined"
              onClick={() =>
                setBulkEditMode((prev) => ({
                  enabled: !prev.enabled,
                  selectedRowers: [],
                }))
              }
            >
              <div className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={bulkEditMode.enabled}
                  className="input"
                  readOnly
                />
                Édition en masse
              </div>
            </Button>

            {bulkEditMode.enabled && (
              <>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outlined">
                      Éditer la sélection
                    </Button>
                  </DialogTrigger>
                  <DialogContent
                    className="max-w-[40rem]"
                    title={`Mettre à jour ${bulkEditMode.selectedRowers.length} rameurs`}
                  >
                    <BulkUpdateRower
                      rowersIds={bulkEditMode.selectedRowers}
                      close={() => {
                        setBulkEditMode((prev) => ({
                          ...prev,
                          enabled: false,
                        }));
                      }}
                    />
                  </DialogContent>
                </Dialog>
              </>
            )}

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
          </header>
          <div className="flex-1 relative">
            <div className="overflow-y-auto absolute inset-0 border p-4 pt-0 rounded">
              <div className="grid gap-4 grid-cols-3">
                {paginatedRowers.map((rower, i) => {
                  const lastCategory = paginatedRowers[i - 1]?.category;
                  const currentCategory = rower.category;

                  const newRowerCategory =
                    i === 0 || lastCategory !== currentCategory;

                  return (
                    <Fragment key={rower.id}>
                      {newRowerCategory && (
                        <div
                          className="col-span-3 bg-gray-100 text-gray-900 p-2 -mx-4 px-4 sticky top-0 z-10"
                          key={rower.category}
                        >
                          {rower.category || "Sans catégorie"}
                        </div>
                      )}
                      <div
                        key={rower.id}
                        className="border rounded flex relative overflow-hidden"
                      >
                        <div className="flex-1 relative">
                          <div className="absolute inset-0 flex justify-between items-center gap-4 px-4">
                            <p className="text-nowrap text-ellipsis overflow-hidden">
                              {rower.name}
                            </p>
                            {rower.type && (
                              <p className="bg-steel-blue-50 border border-steel-blue-100 inline-block px-2 py-1 rounded-full text-xs">
                                {rower.type && getRowerTypeLabel(rower.type)}
                              </p>
                            )}
                          </div>
                        </div>
                        {!bulkEditMode.enabled && (
                          <div className="flex">
                            <div className="h-full w-[1px] bg-gray-200" />
                            <Dialog>
                              <DialogTrigger asChild>
                                <button className="flex items-center justify-center hover:bg-gray-100 aspect-square h-12">
                                  <ChartBarIcon className="h-4 w-4 cursor-pointer text-steel-blue-800" />
                                </button>
                              </DialogTrigger>
                              <DialogContent
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
                              className="flex items-center justify-center hover:bg-gray-100 aspect-square h-12"
                            >
                              <Trash2Icon className="h-4 w-4 cursor-pointer text-error-900" />
                            </button>
                          </div>
                        )}

                        {bulkEditMode.enabled && (
                          <div className="h-12 box-content border-l flex items-center justify-center gap-2">
                            <Label
                              className={clsx(
                                "flex items-center justify-center gap-2 h-full w-full px-5",
                                bulkEditMode.selectedRowers.includes(rower.id)
                                  ? "bg-steel-blue-100"
                                  : "bg-white"
                              )}
                            >
                              <input
                                type="checkbox"
                                className="input"
                                checked={bulkEditMode.selectedRowers.includes(
                                  rower.id
                                )}
                                onChange={(e) => {
                                  setBulkEditMode((prev) => ({
                                    ...prev,
                                    selectedRowers: e.target.checked
                                      ? [...prev.selectedRowers, rower.id]
                                      : prev.selectedRowers.filter(
                                          (r) => r !== rower.id
                                        ),
                                  }));
                                }}
                              />
                              Sélectionner
                            </Label>
                          </div>
                        )}
                      </div>
                    </Fragment>
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

      {/* ----- Dialogs ----- */}

      <Dialog
        open={createRowerDialogOpen}
        onOpenChange={toggleCreateRowerDialog}
      >
        <DialogContent title="Ajouter des rameurs">
          <div className="flex flex-col gap-4">
            <Label className="flex flex-col gap-1">
              Ajouter un ou plusieurs rameurs (un par ligne)
              <textarea
                className="input flex w-full resize-y min-h-16 placeholder:text-gray-300"
                rows={10}
                placeholder={"Rameur 1 \nRameur 2 \nRameur 3"}
                value={textareaContent}
                onChange={(e) => setTextareaContent(e.target.value)}
              />
            </Label>

            <Label className="flex flex-col gap-1">
              Catégorie par défaut
              <select
                className="input"
                value={defaultCategory || ""}
                onChange={(e) =>
                  setDefaultCategory(
                    (e.target.value as AgeCategoryEnum) || null
                  )
                }
              >
                {AGE_CATEGORIES.map((category) => (
                  <option
                    key={category.category}
                    value={category.category || ""}
                  >
                    {category.category || "Aucune catégorie"}
                  </option>
                ))}
              </select>
            </Label>

            <Label className="flex flex-col gap-1">
              Type par défaut
              <select
                className="input"
                value={defaultType || ""}
                onChange={(e) =>
                  setDefaultType(
                    (e.target.value as SeriousnessCategoryEnum) || null
                  )
                }
              >
                {SERIOUSNESS_CATEGORIES.map((type) => (
                  <option key={type.type} value={type.type || ""}>
                    {type.label || "Aucun type"}
                  </option>
                ))}
              </select>
            </Label>

            <Button type="button" className="w-full" onClick={addRowers}>
              Ajouter le ou les rameurs
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

const UpdateRowerModal = ({ rower }: { rower: Rower }) => {
  const [updateModalOpen, setUpdateModalOpen] = useState(false);

  return (
    <Dialog open={updateModalOpen} onOpenChange={setUpdateModalOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center justify-center hover:bg-gray-100 aspect-square h-12">
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

const useToggle = () => {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = (forceIsOpen?: boolean) => {
    if (forceIsOpen === undefined) {
      setIsOpen((isOpen) => !isOpen);
      return;
    }

    setIsOpen(forceIsOpen);
  };

  return [isOpen, toggle] as const;
};
