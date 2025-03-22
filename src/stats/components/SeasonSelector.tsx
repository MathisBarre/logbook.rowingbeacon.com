import { getSeasonDate, Season } from "../../_common/utils/seasons";
import { cn } from "../../_common/utils/utils";
import { getDatabase } from "../../_common/database/database";
import { DBSessions } from "../../_common/database/schema";
import { useEffect } from "react";
import { useState } from "react";

interface SeasonSelectorProps {
  value: Season;
  onChange: (date: Season) => void;
}

const getFirstRegisteredSessionDate = async () => {
  const { drizzle } = await getDatabase();
  const firstSession = await drizzle
    .select()
    .from(DBSessions)
    .orderBy(DBSessions.startDateTime)
    .limit(1);
  return firstSession[0].startDateTime;
};

const getLastRegisteredSessionDate = async () => {
  const { drizzle } = await getDatabase();
  const lastSession = await drizzle
    .select()
    .from(DBSessions)
    .orderBy(DBSessions.startDateTime)
    .limit(1);
  return lastSession[0].startDateTime;
};

export const SeasonSelector = ({ value, onChange }: SeasonSelectorProps) => {
  const [seasons, setSeasons] = useState<Season[]>([]);

  useEffect(() => {
    const fetchSeasons = async () => {
      const firstSession = await getFirstRegisteredSessionDate();
      const lastSession = await getLastRegisteredSessionDate();

      const seasons = [];
      let currentYear = new Date(firstSession).getFullYear();

      while (currentYear <= new Date(lastSession).getFullYear()) {
        seasons.push(getSeasonDate(new Date(firstSession)));

        currentYear++;
      }

      setSeasons(seasons);
    };

    fetchSeasons().catch(console.error);
  }, []);

  return (
    <select
      value={value.startDate.toISOString()}
      onChange={(e) => onChange(getSeasonDate(new Date(e.target.value)))}
      className={cn("input")}
    >
      {seasons.map((season) => (
        <option
          key={season.startDate.toISOString()}
          value={season.startDate.toISOString()}
        >
          {season.startDate.getFullYear()} - {season.endDate.getFullYear()}
        </option>
      ))}
    </select>
  );
};
