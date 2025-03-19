import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import type { DateRange } from "../utils/date.utils";
import { cn } from "../utils/utils";
import Button from "./Button";

export type DatePreset = {
  id: string;
  label: string;
  dateRange: DateRange | (() => DateRange);
};

interface DateRangePickerProps {
  date: DateRange;
  onDateChange: (date: DateRange) => void;
  presets?: DatePreset[];
  className?: string;
  align?: "start" | "center" | "end";
}

interface CalendarDate {
  from: Date | undefined;
  to: Date | undefined;
}

interface CalendarProps {
  mode: "range";
  selected: CalendarDate;
  onSelect: (date: CalendarDate | undefined) => void;
  numberOfMonths?: number;
  defaultMonth?: Date;
  className?: string;
}

const Calendar: React.FC<CalendarProps> = ({
  selected,
  onSelect,
  className,
}) => {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = React.useState(today.getMonth());
  const [currentYear, setCurrentYear] = React.useState(today.getFullYear());

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

  const handleDateClick = (day: number) => {
    const clickedDate = new Date(currentYear, currentMonth, day);

    if (!selected.from || (selected.from && selected.to)) {
      onSelect({ from: clickedDate, to: undefined });
    } else {
      if (clickedDate < selected.from) {
        onSelect({ from: clickedDate, to: selected.from });
      } else {
        onSelect({ from: selected.from, to: clickedDate });
      }
    }
  };

  const isSelected = (day: number) => {
    const date = new Date(currentYear, currentMonth, day);
    if (!selected.from) return false;
    if (!selected.to) return date.getTime() === selected.from.getTime();
    return date >= selected.from && date <= selected.to;
  };

  const isToday = (day: number) => {
    const date = new Date(currentYear, currentMonth, day);
    return date.toDateString() === today.toDateString();
  };

  return (
    <div className={cn("p-3", className)}>
      <div className="flex justify-between mb-4">
        <Button
          type="button"
          variant="outlined"
          onClick={() => {
            if (currentMonth === 0) {
              setCurrentMonth(11);
              setCurrentYear(currentYear - 1);
            } else {
              setCurrentMonth(currentMonth - 1);
            }
          }}
        >
          ←
        </Button>
        <div>
          {new Date(currentYear, currentMonth).toLocaleString("default", {
            month: "long",
            year: "numeric",
          })}
        </div>
        <Button
          type="button"
          variant="outlined"
          onClick={() => {
            if (currentMonth === 11) {
              setCurrentMonth(0);
              setCurrentYear(currentYear + 1);
            } else {
              setCurrentMonth(currentMonth + 1);
            }
          }}
        >
          →
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm mb-2">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="text-muted-foreground">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDayOfMonth }).map((_, index) => (
          <div key={`empty-${index}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, index) => {
          const day = index + 1;
          return (
            <Button
              key={day}
              type="button"
              variant={isSelected(day) ? "primary" : "outlined"}
              className={cn(
                "h-8 w-8 p-0 font-normal",
                isToday(day) && "border border-primary",
                isSelected(day) &&
                  "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
              onClick={() => handleDateClick(day)}
            >
              {day}
            </Button>
          );
        })}
      </div>
    </div>
  );
};

export function DateRangePicker({
  date,
  onDateChange,
  presets,
  className,
  align = "start",
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const selectedPreset = React.useMemo(() => {
    if (!presets) return undefined;

    return presets.find((preset) => {
      const presetRange =
        typeof preset.dateRange === "function"
          ? preset.dateRange()
          : preset.dateRange;
      return (
        presetRange.from?.getTime() === date.from?.getTime() &&
        presetRange.to?.getTime() === date.to?.getTime()
      );
    });
  }, [date, presets]);

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger asChild>
          <Button
            type="button"
            variant="outlined"
            className={cn(
              "w-full justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {date.from.toLocaleDateString()} -{" "}
                  {date.to.toLocaleDateString()}
                </>
              ) : (
                date.from.toLocaleDateString()
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="w-auto rounded-md border bg-popover p-0 text-popover-foreground shadow-md"
            align={align}
          >
            <div className="space-y-2 p-2">
              {presets && (
                <Select.Root
                  value={selectedPreset?.id}
                  onValueChange={(value) => {
                    const preset = presets.find((p) => p.id === value);
                    if (preset) {
                      const dateRange =
                        typeof preset.dateRange === "function"
                          ? preset.dateRange()
                          : preset.dateRange;
                      onDateChange(dateRange);
                    }
                  }}
                >
                  <Select.Trigger className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <Select.Value placeholder="Select preset..." />
                    <Select.Icon>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content
                      position="popper"
                      className="w-full rounded-md border bg-popover p-0 text-popover-foreground shadow-md"
                    >
                      <Select.Viewport className="p-1">
                        {presets.map((preset) => (
                          <Select.Item
                            key={preset.id}
                            value={preset.id}
                            className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                          >
                            <Select.ItemText>{preset.label}</Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              )}
              <div className="border rounded-md">
                <Calendar
                  mode="range"
                  selected={{ from: date.from, to: date.to }}
                  onSelect={(range) => {
                    if (range?.from) {
                      onDateChange({
                        from: range.from,
                        to: range.to,
                      });
                    }
                  }}
                  numberOfMonths={2}
                  defaultMonth={date?.from}
                />
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
