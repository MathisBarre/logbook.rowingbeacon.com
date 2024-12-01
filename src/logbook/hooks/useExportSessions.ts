import { toast } from "sonner";
import { exportData, ExportType } from "../../_common/utils/export";
import { sessionRepository } from "../SessionRepository";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { getDateTimeWithoutTimezone } from "../../_common/utils/date.utils";
import useIncidentStore from "../../_common/store/incident.store";
import { useState } from "react";
import { getErrorMessage } from "../../_common/utils/error";

export const useExportSessions = () => {
  const clubOverview = useClubOverviewStore();
  const incidentStore = useIncidentStore();
  const [isLoading, setIsLoading] = useState(false);

  const getSessions = async (data: { fromDate: string; toDate: string }) => {
    const sessionsDB = await sessionRepository.getSessions({
      maxPageSize: 999_999,
      skip: 0,
      order: {
        startDateTime: "DESC",
      },
      fromDate: new Date(data.fromDate),
      toDate: new Date(data.toDate),
    });

    const getRowerId = (rowerId: string) => {
      return clubOverview.getRowerById(rowerId)?.id || "";
    };

    const getRowerName = (rowerId: string) => {
      return clubOverview.getRowerById(rowerId)?.name || "";
    };

    const getIncidentMessage = (incidentId: string | null) => {
      if (!incidentId) {
        return "";
      }

      return incidentStore.getIncident(incidentId)?.message || "";
    };

    return sessionsDB.map((session) => {
      const rowers = session.rowerIds ? session.rowerIds.split(",") : [];

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
        boat_id: session.boatId,
        boat_name: clubOverview.getBoatById(session.boatId)?.name || "",
        route_id: session.routeId || "",
        route_name: session.routeId
          ? clubOverview.getRouteById(session.routeId)?.name || ""
          : "",
        rower1_id: getRowerId(rowers[0]),
        rower1_name: getRowerName(rowers[0]),
        rower2_id: getRowerId(rowers[1]),
        rower2_name: getRowerName(rowers[1]),
        rower3_id: getRowerId(rowers[2]),
        rower3_name: getRowerName(rowers[2]),
        rower4_id: getRowerId(rowers[3]),
        rower4_name: getRowerName(rowers[3]),
        rower5_id: getRowerId(rowers[4]),
        rower5_name: getRowerName(rowers[4]),
        rower6_id: getRowerId(rowers[5]),
        rower6_name: getRowerName(rowers[5]),
        rower7_id: getRowerId(rowers[6]),
        rower7_name: getRowerName(rowers[6]),
        rower8_id: getRowerId(rowers[7]),
        rower8_name: getRowerName(rowers[7]),
        rower9_id: getRowerId(rowers[8]),
        rower9_name: getRowerName(rowers[8]),
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

      const fileName = `RowingBeacon_sessions_${getDateTimeWithoutTimezone(
        new Date()
      )}.${data.fileType}`;

      const sessions = await getSessions(data);

      if (sessions.length === 0) {
        return toast.error("Aucune session trouvée avec ces filtres");
      }

      exportData({
        data: sessions,
        fileName,
        fileType: data.fileType,
      });

      toast.success(
        "Export réussi. Le fichier a été enregistré dans le dossier de téléchargement."
      );
    } catch (e) {
      toast.error(`Erreur lors de l'export (${getErrorMessage(e)})`);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    exportSessions,
    isLoading,
  };
};
