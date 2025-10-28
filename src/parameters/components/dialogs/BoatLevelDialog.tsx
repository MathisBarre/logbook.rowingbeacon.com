import { ShieldIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "../../../_common/components/Dialog/Dialog";
import { BoatLevelSystem } from "../BoatLevelSystem";

interface BoatLevelDialogProps {
  boatId: string;
  boatName: string;
}

export const BoatLevelDialog = ({ boatId, boatName }: BoatLevelDialogProps) => {
  const { t } = useTranslation();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="flex items-center justify-center hover:bg-gray-100 min-h-12 h-full w-12 min-w-12">
          <ShieldIcon className="h-4 w-4 cursor-pointer text-steel-blue-800" />
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-w-[40rem]"
        title={t("parameters.boatLevelManagement", { boatName })}
      >
        <BoatLevelSystem boatId={boatId} />
      </DialogContent>
    </Dialog>
  );
};
