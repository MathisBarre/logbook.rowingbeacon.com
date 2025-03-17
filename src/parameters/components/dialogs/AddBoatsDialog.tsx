import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  BoatTypeEnum,
  boathTypeWithLabel,
} from "../../../_common/business/boat.rules";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "../../../_common/components/Dialog/Dialog";
import Button from "../../../_common/components/Button";
import { Label } from "../../../_common/components/Label";

export const AddBoatsDialog = () => {
  const store = useClubOverviewStore();
  const [textareaContent, setTextareaContent] = useState("");
  const [addBoatSelect, setAddBoatSelect] = useState(BoatTypeEnum.OTHER);

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

  return (
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
  );
};
