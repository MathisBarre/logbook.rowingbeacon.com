import { useState } from "react";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import Loading from "../../_common/components/Loading";
import { SeasonSelector } from "../../stats/components/SeasonSelector";
import { getSeasonDate } from "../../_common/utils/seasons";
import { useGetFirstAndLastRegisteredSessionDate } from "../../stats/utils/getFirstAndLastRegisteredSessionDate";
import { useGetRowerStats } from "../utils/getRowerStats";

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
