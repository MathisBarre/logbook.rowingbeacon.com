import { ChevronUpIcon } from "lucide-react";
import { cn } from "../../../_common/utils/utils";

export const LevelVisualizer = ({
  levels,
  selectedLevelOrder,
  wrapperClassnames,
}: {
  levels: { order: number; label: string }[];
  selectedLevelOrder: number;
  wrapperClassnames?: string;
}) => {
  return (
    <ol
      className={cn("flex flex-wrap border-collapse mb-4", wrapperClassnames)}
    >
      {levels.map((level) => {
        const isSelected = level.order === selectedLevelOrder;

        return (
          <li
            key={level.order}
            className={cn(
              isSelected ? "bg-steel-blue-600 text-white" : "bg-gray-100",
              "first:rounded-l last:rounded-r flex items-center flex-col flex-1 text-center justify-center relative border border-gray-300 -mx-1 first:mx-0 last:mx-0"
            )}
          >
            <p className={cn("text-xs py-1")}>Niv {level.order}</p>
            <div
              className={cn(
                isSelected
                  ? "bg-gray-300 h-[1px] w-full"
                  : "bg-gray-300 h-[1px] w-full"
              )}
            />
            <p className="text-sm font-bold p-2">
              {level.label || <span>Aucun</span>}
            </p>

            {isSelected && (
              <div>
                <ChevronUpIcon className="text-steel-blue-600 absolute bottom-0 left-1/2 translate-y-full -translate-x-1/2"></ChevronUpIcon>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
};
