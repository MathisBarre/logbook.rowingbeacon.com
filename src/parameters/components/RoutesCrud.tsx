/* eslint-disable @typescript-eslint/no-misused-promises */
import { PencilIcon, Trash2Icon } from "lucide-react";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { toast } from "sonner";
import Button from "../../_common/components/Button";
import { windowConfirm, windowPrompt } from "../../_common/utils/window.utils";

export const RoutesCrud = () => {
  const store = useClubOverviewStore();
  const routes = store.getAllRoutes();

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

  const deleteRoute = async (route: { id: string; name: string }) => {
    if (
      !(await windowConfirm(
        `Voulez-vous archiver le parcours "${route.name}" ? Il ne sera plus possible de renseigner des sorties avec ce parcours, mais les données enregistrées ne seront pas impactées.`
      ))
    ) {
      return;
    }

    store.archiveRoute(route.id);
    toast.success("Le parcours a été supprimé");
  };

  const addRoute = async () => {
    const routeName = await windowPrompt("Nom du parcours");

    if (!routeName) {
      return;
    }

    store.addRoute(routeName);
    toast.success("Le parcours a été ajouté");
  };

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center">Vos parcours</h1>
      </div>

      <div className="p-4">
        <Button
          type="button"
          className="mb-4 w-full"
          onClick={async () => {
            await addRoute();
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
                onClick={async () => {
                  await updateRouteName(route.id, route.name);
                }}
                className="flex items-center justify-center hover:bg-gray-100 h-12 w-12"
              >
                <PencilIcon className="h-4 w-4 cursor-pointer text-steel-blue-800" />
              </button>
              <div className="h-full w-[1px] bg-gray-200" />
              <button
                onClick={async () => {
                  await deleteRoute(route);
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
  );
};
