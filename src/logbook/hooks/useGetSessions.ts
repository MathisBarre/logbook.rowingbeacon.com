import { useEffect, useState } from "react";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { sessionRepository } from "../SessionRepository";

interface SessionLog {
  id: string;
  rowers: {
    id: string;
    name: string;
  }[];
  boat: {
    id: string;
    name: string;
  };
  startDateTime: Date;
  endDateTime: Date | null;
  estimatedEndDateTime: Date | null;
  comment: string | null;
  route: {
    id: string;
    name: string;
  } | null;
  incident: {
    id: string;
  } | null;
}

export const useGetLastSessions = (payload: {
  pageSize: number;
}): {
  numberOfPages: number;
  currentPage: number;
  next: () => void;
  prev: () => void;
  loading: boolean;
  sessions: SessionLog[];
} => {
  const { pageSize } = payload;
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [numberOfPages, setNumberOfPages] = useState(0);
  const clubOverview = useClubOverviewStore();

  useEffect(() => {
    setLoading(true);
    const fetchSessions = async () => {
      const totalNumberOfSession =
        await sessionRepository.getTotalNumberOfSessions();

      const numberOfPages = Math.ceil(totalNumberOfSession / pageSize);

      setNumberOfPages(numberOfPages);

      const data = await sessionRepository.getSessions({
        pageSize,
        skip: (currentPage - 1) * pageSize,
        order: {
          startDateTime: "DESC",
        },
      });

      const formattedData = data.map((session) => {
        return {
          id: session.sessionId,
          rowers: clubOverview.getRowersById(
            (session.rowerIds || "").split(",")
          ),
          boat: clubOverview.getBoatById(session.boatId) || {
            id: session.boatId,
            name: "NOT_FOUND",
          },
          startDateTime: session.startDateTime,
          endDateTime: session.endDateTime,
          estimatedEndDateTime: session.estimatedEndDateTime,
          comment: session.comment,
          route: session.routeId
            ? clubOverview.getRouteById(session.routeId) || {
                id: session.routeId,
                name: "NOT_FOUND",
              }
            : null,
          incident: session.incidentId ? { id: session.incidentId } : null,
        };
      });

      setSessions(formattedData);

      setLoading(false);
    };

    fetchSessions();
  }, [pageSize, currentPage]);

  const next = () => {
    setCurrentPage((prev) => prev + 1);
  };

  const prev = () => {
    setCurrentPage((prev) => prev - 1);
  };

  return {
    numberOfPages,
    currentPage,
    next,
    prev,
    loading,
    sessions,
  };
};
