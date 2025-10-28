import { ChartBarIcon } from "@heroicons/react/16/solid";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="flex items-center justify-center hover:bg-gray-100 min-h-12 h-full w-12 min-w-12">
          <ChartBarIcon className="h-4 w-4 cursor-pointer text-steel-blue-800" />
        </button>
      </DialogTrigger>
      <DialogContent title={t("stats.aboutBoat", { boatName })}>
        <BoatStats boatId={boatId} />
      </DialogContent>
    </Dialog>
  );
};
