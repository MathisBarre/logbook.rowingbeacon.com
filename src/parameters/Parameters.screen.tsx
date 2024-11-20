import { useState } from "react";
import { RowersCrud } from "./components/RowersCrud";
import { forEnum } from "../_common/utils/utils";
import { RoutesCrud } from "./components/RoutesCrud";
import { BoatCrud } from "./components/BoatsCrud";

type Page = "rowers" | "routes" | "boats" | "params";

export const ParametersScreen = () => {
  const [page, setPage] = useState<Page>("rowers");

  return (
    <div className="flex flex-col h-full gap-1">
      <div className="flex-1 relative">
        {forEnum(page, {
          rowers: () => <RowersCrud />,
          routes: () => <RoutesCrud />,
          boats: () => <BoatCrud />,
          params: () => <div>Params</div>,
        })}
      </div>

      <nav className="flex gap-1">
        <NavigationButton
          label="Parcours"
          page="routes"
          currentPage={page}
          setPage={setPage}
        />
        <NavigationButton
          label="Bateaux"
          page="boats"
          currentPage={page}
          setPage={setPage}
        />
        <NavigationButton
          label="Rameurs"
          page="rowers"
          currentPage={page}
          setPage={setPage}
        />
      </nav>
    </div>
  );
};

const NavigationButton = ({
  label,
  page,
  currentPage,
  setPage,
}: {
  label: string;
  page: Page;
  currentPage: Page;
  setPage: (page: Page) => void;
}) => {
  return (
    <button
      onClick={() => {
        setPage(page);
      }}
      className={
        "rounded text-sm font-medium shadow-md bg-white text-steel-blue-800 hover:bg-gray-50 flex-1 h-8" +
        (currentPage === page
          ? " border border-steel-blue-800 border-opacity-75"
          : "")
      }
    >
      {label}
    </button>
  );
};
