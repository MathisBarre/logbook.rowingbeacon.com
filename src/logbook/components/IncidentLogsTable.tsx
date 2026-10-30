import { useState } from "react";
import { ChatBubbleLeftIcon } from "@heroicons/react/16/solid";
import { useTranslation } from "react-i18next";
import useIncidentStore from "../../_common/store/incident.store";
import { getTime, getDateOnly } from "../../_common/utils/date.utils";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { useModule } from "../../_common/store/modules.store";
import { useDamageStore } from "../../_common/store/damage.store";
import { ClubIncident } from "../../_common/database/repositories/club.types";
import {
  getDamageDefaultsFromIncident,
  getIncidentsWithoutDamage,
} from "../../_common/business/damageLog.rules";
import Button from "../../_common/components/Button";
import { ReportDamageDialog } from "../../_common/components/damages/ReportDamageDialog";
import i18n from "../../_common/i18n/config";

/** The text an incident without details was saved with, in every language. */
const getNoDetailsTexts = () =>
  new Set(
    Object.keys(i18n.options.resources ?? {}).map((language) =>
      i18n.t("session.noIncidentDetails", { lng: language })
    )
  );

export function IncidentLogsTable() {
  const { t } = useTranslation();
  const incidents = useIncidentStore((state) => state.getIncidents());

  const clubOverview = useClubOverviewStore();
  const hasDamages = useModule("damages");
  const damages = useDamageStore((state) => state.damages);
  const [fromIncident, setFromIncident] = useState<ClubIncident | null>(null);
  const withoutDamage = new Set(
    hasDamages
      ? getIncidentsWithoutDamage(incidents, damages).map(({ id }) => id)
      : []
  );

  return (
    <div className="overflow-auto pb-32">
      {incidents.length === 0 && (
        <p className="text-center py-16">{t("logbook.noIncidents")}</p>
      )}

      {incidents.map((incident) => {
        return (
          <div
            key={incident.id}
            className="flex even:bg-gray-100 py-6 px-12 items-center relative"
          >
            <div className="mr-12 font-mono tracking-tighter">
              <FormattedDate datetime={incident.datetime} />
            </div>

            <div className="flex-1">
              <p className="flex mb-2 font-mono tracking-tighter">
                <span>
                  {clubOverview.getBoatById(incident.boatId)?.name ||
                    "NAME_NOT_FOUND"}
                </span>
              </p>
              <div className="text-sm text-gray-400 mt-1">
                <ChatBubbleLeftIcon className="h-4 w-4 align-text-bottom inline mr-1 text-gray-400" />{" "}
                {incident.message || t("logbook.noMessage")}
              </div>
            </div>

            {withoutDamage.has(incident.id) && (
              <Button
                type="button"
                variant="outlined"
                className="text-sm py-1 ml-4"
                onClick={() => setFromIncident(incident)}
              >
                {t("damages.report")}
              </Button>
            )}
          </div>
        );
      })}

      {hasDamages && (
        <ReportDamageDialog
          open={fromIncident !== null}
          onOpenChange={(open) => !open && setFromIncident(null)}
          // The damage is linked to the incident's outing: keep its boat.
          lockBoat
          defaults={
            fromIncident
              ? getDamageDefaultsFromIncident(fromIncident, getNoDetailsTexts())
              : undefined
          }
        />
      )}
    </div>
  );
}

const FormattedDate = ({ datetime }: { datetime: string }) => {
  const date = new Date(datetime);

  return (
    <div className="flex justify-center flex-col items-end text-sm gap-1">
      <p>{getDateOnly(date)}</p>
      <p>{getTime(date)}</p>
    </div>
  );
};
