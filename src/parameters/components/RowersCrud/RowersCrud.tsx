import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { toast } from "sonner";
import Button from "../../../_common/components/Button";
import { useState } from "react";
import { Input } from "../../../_common/components/Input";
import { Label } from "../../../_common/components/Label";
import { areStringSimilar } from "../../../_common/utils/string.utils";
import { paginateData } from "../../../_common/utils/pagination.utils";
import {
  windowConfirm,
  windowPrompt,
} from "../../../_common/utils/window.utils";
import { DialogContent } from "../../../_common/components/Dialog/DialogContent";
import {
  Dialog,
  DialogTrigger,
} from "../../../_common/components/Dialog/Dialog";
import { useLocalStorage } from "../../../_common/utils/useLocalStorage";

export const RowersCrud = () => {
  const store = useClubOverviewStore();
  const { rowers } = store.clubOverview;

  const updateRowerName = async (rowerId: string, currentName: string) => {
    const newRowerName = await windowPrompt(
      "Nouveau nom du rameur",
      currentName
    );

    if (!newRowerName) {
      return;
    }

    store.updateRowerName(rowerId, newRowerName);

    toast.success("Le nom du rameur a été modifié");
  };

  const deleteRower = async (rowerId: string) => {
    if (
      !(await windowConfirm("Êtes-vous sûr de vouloir supprimer ce rameur ?"))
    ) {
      return;
    }

    store.deleteRower(rowerId);
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
        return toast.error("Aucun rameur n'a été ajouté");
      }

      if (rowerAdded < rowersToAddNumber) {
        toast.warning(
          `${rowerAdded} rameurs sur ${rowersToAddNumber} ont été ajoutés`
        );
        setTextareaContent("");
        return;
      }

      toast.success("Tous les rameurs ont été ajoutés");
      setTextareaContent("");
    }
  };

  const [search, setSearch] = useState("");

  const searchedRowers = rowers.filter((rower) =>
    areStringSimilar(rower.name, search)
  );

  const sortedRowers = searchedRowers.sort((a, b) =>
    a.name.localeCompare(b.name)
  );

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
            <DialogTrigger>
              <Button type="button">Ajouter des rameurs</Button>
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
          <div className="overflow-y-scroll absolute inset-0 border p-4 rounded">
            <div className="grid gap-4 grid-cols-4 ">
              {paginatedRowers.map((rower) => (
                <div
                  key={rower.id}
                  className="border rounded flex items-center"
                >
                  <p className="text-nowrap px-4 flex-1">{rower.name}</p>
                  <div className="h-full w-[1px] bg-gray-200" />
                  <button
                    onClick={() => {
                      updateRowerName(rower.id, rower.name);
                    }}
                    className="flex items-center justify-center hover:bg-gray-100 h-12 w-12"
                  >
                    <PencilIcon className="h-4 w-4 cursor-pointer text-blue-900" />
                  </button>
                  <div className="h-full w-[1px] bg-gray-200" />
                  <button
                    onClick={() => {
                      deleteRower(rower.id);
                    }}
                    className="flex items-center justify-center hover:bg-gray-100 h-12 w-12"
                  >
                    <Trash2Icon className="h-4 w-4 cursor-pointer text-error-900" />
                  </button>
                </div>
              ))}
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
