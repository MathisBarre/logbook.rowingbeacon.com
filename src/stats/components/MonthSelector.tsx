import { cn } from "../../_common/utils/utils";
import { useMemo } from "react";

interface MonthOption {
  value: number | null;
  label: string;
}

interface MonthSelectorProps {
  value: number | null; // null represents "All Months"
  onChange: (month: number | null) => void;
  startDate: Date;
  endDate: Date;
  disabled?: boolean;
  className?: string;
}

export const MonthSelector = ({
  value,
  onChange,
  startDate,
  endDate,
  disabled,
  className,
}: MonthSelectorProps) => {
  const months = useMemo<MonthOption[]>(() => {
    const availableMonths: MonthOption[] = [];
    const iDate = new Date(startDate);

    // Add "All Months" option
    availableMonths.push({ value: null, label: "Tous les mois" });

    // Add months within the date range
    while (iDate <= endDate) {
      const month = iDate.getMonth();
      const monthLabel = iDate.toLocaleString("fr-FR", { month: "long" });

      // Only add the month if it's not already in the list
      if (!availableMonths.some((m) => m.value === month)) {
        availableMonths.push({ value: month, label: monthLabel });
      }

      iDate.setMonth(iDate.getMonth() + 1);
    }

    return availableMonths;
  }, [startDate, endDate]);

  return (
    <select
      disabled={disabled}
      value={value === null ? "" : value.toString()}
      onChange={(e) => {
        const selectedValue =
          e.target.value === "" ? null : parseInt(e.target.value);
        onChange(selectedValue);
      }}
      className={cn(
        "input",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {months.map((month) => (
        <option
          key={month.value === null ? "all" : month.value}
          value={month.value === null ? "" : month.value.toString()}
        >
          {month.label}
        </option>
      ))}
    </select>
  );
};
