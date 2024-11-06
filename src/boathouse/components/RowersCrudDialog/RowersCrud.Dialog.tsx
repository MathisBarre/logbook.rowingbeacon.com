import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { toast } from "sonner";
import Button from "../../../_common/components/Button";
import { useState } from "react";
import { Input } from "../../../_common/components/Input";
import { Label } from "../../../_common/components/Label";
import { areStringSimilar } from "../../../_common/utils/string.utils";
import { paginateData } from "../../../_common/utils/pagination.utils";
import { windowPrompt } from "../../../_common/utils/window.utils";

export const RowersCrudDialog = ({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) => {
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

  const deleteRower = (rowerId: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce rameur ?")) {
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
  const pageSize = 12;
  const [currentPage, setCurrentPage] = useState(1);
  const numberOfPages = Math.ceil(sortedRowers.length / pageSize);
  const paginatedRowers = paginateData(sortedRowers, {
    currentPage,
    pageSize,
  });

  const [textareaContent, setTextareaContent] = useState("");

  return (
    <SimpleDialog
      open={isOpen}
      onOpenChange={(v) => setIsOpen(v)}
      title="Gestion des vos rameur"
      subtitle="Créer, modifier ou supprimer vos rameur"
    >
      <Label>Ajouter un ou plusieurs rameurs (un par ligne)</Label>
      <textarea
        className="input flex w-full mb-4 resize-y min-h-16 placeholder:text-gray-300"
        rows={5}
        placeholder={"Rameur 1 \nRameur 2 \nRameur 3"}
        value={textareaContent}
        onChange={(e) => setTextareaContent(e.target.value)}
      />
      <Button type="button" className="mb-16 w-full" onClick={addRowers}>
        Ajouter le ou les rameurs
      </Button>
      <div className="relative">
        <SearchIcon className="absolute h-full w-5 left-3 pb-[0.125rem]" />
        <Input
          placeholder="Rechercher un rameur"
          className="mb-4 mt-0 pl-10"
          type="search"
          value={search}
          onChange={(e) => {
            setCurrentPage(1);
            setSearch(e.target.value);
          }}
        />
      </div>
      <div className="grid gap-4 grid-cols-2">
        {paginatedRowers.map((rower) => (
          <div key={rower.id} className="border rounded flex items-center">
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

        {Array.from({
          length: pageSize - paginatedRowers.length,
        }).map((_, index) => (
          <div key={index} className="invisible h-12" />
        ))}
      </div>
      <p className="italic text-center mt-8">
        Page {currentPage} sur {numberOfPages}
      </p>
      <div className="flex justify-center gap-4 mt-4">
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
    </SimpleDialog>
  );
};
