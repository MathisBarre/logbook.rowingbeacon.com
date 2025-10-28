import {
  askForAdminPassword,
  useAdminEditModeSystem,
} from "../store/adminEditMode.system";
import { useZoom } from "../utils/zoom";
import { ArrowLeftStartOnRectangleIcon } from "@heroicons/react/16/solid";
import { version } from "../../../package.json";
import { SimpleAlertDialog } from "./SimpleAlertDialog";
import Button from "./Button";
import { useState } from "react";
import useNavigationStore from "../store/navigation.store";
import { BookIcon, LockIcon, ShipIcon, BarChartIcon } from "lucide-react";
import logo from "../../_common/images/logo.svg";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import PageButton from "./PageButton";
import { useTranslation } from "react-i18next";

export const NavigationBar = () => {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, zoomPercentage } = useZoom();
  const {
    setPage,
    navigation: { page },
  } = useNavigationStore();
  const [isLogoutAlertOpen, setIsLogoutAlertOpen] = useState(false);
  const adminEditSystem = useAdminEditModeSystem();

  return (
    <>
      <div className="flex justify-end mb-0 gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex gap-2 hover:bg-steel-blue-900 min-w-48 justify-center py-2 cursor-pointer shadow-md rounded border overflow-hidden bg-steel-blue-800"
            >
              <div className="flex items-center  h-full">
                <img src={logo} className="h-6 w-6" />
              </div>

              <div className="">
                <p className="text-sm leading-4 font-medium text-white text-left">
                  RowingBeacon
                </p>
                <p className="text-xs leading-3 text-white text-left">
                  Logbook v{version}
                </p>
              </div>
            </button>
          </PopoverTrigger>
          <PopoverContent asChild>
            <div className="flex flex-col p-2 gap-2 rounded  w-48">
              <div className=" text-sm font-medium text-steel-blue-800 flex items-center justify-center rounded bg-steel-blue-50 border border-steel-blue-100">
                <button
                  className="h-8 w-8 hover:bg-steel-blue-200 border-r border-steel-blue-100"
                  onClick={() => {
                    zoomOut();
                  }}
                >
                  -
                </button>
                <p className="flex-1 text-center mx-4">
                  {t("navigation.zoom")} {zoomPercentage}%
                </p>
                <button
                  className="h-8 w-8 hover:bg-steel-blue-200 border-l border-steel-blue-100"
                  onClick={() => {
                    zoomIn();
                  }}
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className="text-sm font-medium text-error-800 hover:bg-error-100 border-error-100 bg-error-50 border rounded flex p-2 gap-2 items-center "
                onClick={() => {
                  setIsLogoutAlertOpen(true);
                }}
              >
                <ArrowLeftStartOnRectangleIcon className="h-4 w-4" />
                {t("navigation.logout")}
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex flex-1 gap-1">
          <PageButton
            page="boathouse"
            currentPage={page}
            setPage={setPage}
            icon={<ShipIcon className="h-4 w-4" />}
            label={t("navigation.boathouse")}
          />

          <PageButton
            page="logbook"
            currentPage={page}
            setPage={setPage}
            icon={<BookIcon className="h-4 w-4" />}
            label={t("navigation.logbook")}
          />

          <PageButton
            page="stats"
            currentPage={page}
            setPage={setPage}
            icon={<BarChartIcon className="h-4 w-4" />}
            label={t("navigation.stats")}
          />

          <PageButton
            page="parameters"
            currentPage={page}
            setPage={setPage}
            icon={<LockIcon className="h-4 w-4" />}
            label={t("navigation.parameters")}
          />
        </div>
      </div>

      <SimpleAlertDialog
        title={t("navigation.logoutConfirmTitle")}
        description={t("navigation.logoutConfirmDescription")}
        isOpen={isLogoutAlertOpen}
        cancelElement={
          <Button
            variant="primary"
            type="button"
            onClick={() => {
              setIsLogoutAlertOpen(false);
            }}
          >
            {t("common.cancel")}
          </Button>
        }
        confirmElement={
          <Button
            color="danger"
            type="button"
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            onClick={async () => {
              setIsLogoutAlertOpen(false);
              const password = await askForAdminPassword();
              await adminEditSystem.closeApp(password);
            }}
          >
            {t("navigation.logout")}
          </Button>
        }
      />
    </>
  );
};
