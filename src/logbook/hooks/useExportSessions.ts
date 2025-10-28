import { toast } from "sonner";
import { exportData, exportJson, ExportType } from "../../_common/utils/export";
import { sessionRepository } from "../SessionRepository";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { getDateTimeWithoutTimezone } from "../../_common/utils/date.utils";
import useIncidentStore from "../../_common/store/incident.store";
import { useState } from "react";
import { getErrorMessage } from "../../_common/utils/error";
import { useTranslation } from "react-i18next";

export const useExportSessions = () => {
  const { t } = useTranslation();
  const clubOverview = useClubOverviewStore();
  const incidentStore = useIncidentStore();
  const [isLoading, setIsLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [isExportSuccess, setIsExportSuccess] = useState(false);

  const closeSuccess = () => {
    setIsExportSuccess(false);
  };

  const getDateStringIfExists = (date: Date | null) => {
    if (!date) {
      return null;
    }

    return date.toISOString();
  };

  const getRower = (rowerId: string) => {
    if (!rowerId) {
      return null;
    }

    return {
      id: getRowerId(rowerId),
      name: getRowerName(rowerId),
    };
  };

  const getRowerId = (rowerId: string) => {
    return clubOverview.getRowerById(rowerId)?.id || "";
  };

  const getRowerName = (rowerId: string) => {
    return clubOverview.getRowerById(rowerId)?.name || "";
  };

  const getIncident = (incidentId: string | null) => {
    if (!incidentId) {
      return null;
    }

    return {
      id: incidentId,
      message: getIncidentMessage(incidentId),
    };
  };

  const getIncidentMessage = (incidentId: string | null) => {
    if (!incidentId) {
      return "";
    }

    return incidentStore.getIncident(incidentId)?.message || "";
  };

  const getBoatName = (boatId: string) => {
    return clubOverview.getBoatById(boatId)?.name || "";
  };

  const getRouteName = (routeId: string) => {
    return clubOverview.getRouteById(routeId)?.name || "";
  };

  const getRoute = (routeId: string | null) => {
    if (!routeId) {
      return null;
    }

    return {
      id: routeId,
      name: getRouteName(routeId),
    };
  };

  const getBoat = (boatId: string) => {
    if (!boatId) {
      return null;
    }

    return {
      id: boatId,
      name: getBoatName(boatId),
    };
  };

  const getSessions = async (data: { fromDate: string; toDate: string }) => {
    return await sessionRepository.getSessions({
      maxPageSize: 999_999,
      skip: 0,
      order: {
        startDateTime: "DESC",
      },
      fromDate: new Date(data.fromDate),
      toDate: new Date(data.toDate),
    });
  };

  const formatToSpreadsheet = (
    sessionsDB: {
      sessionId: string;
      endDateTime: Date | null;
      estimatedEndDateTime: Date | null;
      startDateTime: Date;
      rowerIds: string;
      hasBeenCoached: boolean | null;
      boatId: string;
      routeId: string | null;
      incidentId: string | null;
      comment: string | null;
    }[]
  ) => {
    return sessionsDB.map((session) => {
      const rowersIds = session.rowerIds.split(",");

      return {
        session_id: session.sessionId,
        start_date_time: getDateTimeWithoutTimezone(session.startDateTime),
        estimated_end_date_time: session.estimatedEndDateTime
          ? getDateTimeWithoutTimezone(session.estimatedEndDateTime)
          : "",
        end_date_time: session.endDateTime
          ? getDateTimeWithoutTimezone(session.endDateTime)
          : "",
        comment: session.comment || "",
        incident_id: session.incidentId || "",
        incident_message: getIncidentMessage(session.incidentId),
        has_been_coached:
          session.hasBeenCoached !== null
            ? session.hasBeenCoached
              ? "true"
              : "false"
            : "",
        boat_id: session.boatId,
        boat_name: clubOverview.getBoatById(session.boatId)?.name || "",
        route_id: session.routeId || "",
        route_name: session.routeId
          ? clubOverview.getRouteById(session.routeId)?.name || ""
          : "",
        rower1_id: getRowerId(rowersIds[0]),
        rower1_name: getRowerName(rowersIds[0]),
        rower2_id: getRowerId(rowersIds[1]),
        rower2_name: getRowerName(rowersIds[1]),
        rower3_id: getRowerId(rowersIds[2]),
        rower3_name: getRowerName(rowersIds[2]),
        rower4_id: getRowerId(rowersIds[3]),
        rower4_name: getRowerName(rowersIds[3]),
        rower5_id: getRowerId(rowersIds[4]),
        rower5_name: getRowerName(rowersIds[4]),
        rower6_id: getRowerId(rowersIds[5]),
        rower6_name: getRowerName(rowersIds[5]),
        rower7_id: getRowerId(rowersIds[6]),
        rower7_name: getRowerName(rowersIds[6]),
        rower8_id: getRowerId(rowersIds[7]),
        rower8_name: getRowerName(rowersIds[7]),
        rower9_id: getRowerId(rowersIds[8]),
        rower9_name: getRowerName(rowersIds[8]),
      };
    });
  };

  const formatToJson = (
    sessionsDB: {
      sessionId: string;
      endDateTime: Date | null;
      estimatedEndDateTime: Date | null;
      startDateTime: Date;
      rowerIds: string;
      hasBeenCoached: boolean | null;
      boatId: string;
      routeId: string | null;
      incidentId: string | null;
      comment: string | null;
    }[]
  ) => {
    return sessionsDB.map((session) => {
      return {
        sessionId: session.sessionId,
        boat: getBoat(session.boatId),
        route: getRoute(session.routeId),
        rowers: session.rowerIds
          ? session.rowerIds
              .split(",")
              .map((rowerId) => getRower(rowerId))
              .filter(
                (rower): rower is { id: string; name: string } => rower !== null
              )
          : [],
        startDateTime: getDateStringIfExists(session.startDateTime),
        estimatedEndDateTime: getDateStringIfExists(
          session.estimatedEndDateTime
        ),
        endDateTime: getDateStringIfExists(session.endDateTime),
        comment: session.comment || "",
        hasBeenCoached: session.hasBeenCoached,
        relatedIncident: getIncident(session.incidentId),
      };
    });
  };

  const exportSessions = async (data: {
    fromDate: string;
    toDate: string;
    fileType: ExportType;
  }) => {
    try {
      setIsLoading(true);

      const fileName = getFileName(data);

      setFileName(fileName);

      const sessions = await getSessions(data);

      if (sessions.length === 0) {
        return toast.error(t("logbook.noSessionsFound"));
      }

      if (data.fileType !== "json") {
        await exportData({
          data: formatToSpreadsheet({ ...sessions }),
          fileName,
          fileType: data.fileType,
        });
      } else {
        await exportJson({
          data: formatToJson(sessions),
          fileName,
          fileType: data.fileType,
        });
      }

      setIsExportSuccess(true);
    } catch (e) {
      toast.error(`${t("import.exportError")} (${getErrorMessage(e)})`);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    exportSessions,
    isLoading,
    fileName,
    isExportSuccess,
    closeSuccess,
  };
};

const getFileName = (data: {
  fromDate: string;
  toDate: string;
  fileType: ExportType;
}) => {
  return `RowingBeacon_sessions_${getDateTimeWithoutTimezone(new Date())
    .replace(":", "-")
    .replace("T", "-")}.${data.fileType}`;
};
