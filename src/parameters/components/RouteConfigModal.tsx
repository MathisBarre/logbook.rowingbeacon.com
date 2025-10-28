import { PencilIcon, Trash2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { toast } from "sonner";
import Button from "../../_common/components/Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogFooter,
} from "../../_common/components/Dialog/Dialog";
import { Input } from "../../_common/components/Input";
import { useState } from "react";

interface RouteConfigModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export const RouteConfigModal = ({
  isOpen,
  onOpenChange,
}: RouteConfigModalProps) => {
  const { t } = useTranslation();
  const store = useClubOverviewStore();
  const routes = store.getAllRoutes();
  const [newRouteName, setNewRouteName] = useState("");
  const [editingRoute, setEditingRoute] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    isOpen: boolean;
    route: { id: string; name: string } | null;
  }>({
    isOpen: false,
    route: null,
  });

  const handleUpdateRouteName = (newName: string) => {
    if (!editingRoute) return;
    store.updateRouteName(editingRoute.id, newName);
    toast.success(t("parameters.routeNameUpdated"));
    setEditingRoute(null);
  };

  const handleAddRoute = () => {
    if (!newRouteName.trim()) return;
    store.addRoute(newRouteName.trim());
    toast.success(t("parameters.routeAdded"));
    setNewRouteName("");
  };

  const deleteRoute = (route: { id: string; name: string }) => {
    setConfirmDelete({ isOpen: true, route });
  };

  const handleConfirmDelete = () => {
    if (!confirmDelete.route) return;
    store.archiveRoute(confirmDelete.route.id);
    toast.success(t("parameters.routeArchived"));
    setConfirmDelete({ isOpen: false, route: null });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent title={t("parameters.routeManagement")} className="max-w-xl">
        <div className="flex flex-col gap-4">
          <p className="text-gray-500">
            {t("parameters.routeManagementDescription")}
          </p>
          <div className="flex gap-2 items-center">
            <Input
              value={newRouteName}
              onChange={(e) => setNewRouteName(e.target.value)}
              placeholder={t("parameters.newRouteName")}
              className="flex-1 mt-0"
            />
            <Button
              className="h-10"
              type="button"
              onClick={handleAddRoute}
              disabled={!newRouteName.trim()}
            >
              {t("parameters.addRoute")}
            </Button>
          </div>
          <div className="flex gap-4 flex-wrap">
            {routes.map((route) => (
              <div key={route.id} className="border rounded flex items-center">
                {editingRoute?.id === route.id ? (
                  <div className="flex items-center gap-2 px-4">
                    <Input
                      value={editingRoute.name}
                      onChange={(e) =>
                        setEditingRoute({
                          ...editingRoute,
                          name: e.target.value,
                        })
                      }
                      className="w-48"
                      autoFocus
                    />
                    <Button
                      type="button"
                      onClick={() => handleUpdateRouteName(editingRoute.name)}
                      disabled={!editingRoute.name.trim()}
                    >
                      ✓
                    </Button>
                    <Button
                      type="button"
                      variant="outlined"
                      onClick={() => setEditingRoute(null)}
                    >
                      ✕
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-nowrap px-4">{route.name}</p>
                    <div className="h-full w-[1px] bg-gray-200" />
                    <button
                      onClick={() => setEditingRoute(route)}
                      className="flex items-center justify-center hover:bg-gray-100 h-12 w-12"
                    >
                      <PencilIcon className="h-4 w-4 cursor-pointer text-steel-blue-800" />
                    </button>
                    <div className="h-full w-[1px] bg-gray-200" />
                    <button
                      onClick={() => {
                        void deleteRoute(route);
                      }}
                      className="flex items-center justify-center hover:bg-gray-100 h-12 w-12"
                    >
                      <Trash2Icon className="h-4 w-4 cursor-pointer text-error-900" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
      <Dialog
        open={confirmDelete.isOpen}
        onOpenChange={(open) =>
          setConfirmDelete({ isOpen: open, route: confirmDelete.route })
        }
      >
        <DialogContent className="max-w-xl" title={t("parameters.archiveRoute")}>
          <DialogHeader>
            <DialogDescription className="mb-4">
              {t("parameters.confirmArchiveRoute", { routeName: confirmDelete.route?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => setConfirmDelete({ isOpen: false, route: null })}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirmDelete}
            >
              {t("parameters.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};
