import { getSeasonDate, Season } from "../../_common/utils/seasons";
import { cn } from "../../_common/utils/utils";
import { useMemo } from "react";
interface SeasonSelectorProps {
  value: Season;
  onChange: (date: Season) => void;
  firstDataAt: Date;
  lastDataAt: Date;
  disabled?: boolean;
  className?: string;
}

export const SeasonSelector = ({
  value,
  onChange,
  firstDataAt,
  lastDataAt,
  disabled,
  className,
}: SeasonSelectorProps) => {
  const seasons = useMemo(
    () => getSeasons(firstDataAt, lastDataAt),
    [firstDataAt, lastDataAt]
  );

  return (
    <select
      disabled={disabled}
      value={value.startDate.toISOString()}
      onChange={(e) => onChange(getSeasonDate(new Date(e.target.value)))}
      className={cn(
        "input",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {seasons.map((season) => (
        <option
          key={season.startDate.toISOString()}
          value={season.startDate.toISOString()}
        >
          Saison {season.startDate.getFullYear()} -{" "}
          {season.endDate.getFullYear()}
        </option>
      ))}
    </select>
  );
};

const getSeasons = (firstDataAt: Date, lastDataAt: Date) => {
  const seasons = [];
  const iDate = new Date(firstDataAt);

  while (iDate <= new Date(lastDataAt)) {
    seasons.push(getSeasonDate(iDate));
    iDate.setFullYear(iDate.getFullYear() + 1);
  }

  return seasons;
};
