import { useEffect, useState } from "react";
import { getDatabase } from "../../_common/database/database";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";

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
      const totalNumberOfSession = await getTotalNumberOfSessions();

      const numberOfPages = Math.ceil(totalNumberOfSession / pageSize);

      setNumberOfPages(numberOfPages);

      const data = await getLastSessions({
        pageSize,
        skip: (currentPage - 1) * pageSize,
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

const getLastSessions = async (payload: {
  pageSize: number;
  skip: number;
}): Promise<
  {
    session_id: string;
    boat_id: string;
    start_date_time: string;
    estimated_end_date_time: string | null;
    route_id: string | null;
    end_date_time: string | null;
    incident_id: string | null;
    comment: string | null;
    rower_ids: string | null;
  }[]
> => {
  const { pageSize, skip } = payload;

  const db = await getDatabase();

  const result = await db.select<
    {
      session_id: string;
      boat_id: string;
      start_date_time: string;
      estimated_end_date_time: string | null;
      route_id: string | null;
      end_date_time: string | null;
      incident_id: string | null;
      comment: string | null;
      rower_ids: string | null;
    }[]
  >(/* sql */ `
    SELECT 
      s.id AS session_id,
      s.boat_id,
      s.start_date_time,
      s.estimated_end_date_time,
      s.route_id,
      s.end_date_time,
      s.incident_id,
      s.comment,
      GROUP_CONCAT(sr.rower_id) AS rower_ids -- Combine rower IDs into a comma-separated string
    FROM 
      session s
    LEFT JOIN 
      session_rowers sr ON s.id = sr.session_id
    GROUP BY 
      s.id
    ORDER BY 
      s.start_date_time DESC
    LIMIT 
      ${pageSize}
    OFFSET
      ${skip}

    `);

  return result;
};

const getTotalNumberOfSessions = async (): Promise<number> => {
  const db = await getDatabase();

  const result = await db.select<{ count: number }[]>(/* sql */ `
    SELECT 
      COUNT(*) as count
    FROM 
      session
  `);

  return result[0].count;
};
