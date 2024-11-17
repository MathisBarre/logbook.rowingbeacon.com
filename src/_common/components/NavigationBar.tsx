import {
  askForAdminPassword,
  useAdminEditModeSystem,
} from "../store/adminEditMode.system";
import { useLogout } from "../utils/logout";
import { useZoom } from "../utils/zoom";
import { ArrowLeftStartOnRectangleIcon } from "@heroicons/react/16/solid";
import { version } from "../../../package.json";
import { SimpleAlertDialog } from "./SimpleAlertDialog";
import Button from "./Button";
import { useState } from "react";
import useNavigationStore from "../store/navigation.store";
import { cn } from "../utils/utils";
import { LockIcon } from "lucide-react";

export const NavigationBar = () => {
  const { zoomIn, zoomOut, zoomPercentage } = useZoom();
  const logout = useLogout();
  const adminEditSystem = useAdminEditModeSystem();
  const {
    setPage,
    navigation: { page },
  } = useNavigationStore();
  const [isLogoutAlertOpen, setIsLogoutAlertOpen] = useState(false);

  return (
    <>
      <div className="h-8 flex justify-end gap-1">
        <div className="flex items-center gap-3 bg-steel-blue-800 text-white pl-1 pr-3 rounded relative group">
          <button
            onClick={async () => {
              if (
                adminEditSystem.allowAdminActions(await askForAdminPassword())
              ) {
                logout();
              }
            }}
            type="button"
            className="absolute inset-0 items-center justify-center bg-error-800 rounded hidden group-hover:flex"
          >
            Reset data
          </button>

          <div className="flex flex-col justify-center">
            <span className="text-sm leading-3 font-medium">RowingBeacon</span>
            <span className="text-xs leading-3">Logbook</span>
          </div>
          <div className="font-medium text-sm">v{version}</div>
        </div>
        <button
          className="px-6 rounded text-sm font-medium shadow-md bg-white text-error-800 hover:bg-gray-50 border-error-900"
          onClick={() => {
            setIsLogoutAlertOpen(true);
          }}
        >
          <ArrowLeftStartOnRectangleIcon className="h-4 w-4" />
        </button>

        <div className=" text-sm font-medium shadow-md bg-white text-steel-blue-800 flex items-center justify-center rounded">
          <button
            className="h-8 w-8 hover:bg-gray-100"
            onClick={() => {
              zoomOut();
            }}
          >
            -
          </button>
          <p className="flex-1 text-center mx-4">Zoom {zoomPercentage}%</p>
          <button
            className="h-8 w-8 hover:bg-gray-100"
            onClick={() => {
              zoomIn();
            }}
          >
            +
          </button>
        </div>

        <button
          onClick={() => {
            setPage("boathouse");
          }}
          className={cn(
            "rounded text-sm font-medium shadow-md bg-white text-steel-blue-800 hover:bg-gray-50 flex-1",
            page === "boathouse" &&
              "border border-steel-blue-800 border-opacity-75"
          )}
        >
          Boathouse
        </button>

        <button
          onClick={() => {
            setPage("logbook");
          }}
          className={cn(
            "rounded text-sm font-medium shadow-md bg-white text-steel-blue-800 hover:bg-gray-50 flex-1",
            page === "logbook" &&
              "border border-steel-blue-800 border-opacity-75"
          )}
        >
          Logbook
        </button>

        <button
          onClick={async () => {
            if (
              adminEditSystem.allowAdminActions(await askForAdminPassword())
            ) {
              setPage("parameters");
            }
          }}
          className={cn(
            "rounded text-sm font-medium shadow-md bg-white text-steel-blue-800 hover:bg-gray-50 flex-1 flex items-center justify-center gap-2",
            page === "parameters" &&
              "border border-steel-blue-800 border-opacity-75"
          )}
        >
          <LockIcon className="h-4 w-4" />
          Gestion
        </button>
      </div>

      <SimpleAlertDialog
        title="Fermer l'application ?"
        description="Vous allez fermer l'application. Aucune donnée ne sera perdue."
        isOpen={isLogoutAlertOpen}
        cancelElement={
          <Button
            variant="primary"
            type="button"
            onClick={() => {
              setIsLogoutAlertOpen(false);
            }}
          >
            Annuler
          </Button>
        }
        confirmElement={
          <Button
            color="danger"
            type="button"
            onClick={async () => {
              setIsLogoutAlertOpen(false);
              adminEditSystem.closeApp(await askForAdminPassword());
            }}
          >
            Fermer l'application
          </Button>
        }
      />
    </>
  );
};
