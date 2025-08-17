import { toast } from "sonner";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { windowConfirm } from "../../../_common/utils/window.utils";

export const useArchiveRower = () => {
  const store = useClubOverviewStore();

  const archiveRower = async (rower: { id: string; name: string }) => {
    const isConfirmed = await askRowerArchiveConfirmation(rower.name);

    if (!isConfirmed) {
      return;
    }

    store.archiveRower(rower.id);
    toast.success("Le rameur a été archivé");
  };

  return archiveRower;
};

const askRowerArchiveConfirmation = (name: string) =>
  windowConfirm(
    `Voulez-vous archiver le rameur "${name}" ?Il ne sera plus possible de renseigner des sorties avec ce rameur, mais les données enregistrées ne seront pas impactées.`
  );
