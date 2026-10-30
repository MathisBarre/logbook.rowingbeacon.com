/* eslint-disable react/display-name */
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlertIcon } from "lucide-react";
import { Boat } from "../../../_common/business/boat.rules";
import { useSearchInBoats } from "./BoatList.utils";
import {
  useSessionsStore,
  ZustandSession,
} from "../../../_common/store/sessions.store";
import { useAdminEditModeSystem } from "../../../_common/store/adminEditMode.system";
import { cn, forEnum } from "../../../_common/utils/utils";

import {
  formatDate,
  getTime,
  isToday,
  isTomorrow,
} from "../../../_common/utils/date.utils";
import { useStore } from "zustand";
import { boatLevelConfigStoreCore } from "../../../_common/store/boatLevelConfig.store";
import { SeriousnessCategoryEnum } from "../../../_common/business/seriousness.rules";
import { AGE_CATEGORIES } from "../../../_common/business/ageCategory.rules";
import { AgeCategoryEnum } from "../../../_common/business/ageCategory.rules";
import { useDamageStore } from "../../../_common/store/damage.store";
import { useModule } from "../../../_common/store/modules.store";
import { getOpenDamagesOfBoat } from "../../../_common/business/damage.rules";
import { BoatReservationBadge } from "./BoatReservationBadge";

interface BoatListContentProps {
  search: string;
  boats: Boat[];
  onBoatRowClick: (boat: Boat) => void;
}

export const BoatListContent = ({
  search,
  boats,
  onBoatRowClick,
}: BoatListContentProps) => {
  const {
    filteredOneRowerBoats,
    filteredTwoRowerBoats,
    filteredFourRowerBoats,
    filteredEightRowerBoats,
    filteredOtherBoats,
    filteredTypelessBoats,
    oneRowerBoatsLabel,
    twoRowerBoatsLabel,
    fourRowerBoatsLabel,
    eightRowerBoatsLabel,
    otherAndTypelessBoatsLabel,
  } = useSearchInBoats(boats, search);

  return (
    <div className="overflow-y-scroll overflow-x-hidden flex-1">
      <BoatSectionRow label="1x" subLabel={oneRowerBoatsLabel} />
      <BoatsRows
        onBoatRowClick={onBoatRowClick}
        boats={filteredOneRowerBoats}
      />
      <EmptyRow
        isEmpty={filteredOneRowerBoats.length === 0} //
        search={search}
      />

      <BoatSectionRow label="2x / 2-" subLabel={twoRowerBoatsLabel} />
      <BoatsRows
        onBoatRowClick={onBoatRowClick}
        boats={filteredTwoRowerBoats}
      />
      <EmptyRow
        isEmpty={filteredTwoRowerBoats.length === 0} //
        search={search}
      />

      <BoatSectionRow label="4x / 4- / 4+" subLabel={fourRowerBoatsLabel} />
      <BoatsRows
        onBoatRowClick={onBoatRowClick}
        boats={filteredFourRowerBoats}
      />
      <EmptyRow
        isEmpty={filteredFourRowerBoats.length === 0} //
        search={search}
      />

      <BoatSectionRow label="8x / 8+" subLabel={eightRowerBoatsLabel} />
      <BoatsRows
        onBoatRowClick={onBoatRowClick}
        boats={filteredEightRowerBoats}
      />
      <EmptyRow
        isEmpty={filteredEightRowerBoats.length === 0}
        search={search}
      />

      <BoatSectionRow
        label="boathouse.otherUnclassified"
        subLabel={otherAndTypelessBoatsLabel}
        translate
      />
      <BoatsRows
        onBoatRowClick={onBoatRowClick}
        boats={[...filteredOtherBoats, ...filteredTypelessBoats]}
      />
      <EmptyRow
        isEmpty={[...filteredOtherBoats, ...filteredTypelessBoats].length === 0}
        search={search}
      />
    </div>
  );
};

const BoatSectionRow = memo(
  ({
    label,
    subLabel: count,
    translate,
  }: {
    label: string;
    subLabel: string;
    translate?: boolean;
  }) => {
    const { t } = useTranslation();
    return (
      <div className="px-3 py-2 bg-gray-200 sticky z-10 top-0 inset-x-0 flex flex-row items-center font-mono tracking-tighter">
        <span>{translate ? t(label) : label}</span>
        <span className="flex-1" />
        <span className="text-xs opacity-50">{count}</span>
      </div>
    );
  }
);

const BoatsRows = memo(
  ({
    boats,
    onBoatRowClick,
  }: {
    boats: Boat[];
    onBoatRowClick: (boat: { id: string; name: string }) => void;
  }) => {
    return (
      <>
        {boats.map((boat) => {
          return (
            <BoatRow
              key={boat.id}
              boat={boat}
              onBoatRowClick={onBoatRowClick}
            />
          );
        })}
      </>
    );
  }
);

const BoatRow = ({
  boat,
  onBoatRowClick,
}: {
  boat: Boat;
  onBoatRowClick: (boat: { id: string; name: string }) => void;
}) => {
  const sessionsStore = useSessionsStore();
  const sessionRelated = getRelatedSession(
    sessionsStore.getOngoingSessions(),
    boat.id
  );

  const isBoatInSession = Boolean(sessionRelated);
  const isBoatUnusable = boat.isInMaintenance;

  const { isInAdminEditMode } = useAdminEditModeSystem();

  if (isBoatInSession) {
    return (
      <BoatInSessionRow
        boat={boat}
        sessionRelated={sessionRelated}
        onClick={onBoatRowClick}
      />
    );
  }

  if (isInAdminEditMode) {
    return <EditBoatRow boat={boat} />;
  }

  if (isBoatUnusable) {
    return <UnusuableBoatRow boat={boat} />;
  }

  return <BoatRowDefault boat={boat} onBoatRowClick={onBoatRowClick} />;
};

const BoatInSessionRow = memo(
  ({
    boat,
    sessionRelated,
    onClick,
  }: {
    boat: Boat;
    sessionRelated?: ZustandSession;
    onClick: (boat: Boat) => void;
  }) => {
    const { t } = useTranslation();
    return (
      <div
        key={boat.id}
        className={cn("px-2 py-1 hover:bg-gray-100 cursor-pointer")}
        onClick={() => onClick(boat)}
      >
        <div className="flex justify-between">
          <p className="font-mono font-medium text-gray-700 tracking-tighter">
            {boat.name}
          </p>
          <p className="text-xs text-gray-400">
            <>
              {sessionRelated?.route && (
                <>
                  {t("boathouse.direction")} {`"${sessionRelated?.route.name}"`}
                </>
              )}
              {sessionRelated?.route &&
                sessionRelated?.estimatedEndDateTime &&
                " - "}
              {sessionRelated?.estimatedEndDateTime && (
                <>
                  {t("boathouse.expectedReturn")}{" "}
                  {formatSimpleDate(sessionRelated.estimatedEndDateTime, t)}
                </>
              )}
            </>
          </p>
        </div>
        <p className="text-sm text-gray-400">
          {sessionRelated?.rowers.map((rower) => rower.name).join(", ")}
        </p>
      </div>
    );
  }
);

/** The open damages of a boat, most serious first; none without the module. */
const useOpenDamagesOfBoat = (boatId: string) => {
  const hasDamages = useModule("damages");
  const damages = useDamageStore((state) => state.damages);

  return useMemo(
    () => (hasDamages ? getOpenDamagesOfBoat(damages, boatId) : []),
    [hasDamages, damages, boatId]
  );
};

const UnusuableBoatRow = memo(({ boat }: { boat: Boat }) => {
  const { t } = useTranslation();
  const blockingDamage = useOpenDamagesOfBoat(boat.id).find(
    (damage) => damage.severity === "unusable" && damage.description.trim()
  );
  const reason =
    blockingDamage?.description.trim() ?? t("boathouse.outOfService");

  return (
    <div
      key={boat.id}
      title={reason}
      className={cn(
        "px-2 py-1 bg-error-50 cursor-not-allowed font-mono font-medium text-gray-700 tracking-tighter opacity-50 flex justify-between gap-4 overflow-hidden"
      )}
    >
      <span className="text-error-900 shrink-0">{boat.name}</span>
      <span className="text-xs font-sans font-normal text-error-900 truncate self-center">
        {reason}
      </span>
    </div>
  );
});

/** Open damages that do not block the boat: a small sign, details on hover. */
const BoatDamageIndicator = memo(({ boatId }: { boatId: string }) => {
  const { t } = useTranslation();
  const damages = useOpenDamagesOfBoat(boatId).filter(
    (damage) => damage.severity !== "unusable"
  );

  if (damages.length === 0) {
    return null;
  }

  const hasLimited = damages.some((damage) => damage.severity === "limited");
  const details = damages
    .map((damage) =>
      [t(`damages.severity.${damage.severity}`), damage.description.trim()]
        .filter(Boolean)
        .join(": ")
    )
    .join("\n");

  return (
    // Named for screen readers too: a title alone is read by none of them.
    <span
      title={details}
      role="img"
      aria-label={details}
      className="flex items-center"
    >
      <TriangleAlertIcon
        className={cn(
          "h-4 w-4",
          hasLimited ? "text-yellow-600" : "text-gray-400"
        )}
      />
    </span>
  );
});

const getSeriousnessLabel = (
  seriousnessCategory: SeriousnessCategoryEnum | null | undefined,
  t: (key: string) => string
) => {
  if (!seriousnessCategory) {
    return;
  }

  return forEnum(seriousnessCategory, {
    competitor: () => t("boathouse.competitionBoat"),
    recreational: () => t("boathouse.recreationalBoat"),
  });
};

const getLevelConfigFromTo = (
  minimalLevelConfig: AgeCategoryEnum | null | undefined,
  t: (key: string, params?: Record<string, unknown>) => string
) => {
  if (!minimalLevelConfig) {
    return null;
  }

  const lastRowerCategory = AGE_CATEGORIES.reduce((acc, curr) => {
    return curr.order > acc.order ? curr : acc;
  }).category;

  if (minimalLevelConfig === lastRowerCategory) {
    return minimalLevelConfig;
  }

  return t("boathouse.fromLevel", { level: minimalLevelConfig });
};

const BoatRowDefault = memo(
  ({
    boat,
    onBoatRowClick,
  }: {
    boat: Boat;
    onBoatRowClick: (boat: Boat) => void;
  }) => {
    const { t } = useTranslation();
    const hasReservations = useModule("reservations");
    const boatLevelConfigStore = useStore(boatLevelConfigStoreCore);
    const boatLevelConfig = boatLevelConfigStore.getBoatLevelConfig(boat.id);

    const boatTypeFromTo = getSeriousnessLabel(
      boatLevelConfig?.minimalRowerType,
      t
    );
    const boatLevelConfigFromTo = getLevelConfigFromTo(
      boatLevelConfig?.minimalRowerCategory,
      t
    );

    return (
      <div key={boat.id} className="flex">
        <div
          className="px-2 py-1 hover:bg-gray-100 cursor-pointer font-mono font-medium text-gray-700 tracking-tighter select-none flex-1 flex justify-between"
          onClick={() => onBoatRowClick(boat)}
        >
          <span className="select-none">{boat.name}</span>

          <div className="flex gap-1 items-center">
            {hasReservations && <BoatReservationBadge boatId={boat.id} />}

            <BoatDamageIndicator boatId={boat.id} />
            {boatTypeFromTo && (
              <p className="bg-steel-blue-50 border border-steel-blue-200 inline-block px-2 py-1 rounded-full text-xs">
                {boatTypeFromTo}
              </p>
            )}

            {boatLevelConfigFromTo && (
              <p className="bg-steel-blue-50 border border-steel-blue-200 inline-block px-2 py-1 rounded-full text-xs">
                {boatLevelConfigFromTo}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
);

const EditBoatRow = memo(({ boat }: { boat: Boat }) => {
  return (
    <div
      key={boat.id}
      className={cn(
        "flex group hover:bg-gray-100",
        boat.isInMaintenance && "bg-error-50"
      )}
    >
      <div className="px-2 py-1 font-mono tracking-tighter select-none flex-1">
        <span className={cn(boat.isInMaintenance && "text-error-900")}>
          {boat.name}
        </span>
      </div>
    </div>
  );
});

const EmptyRow = memo(
  ({ isEmpty, search }: { isEmpty: boolean; search: string }) => {
    const { t } = useTranslation();
    return isEmpty ? (
      <div className="px-3 py-2 text-gray-300">
        {search
          ? t("boathouse.noBoatsForSearch", { search })
          : t("boathouse.noBoatsToDisplay")}
      </div>
    ) : null;
  }
);

const getRelatedSession = (
  ongoingSessions: ZustandSession[],
  boatId: string
) => {
  return ongoingSessions.find((session) => session.boat.id === boatId);
};

const formatSimpleDate = (
  date: string,
  t: (key: string, params?: Record<string, unknown>) => string
) => {
  if (isToday(date)) {
    return t("boathouse.at", { time: getTime(date) });
  }

  if (isTomorrow(date)) {
    return t("boathouse.tomorrowAt", { time: getTime(date) });
  }

  return t("boathouse.onDate", { date: formatDate(date) });
};
