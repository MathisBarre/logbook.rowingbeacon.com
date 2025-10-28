import { ChartBarIcon } from "@heroicons/react/16/solid";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "../../../_common/components/Dialog/Dialog";
import Button from "../../../_common/components/Button";
import { BoatStatsComparisons } from "../BoatStatsComparisons";

export const BoatStatsComparisonsDialog = () => {
  const { t } = useTranslation();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button">
          <div className="flex gap-2 items-center ">
            <ChartBarIcon className="h-4 w-4" />
            {t("parameters.boatStatistics")}
          </div>
        </Button>
      </DialogTrigger>
      <DialogContent
        title={t("parameters.boatStatistics")}
        className="overflow-auto"
      >
        <BoatStatsComparisons />
      </DialogContent>
    </Dialog>
  );
};
