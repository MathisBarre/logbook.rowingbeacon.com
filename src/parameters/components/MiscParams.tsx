import Button from "../../_common/components/Button";
import { useState } from "react";
import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import {
  askForAdminPassword,
  useAdminEditModeSystem,
} from "../../_common/store/adminEditMode.system";
import { DeleteDatas } from "./DeleteDatas";

export const MiscParams = () => {
  const [deleteDataDialogOpen, setDeleteDataDialogOpen] = useState(false);
  const adminEditSystem = useAdminEditModeSystem();

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center">
          Paramètres divers
        </h1>
      </div>

      <div className="p-4">
        <h1 className="font-bold text-xl mb-2">Actions sensibles</h1>

        <Button
          type="button"
          color="danger"
          onClick={async () => {
            if (
              !adminEditSystem.allowAdminActions(await askForAdminPassword())
            ) {
              return;
            }

            setDeleteDataDialogOpen(true);
          }}
        >
          Supprimer toutes les données
        </Button>

        <Dialog
          open={deleteDataDialogOpen}
          onOpenChange={(open) => {
            setDeleteDataDialogOpen(open);
          }}
        >
          <DialogContent
            title="Supprimer toutes les données !"
            className="max-w-xl"
          >
            <DeleteDatas />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};
