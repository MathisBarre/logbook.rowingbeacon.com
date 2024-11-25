import Button from "../../_common/components/Button";
import { useState } from "react";
import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import {
  askForAdminPassword,
  useAdminEditModeSystem,
} from "../../_common/store/adminEditMode.system";
import { DeleteDatas } from "./DeleteDatas";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { useAutoStart } from "../hooks/useAutoStart";

export const MiscParams = () => {
  const [deleteDataDialogOpen, setDeleteDataDialogOpen] = useState(false);
  const adminEditSystem = useAdminEditModeSystem();
  const clubOverview = useClubOverviewStore();
  const { autoStartState, enableAutoStart, disableAutoStart } = useAutoStart();

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
          <h1 className="font-bold text-xl">Démarrage automatique</h1>
          <p>
            En activant cette option, RowingBeacon se lancera au démarrage du
            système
          </p>

          {autoStartState === "pending" && <p>Chargement...</p>}
          {autoStartState === "activated" && (
            <>
              <p>
                Le démarrage automatique est{" "}
                <span className="font-bold underline">activé</span>
              </p>
              <Button type="button" onClick={disableAutoStart} className="mt-2">
                Désactiver le démarrage automatique
              </Button>
            </>
          )}
          {autoStartState === "not-activated" && (
            <>
              <p>
                Le démarrage automatique est{" "}
                <span className="font-bold underline">désactivé</span>
              </p>
              <Button type="button" onClick={enableAutoStart} className="mt-2">
                Activer le démarrage automatique
              </Button>
            </>
          )}
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
