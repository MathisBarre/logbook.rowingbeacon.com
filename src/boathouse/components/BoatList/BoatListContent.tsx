/* eslint-disable react/display-name */
import { memo } from "react";
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
    otherBoatsLabel,
    typelessBoatsLabel,
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
        label="Autre / Non classé"
        subLabel={`${Number(otherBoatsLabel) + Number(typelessBoatsLabel)}`}
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
  ({ label, subLabel: count }: { label: string; subLabel: string }) => {
    return (
      <div className="px-3 py-2 bg-gray-200 sticky z-10 top-0 inset-x-0 flex flex-row items-center font-mono tracking-tighter">
        <span>{label}</span>
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
                <>Direction {`"${sessionRelated?.route.name}"`}</>
              )}
              {sessionRelated?.route &&
                sessionRelated?.estimatedEndDateTime &&
                " - "}
              {sessionRelated?.estimatedEndDateTime && (
                <>
                  Retour prévu{" "}
                  {formatSimpleDate(sessionRelated.estimatedEndDateTime)}
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

const UnusuableBoatRow = memo(({ boat }: { boat: Boat }) => {
  return (
    <div
      key={boat.id}
      className={cn(
        "px-2 py-1 bg-error-50 cursor-not-allowed font-mono font-medium text-gray-700 tracking-tighter opacity-50 flex justify-between overflow-hidden"
      )}
    >
      <span className="text-error-900">{boat.name}</span>
    </div>
  );
});

const getSeriousnessLabel = (
  seriousnessCategory: SeriousnessCategoryEnum | null | undefined
) => {
  if (!seriousnessCategory) {
    return;
  }

  return forEnum(seriousnessCategory, {
    competitor: () => "Bateau de compétition",
    recreational: () => "Bateau loisir",
  });
};

const getLevelConfigFromTo = (
  minimalLevelConfig: AgeCategoryEnum | null | undefined
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

  return `À partir de ${minimalLevelConfig}`;
};

const BoatRowDefault = memo(
  ({
    boat,
    onBoatRowClick,
  }: {
    boat: Boat;
    onBoatRowClick: (boat: Boat) => void;
  }) => {
    const boatLevelConfigStore = useStore(boatLevelConfigStoreCore);
    const boatLevelConfig = boatLevelConfigStore.getBoatLevelConfig(boat.id);

    const boatTypeFromTo = getSeriousnessLabel(
      boatLevelConfig?.minimalRowerType
    );
    const boatLevelConfigFromTo = getLevelConfigFromTo(
      boatLevelConfig?.minimalRowerCategory
    );

    return (
      <div key={boat.id} className="flex">
        <div
          className="px-2 py-1 hover:bg-gray-100 cursor-pointer font-mono font-medium text-gray-700 tracking-tighter select-none flex-1 flex justify-between"
          onClick={() => onBoatRowClick(boat)}
        >
          <span className="select-none">{boat.name}</span>

          <div className="flex gap-1 items-center">
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
    return isEmpty ? (
      <div className="px-3 py-2 text-gray-300">
        {search
          ? `Aucun bateau à afficher pour la recherche "${search}"`
          : "Aucun bateau à afficher"}
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

const formatSimpleDate = (date: string) => {
  if (isToday(date)) {
    return "à " + getTime(date);
  }

  if (isTomorrow(date)) {
    return "demain à " + getTime(date);
  }

  return "le " + formatDate(date);
};
