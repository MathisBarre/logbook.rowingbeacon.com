import { PencilIcon, Trash2Icon } from "lucide-react";
import { SimpleDialog } from "../../../_common/components/SimpleDialog";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { toast } from "sonner";
import Button from "../../../_common/components/Button";
import { windowPrompt } from "../../../_common/utils/window.utils";

export const RoutesCrudDialog = ({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) => {
  const store = useClubOverviewStore();
  const { routes } = store.clubOverview;

  const updateRouteName = async (routeId: string, currentName: string) => {
    const newRouteName = await windowPrompt(
      "Nouveau nom du parcours",
      currentName
    );

    if (!newRouteName) {
      return;
    }

    store.updateRouteName(routeId, newRouteName);

    toast.success("Le nom du parcours a été modifié");
  };

  const deleteRoute = (routeId: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce parcours ?")) {
      return;
    }

    store.deleteRoute(routeId);
    toast.success("Le parcours a été supprimé");
  };

  const addRoute = async () => {
    const routeName = await windowPrompt("Nom du parcours");

    if (!routeName) {
      return toast.error("Le parcours n'a pas été ajouté");
    }

    store.addRoute(routeName);
    toast.success("Le parcours a été ajouté");
  };

  return (
    <SimpleDialog
      open={isOpen}
      onOpenChange={(v) => setIsOpen(v)}
      title="Gestion des vos parcours"
      subtitle="Créer, modifier ou supprimer vos parcours"
    >
      <Button
        type="button"
        className="mb-4"
        onClick={() => {
          addRoute();
        }}
      >
        Ajouter un parcours
      </Button>
      <div className="flex gap-4 flex-wrap">
        {routes.map((route) => (
          <div key={route.id} className="border rounded flex items-center">
            <p className="text-nowrap px-4">{route.name}</p>
            <div className="h-full w-[1px] bg-gray-200" />
            <button
              onClick={() => {
                updateRouteName(route.id, route.name);
              }}
              className="flex items-center justify-center hover:bg-gray-100 h-12 w-12"
            >
              <PencilIcon className="h-4 w-4 cursor-pointer text-blue-900" />
            </button>
            <div className="h-full w-[1px] bg-gray-200" />
            <button
              onClick={() => {
                deleteRoute(route.id);
              }}
              className="flex items-center justify-center hover:bg-gray-100 h-12 w-12"
            >
              <Trash2Icon className="h-4 w-4 cursor-pointer text-error-900" />
            </button>
          </div>
        ))}
      </div>
    </SimpleDialog>
  );
};
