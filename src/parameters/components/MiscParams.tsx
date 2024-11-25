import Button from "../../_common/components/Button";
import { useState } from "react";
import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import {
  askForAdminPassword,
  useAdminEditModeSystem,
} from "../../_common/store/adminEditMode.system";
import { DeleteDatas } from "./DeleteDatas";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";

export const MiscParams = () => {
  const [deleteDataDialogOpen, setDeleteDataDialogOpen] = useState(false);
  const adminEditSystem = useAdminEditModeSystem();
  const clubOverview = useClubOverviewStore();

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center">
          Paramètres divers
        </h1>
      </div>

      <div className="p-4 flex flex-col gap-8">
        <section>
          <h1 className="font-bold text-xl">La note du coach</h1>

          <p>Cette note sera affichée en haut de la page "Boathouse"</p>

          <textarea
            cols={64}
            rows={4}
            className="input resize"
            name="coachnote"
            id="coachnote"
            onChange={(e) => {
              clubOverview.setCoachNote(e.target.value);
            }}
            value={clubOverview.coachNote}
          />
        </section>

        <section>
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
        </section>
      </div>
    </div>
  );
};
