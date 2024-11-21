import Button from "../../_common/components/Button";
import { ZustandSession } from "../../_common/store/sessions.store";
import { SessionHistoryTable, SessionInTable } from "./SessionLogsTable";
import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { paginateData } from "../../_common/utils/pagination.utils";
import { isDev } from "../../_common/utils/utils";
import { Rower } from "../../_common/types/rower.type";
import { Route } from "../../_common/types/route.type";
import { Boat } from "../../_common/types/boat.type";
import { generateSessionId } from "../../_common/business/session.rules";
import { addHours } from "../../_common/utils/date.utils";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";

export const SessionLogs = () => {
  const clubOverviewStore = useClubOverviewStore();

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;
  const formattedData = formatData(sessionsStore.session);

  const paginatedData = paginateData(formattedData, {
    currentPage,
    pageSize,
  });

  const numberOfPages = Math.ceil(formattedData.length / pageSize) || 1;

  return (
    <div className="flex-1 shadow-md bg-white flex flex-col absolute inset-0 right-1/2 mr-[.125rem] rounded overflow-hidden">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12 items-center">
        <h1 className="text-base ml-2">Historique des sorties</h1>
      </div>

      <SessionHistoryTable sessionsInTableList={paginatedData} />

      <section className="shadow border py-4 px-8 absolute z-10 bg-white p-2 rounded bottom-4 left-1/2 -translate-x-1/2">
        <p className="italic text-center">
          Page {currentPage} sur {numberOfPages}
        </p>
        <div className="flex justify-center gap-4 mt-4">
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              setCurrentPage((prev) => Math.max(1, prev - 1));
            }}
            disabled={currentPage <= 1}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              setCurrentPage((prev) => Math.min(numberOfPages || 1, prev + 1));
            }}
            disabled={currentPage === numberOfPages}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </section>

      {isDev && (
        <p className="absolute bg-white py-1 px-2 border border-gray-300 bottom-4 right-4 rounded-sm flex gap-2 items-center ">
          devtools:session-generator:1000{" "}
          <button
            className="bg-steel-blue-300 px-2 py-1"
            onClick={() => {
              console.log("click");
              const generatedSessions = generateSessions(
                clubOverviewStore.clubOverview.rowers,
                clubOverviewStore.clubOverview.boats,
                clubOverviewStore.clubOverview.routes,
                1000
              );

              sessionsStore.bulkAddSessions(generatedSessions);
            }}
          >
            generate
          </button>
        </p>
      )}
    </div>
  );
};

const generateSessions = (
  rowers: Rower[],
  boats: Boat[],
  routes: Route[],
  nb: number
) => {
  const sessions = [];
  for (let i = 0; i < nb; i++) {
    // get a random boat in boat list
    const randomBoat = boats[Math.floor(Math.random() * boats.length)];

    // get a random route in route list
    const randomRoute = routes[Math.floor(Math.random() * routes.length)];

    // get x rowers depending of boat type
    const numberOfRowersToGet = {
      ONE_ROWER_COXLESS: 1,
      TWO_ROWERS_COXLESS: 2,
      TWO_ROWERS_COXED: 2,
      FOUR_ROWERS_COXLESS: 4,
      FOUR_ROWERS_COXED: 4,
      EIGHT_ROWERS_COXED: 8,
      OTHER: 1,
    };

    const rowersToGet =
      numberOfRowersToGet[randomBoat.type || "ONE_ROWER_COXLESS"];

    const sRowers = [];

    for (let i = 0; i < rowersToGet; i++) {
      sRowers.push(rowers[Math.floor(Math.random() * rowers.length)]);
    }

    const session = {
      id: generateSessionId(),
      rowers: sRowers,
      route: randomRoute,
      boat: randomBoat,
      startDateTime: new Date().toISOString(),
      estimatedEndDateTime: new Date().toISOString(),
      comment: "RAS",
      endDateTime: addHours(new Date(), 2).toISOString(),
    };

    sessions.push(session);
  }
  console.log(sessions);
  return sessions;
};

const formatData = (
  clientSessionHistoryData: ZustandSession[]
): SessionInTable[] => {
  const clientSessionHistoryForTable: SessionInTable[] =
    clientSessionHistoryData.map((sess) => ({
      id: sess.id,
      boatName: sess.boat.name,
      startDateTime: sess.startDateTime,
      endDateTime: sess.endDateTime,
      routeName: sess.route.name,
      rowers: sess.rowers.map((r) => r.name).join(", "),
      comment: sess.comment,
      route: sess.route.name,
      rowersName: sess.rowers.map((r) => r.name),
      status: sess.endDateTime ? "COMPLETED" : "STARTED",
    }));

  const sortedMergedData = clientSessionHistoryForTable.sort((a, b) => {
    if (a.startDateTime && b.startDateTime) {
      return (
        new Date(b.startDateTime).getTime() -
        new Date(a.startDateTime).getTime()
      );
    }
    return 0;
  });

  return sortedMergedData;
};
