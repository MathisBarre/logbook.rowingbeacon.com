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
          id: session.session_id,
          rowers: clubOverview.getRowersById(
            (session.rower_ids || "").split(",")
          ),
          boat: clubOverview.getBoatById(session.boat_id) || {
            id: session.boat_id,
            name: "NOT_FOUND",
          },
          startDateTime: new Date(session.start_date_time),
          endDateTime: session.end_date_time
            ? new Date(session.end_date_time)
            : null,
          estimatedEndDateTime: session.estimated_end_date_time
            ? new Date(session.estimated_end_date_time)
            : null,
          comment: session.comment || null,
          route: session.route_id
            ? clubOverview.getRouteById(session.route_id) || {
                id: session.route_id,
                name: "NOT_FOUND",
              }
            : null,
          incident: session.incident_id ? { id: session.incident_id } : null,
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
