import { and, eq, inArray, not, between } from "drizzle-orm";
import { getDatabase } from "../../_common/database/database";
import { DBSessionOnRowers, DBSessions } from "../../_common/database/schema";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "../../_common/utils/error";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import Loading from "../../_common/components/Loading";
import { SeasonSelector } from "../../stats/components/SeasonSelector";
import { getSeasonDate } from "../../_common/utils/seasons";
import { useGetFirstAndLastRegisteredSessionDate } from "../../stats/utils/getFirstAndLastRegisteredSessionDate";

export const RowerStats = ({ rowerId }: { rowerId: string }) => {
  const {
    firstSession,
    lastSession,
    isLoading: isLoadingDates,
  } = useGetFirstAndLastRegisteredSessionDate();
  const [selectedSeason, setSelectedSeason] = useState(
    getSeasonDate(new Date())
  );
  const {
    count,
    totalDuration,
    mostUsedBoats,
    mostFrequentPartners,
    firstSessionDate,
    lastSessionDate,
  } = useGetRowerStats(rowerId, selectedSeason);
  const { getBoatById, getRowerById } = useClubOverviewStore();

  if (count === undefined) return <Loading />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {isLoadingDates && <Loading />}
        <SeasonSelector
          value={selectedSeason}
          onChange={setSelectedSeason}
          firstDataAt={firstSession || new Date()}
          lastDataAt={lastSession || new Date()}
          disabled={isLoadingDates}
        />
      </div>

      <h1 className="font-medium text-lg mb-2">Statistiques générales</h1>
      <p>
        <span>Nombre de sessions : </span> <strong>{count}</strong>
      </p>
      <p>
        <span>Temps passé sur l&apos;eau : </span>{" "}
        <strong>{millisecondToDayHourMinutes(totalDuration)}</strong>
      </p>
      <p>
        <span>Moyenne temps / sessions : </span>{" "}
        <strong>
          {millisecondToDayHourMinutes(totalDuration / count || 0)}
        </strong>
      </p>

      {firstSessionDate && lastSessionDate && (
        <>
          <p>
            <span>Première session : </span>{" "}
            <strong>{firstSessionDate.toLocaleDateString()}</strong>
          </p>
          <p>
            <span>Dernière session : </span>{" "}
            <strong>{lastSessionDate.toLocaleDateString()}</strong>
          </p>
        </>
      )}
      <h1 className="font-medium text-lg mb-2 mt-4">
        Bateaux les plus utilisés
      </h1>

      {mostUsedBoats.length === 0 && <p>Aucun bateau utilisé</p>}

      <ul>
        {mostUsedBoats.map((boat) => (
          <li key={boat.id}>
            <span>{getBoatById(boat.id)?.name || "NAME_NOT_FOUND"}</span>{" "}
            <span className="font-bold"> - {boat.count} utilisations</span>
          </li>
        ))}
      </ul>

      <h1 className="font-medium text-lg mb-2 mt-4">
        Partenaires les plus fréquents
      </h1>

      {mostFrequentPartners.length === 0 && <p>Aucun partenaire trouvé</p>}

      <ul>
        {mostFrequentPartners.map((partner) => (
          <li key={partner.id}>
            <span>{getRowerById(partner.id)?.name || "NAME_NOT_FOUND"}</span>{" "}
            <span className="font-bold"> - {partner.count} sessions</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const useGetRowerStats = (
  rowerId: string,
  season: { startDate: Date; endDate: Date }
) => {
  const [stats, setStats] = useState<{
    count: number;
    totalDuration: number;
    mostUsedBoats: { id: string; count: number }[];
    mostFrequentPartners: { id: string; count: number }[];
    firstSessionDate?: Date;
    lastSessionDate?: Date;
  }>({
    count: 0,
    totalDuration: 0,
    mostUsedBoats: [],
    mostFrequentPartners: [],
  });

  useEffect(() => {
    getRowerStats(rowerId, season)
      .then(setStats)
      .catch((e) => toast.error(getErrorMessage(e)));
  }, [rowerId, season]);

  return stats;
};

const getRowerStats = async (
  rowerId: string,
  season: { startDate: Date; endDate: Date }
): Promise<{
  count: number;
  totalDuration: number;
  mostUsedBoats: { id: string; count: number }[];
  mostFrequentPartners: { id: string; count: number }[];
  firstSessionDate?: Date;
  lastSessionDate?: Date;
}> => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle
    .select()
    .from(DBSessionOnRowers)
    .leftJoin(DBSessions, eq(DBSessions.id, DBSessionOnRowers.sessionId))
    .where(
      and(
        eq(DBSessionOnRowers.rowerId, rowerId),
        between(
          DBSessions.startDateTime,
          season.startDate.toISOString(),
          season.endDate.toISOString()
        )
      )
    );

  const count = sessions.length;
  const totalDuration = sessions.reduce((acc: number, session) => {
    if (!session.session?.startDateTime || !session.session?.endDateTime) {
      return acc;
    }

    const start = new Date(session.session.startDateTime);
    const end = new Date(session.session.endDateTime);
    const duration = end.getTime() - start.getTime();
    return acc + duration;
  }, 0);

  // Get first and last session dates
  const validSessions = sessions.filter(
    (s) => s.session?.startDateTime && s.session?.endDateTime
  );
  const firstSessionDate =
    validSessions.length > 0
      ? new Date(
          Math.min(
            ...validSessions.map((s) =>
              new Date(s.session!.startDateTime).getTime()
            )
          )
        )
      : undefined;
  const lastSessionDate =
    validSessions.length > 0
      ? new Date(
          Math.max(
            ...validSessions.map((s) =>
              new Date(s.session!.endDateTime!).getTime()
            )
          )
        )
      : undefined;

  const boats = sessions
    .reduce((acc: { id: string; count: number }[], session) => {
      const boatId = session.session?.boatId;
      if (!boatId) {
        return acc;
      }

      const existing = acc.find((b) => b.id === boatId);
      if (existing) {
        existing.count++;
      } else {
        acc.push({ id: boatId, count: 1 });
      }

      return acc;
    }, [] as { id: string; count: number }[])
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const sessionsIds = sessions
    .map((s) => s.session?.id)
    .filter((id) => id !== undefined);

  const sessionsOnRower = await drizzle
    .select()
    .from(DBSessionOnRowers)
    .where(
      and(
        inArray(DBSessionOnRowers.sessionId, sessionsIds),
        not(eq(DBSessionOnRowers.rowerId, rowerId))
      )
    );

  const mostFrequentPartners = sessionsOnRower
    .reduce((acc: { id: string; count: number }[], sessionOnRower) => {
      const existing = acc.find((rower) => rower.id === sessionOnRower.rowerId);

      if (existing) {
        existing.count++;
      } else {
        acc.push({ id: sessionOnRower.rowerId, count: 1 });
      }

      return acc;
    }, [] as { id: string; count: number }[])
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    count,
    totalDuration,
    mostUsedBoats: boats,
    mostFrequentPartners,
    firstSessionDate,
    lastSessionDate,
  };
};
