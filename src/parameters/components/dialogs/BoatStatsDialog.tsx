import { ChartBarIcon } from "@heroicons/react/16/solid";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "../../../_common/components/Dialog/Dialog";
import { BoatStats } from "../BoatStats";

interface BoatStatsDialogProps {
  boatId: string;
  boatName: string;
}

export const BoatStatsDialog = ({ boatId, boatName }: BoatStatsDialogProps) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="flex items-center justify-center hover:bg-gray-100 h-12 w-12">
          <ChartBarIcon className="h-4 w-4 cursor-pointer text-steel-blue-800" />
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-w-[32rem]"
        title={`Informations à propos de ${boatName}`}
      >
        <BoatStats boatId={boatId} />
      </DialogContent>
    </Dialog>
  );
};
