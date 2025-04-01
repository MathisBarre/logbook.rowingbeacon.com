import { cn } from "../../_common/utils/utils";
import { getDatabase } from "../../_common/database/database";
import { DBSessions } from "../../_common/database/schema";
import { useEffect, useState } from "react";
import { asc, desc } from "drizzle-orm";

interface MonthSelectorProps {
  value: Date;
  onChange: (date: Date) => void;
}

const getFirstSession = async () => {
  const { drizzle } = await getDatabase();
  const query = drizzle.select().from(DBSessions);

  const firstSession = await query
    .orderBy(asc(DBSessions.startDateTime))
    .limit(1);
  return firstSession[0]?.startDateTime;
};

const getLastSession = async () => {
  const { drizzle } = await getDatabase();
  const query = drizzle.select().from(DBSessions);

  const lastSession = await query
    .orderBy(desc(DBSessions.startDateTime))
    .limit(1);
  return lastSession[0]?.startDateTime;
};

export const MonthSelector = ({ value, onChange }: MonthSelectorProps) => {
  const [months, setMonths] = useState<Date[]>([]);

  useEffect(() => {
    const fetchMonths = async () => {
      const firstSession = await getFirstSession();
      const lastSession = await getLastSession();

      if (!firstSession || !lastSession) {
        setMonths([]);
        return;
      }

      const months = [];
      const iDate = new Date(firstSession);
      iDate.setDate(1); // Start from the first day of the month

      while (iDate <= new Date(lastSession)) {
        months.push(new Date(iDate));
        iDate.setMonth(iDate.getMonth() + 1);
      }

      setMonths(months);
    };

    fetchMonths().catch(console.error);
  }, []);

  const formatMonth = (date: Date) => {
    return date.toLocaleString("fr-FR", { month: "long", year: "numeric" });
  };

  return (
    <select
      value={value.toISOString()}
      onChange={(e) => onChange(new Date(e.target.value))}
      className={cn("input")}
    >
      {months.map((month) => (
        <option key={month.toISOString()} value={month.toISOString()}>
          {formatMonth(month)}
        </option>
      ))}
    </select>
  );
};
