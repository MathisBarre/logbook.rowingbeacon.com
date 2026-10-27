import { toast } from "sonner";
import { exportData, exportJson, ExportType } from "../../_common/utils/export";
import { sessionRepository } from "../SessionRepository";
import { flushWrites } from "../../_common/database/writeQueue";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { getDateTimeWithoutTimezone } from "../../_common/utils/date.utils";
import useIncidentStore from "../../_common/store/incident.store";
import { useState } from "react";
import { getErrorMessage } from "../../_common/utils/error";
import { useTranslation } from "react-i18next";
import { metresToKilometres } from "../../_common/business/distance.rules";
import { getOutingTypeLabel } from "../../_common/business/outingType.rules";
import { getConfigurationCode } from "../../_common/business/boatConfiguration.rules";
import { getDatabase } from "../../_common/database/database";

type SessionFromDb = Awaited<
  ReturnType<typeof sessionRepository.getSessions>
>[number];

/** Codes (4x, 4-…) of every configuration, archived ones included. */
const getConfigurationCodes = async () => {
  const { db } = await getDatabase();
  const rows = await db.select<
    {
      id: string;
      seats: number | null;
      rigging: "scull" | "sweep" | null;
      coxed: number;
    }[]
  >("SELECT id, seats, rigging, coxed FROM boat_configuration");
  return new Map(
    rows.map((row) => [
      row.id,
      getConfigurationCode({ ...row, coxed: row.coxed === 1 }) ?? "",
    ])
  );
};

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

  // A rower missing from memory (merged) keeps their id in the export.
  const getRowerId = (rowerId: string | undefined) => {
    return rowerId ?? "";
  };

  const getRowerName = (rowerId: string | undefined) => {
    return rowerId ? clubOverview.getRowerById(rowerId)?.name || "" : "";
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
    // An outing finished just before the export is still in the queue.
    await flushWrites();
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

  const getIncidentMessages = (incidentIds: string[]) =>
    incidentIds.map(getIncidentMessage).filter(Boolean).join(" | ");

  const formatToSpreadsheet = (
    sessionsDB: SessionFromDb[],
    configurationCodes: Map<string, string>
  ) => {
    const getRowerIds = (session: SessionFromDb) =>
      session.crew
        .filter((member) => member.role === "rower")
        .map((member) => member.rowerId);
    // As many rower columns as the largest crew exported.
    // A loop, not a spread: a spread of every outing hits the engine's
    // argument limit on large exports.
    const rowerColumnsCount = sessionsDB.reduce(
      (max, session) => Math.max(max, getRowerIds(session).length),
      1
    );

    return sessionsDB.map((session) => {
      const rowersIds = getRowerIds(session);
      const coxId = session.crew.find((member) => member.role === "cox")
        ?.rowerId;
      const rowerColumns: Record<string, string> = {};
      for (let index = 0; index < rowerColumnsCount; index++) {
        rowerColumns[`rower${index + 1}_id`] = getRowerId(rowersIds[index]);
        rowerColumns[`rower${index + 1}_name`] = getRowerName(rowersIds[index]);
      }
      const distanceKm = metresToKilometres(session.distanceM);

      // v1 columns first, in their v1 order; v2 columns after the rowers.
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
        incident_id: session.incidentIds.join(" | "),
        incident_message: getIncidentMessages(session.incidentIds),
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
        ...rowerColumns,
        boat_configuration: session.boatConfigurationId
          ? (configurationCodes.get(session.boatConfigurationId) ?? "")
          : "",
        outing_type: getOutingTypeLabel(session.outingTypeCode),
        outing_type_code: session.outingTypeCode ?? "",
        distance_km: distanceKm ?? "",
        cox_id: getRowerId(coxId),
        cox_name: getRowerName(coxId),
        captain_id: getRowerId(session.captainRowerId ?? undefined),
        captain_name: getRowerName(session.captainRowerId ?? undefined),
      };
    });
  };

  const formatToJson = (
    sessionsDB: SessionFromDb[],
    configurationCodes: Map<string, string>
  ) => {
    return sessionsDB.map((session) => {
      return {
        sessionId: session.sessionId,
        boat: getBoat(session.boatId),
        boatConfiguration: session.boatConfigurationId
          ? (configurationCodes.get(session.boatConfigurationId) ?? null)
          : null,
        route: getRoute(session.routeId),
        rowers: session.crew.flatMap((member) => {
          const rower = getRower(member.rowerId);
          return rower ? [{ ...rower, role: member.role }] : [];
        }),
        outingType: session.outingTypeCode,
        outingTypeLabel: getOutingTypeLabel(session.outingTypeCode) || null,
        distanceKm: metresToKilometres(session.distanceM),
        captain: getRower(session.captainRowerId ?? ""),
        startDateTime: getDateStringIfExists(session.startDateTime),
        estimatedEndDateTime: getDateStringIfExists(
          session.estimatedEndDateTime
        ),
        endDateTime: getDateStringIfExists(session.endDateTime),
        comment: session.comment || "",
        hasBeenCoached: session.hasBeenCoached,
        relatedIncident: getIncident(session.incidentId),
        relatedIncidents: session.incidentIds.map(getIncident),
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

      const configurationCodes = await getConfigurationCodes();

      if (data.fileType !== "json") {
        await exportData({
          data: formatToSpreadsheet(sessions, configurationCodes),
          fileName,
          fileType: data.fileType,
        });
      } else {
        await exportJson({
          data: formatToJson(sessions, configurationCodes),
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
