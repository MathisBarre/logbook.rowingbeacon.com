import { memo } from "react";
import { Boat, BoatTypeEnum } from "../../../_common/types/boat.type";
import { useSearchInBoats } from "./BoatList.utils";
import {
  useSessionsStore,
  ZustandSession,
} from "../../../_common/store/sessions.store";
import { useAdminEditModeSystem } from "../../../_common/store/adminEditMode.system";
import { cn } from "../../../_common/utils/utils";

import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { ArrowsUpDownIcon } from "@heroicons/react/20/solid";
import {
  formatDate,
  getTime,
  isToday,
  isTomorrow,
} from "../../../_common/utils/date.utils";
import {
  ConstructionIcon,
  DeleteIcon,
  PencilIcon,
  TypeIcon,
} from "lucide-react";
import {
  windowPrompt,
  windowConfirm,
} from "../../../_common/utils/window.utils";

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
          <p className="font-mono tracking-tighter">{boat.name}</p>
          <p className="text-xs text-gray-400">
            Direction{" "}
            {sessionRelated?.route && (
              <span className="">
                {`"${sessionRelated?.route.name}"`} - Retour prévu{" "}
                {formatSimpleDate(sessionRelated.estimatedEndDateTime)}
              </span>
            )}
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
        "px-2 py-1 bg-error-50 cursor-not-allowed font-mono tracking-tighter opacity-50 flex justify-between overflow-hidden"
      )}
    >
      <span className="text-error-900">{boat.name}</span>
    </div>
  );
});

const BoatRowDefault = memo(
  ({
    boat,
    onBoatRowClick,
  }: {
    boat: Boat;
    onBoatRowClick: (boat: Boat) => void;
  }) => {
    return (
      <div key={boat.id} className="flex">
        <div
          className="px-2 py-1 hover:bg-gray-100 cursor-pointer font-mono tracking-tighter select-none flex-1"
          onClick={() => onBoatRowClick(boat)}
        >
          <span className="select-none">{boat.name}</span>
        </div>
      </div>
    );
  }
);

const EditBoatRow = memo(({ boat }: { boat: Boat }) => {
  const {
    updateBoatType,
    updateBoatName,
    toggleBoatIsInMaintenance,
    deleteBoat,
  } = useClubOverviewStore();

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

      <EditButton
        onClick={async () => {
          const newBoatName = await windowPrompt(
            "Nouveau nom du bateau",
            boat.name
          );

          if (newBoatName) {
            updateBoatName(boat.id, newBoatName);
          }
        }}
        description="Changer le nom du bateau"
        className="rounded-l"
      >
        <PencilIcon className="h-4 w-4" /> <TypeIcon className="h-4 w-4" />
      </EditButton>
      <EditButton
        onClick={() => {
          toggleBoatIsInMaintenance(boat.id);
        }}
        description="Basculer l'état de maintenance"
      >
        <ConstructionIcon className="h-4 w-4" />
      </EditButton>
      <EditButton
        onClick={() => {
          updateBoatType(boat.id, BoatTypeEnum.ONE_ROWER_COXLESS);
        }}
        description="Type -> 1x"
      >
        <ArrowsUpDownIcon className="h-4 w-4" /> 1
      </EditButton>
      <EditButton
        onClick={() => {
          updateBoatType(boat.id, BoatTypeEnum.TWO_ROWERS_COXLESS);
        }}
        description="Type -> 2x / 2-"
      >
        <ArrowsUpDownIcon className="h-4 w-4" /> 2
      </EditButton>
      <EditButton
        onClick={() => {
          updateBoatType(boat.id, BoatTypeEnum.FOUR_ROWERS_COXLESS);
        }}
        description="Type -> 4x / 4- / 4+"
      >
        <ArrowsUpDownIcon className="h-4 w-4" /> 4
      </EditButton>
      <EditButton
        onClick={() => {
          updateBoatType(boat.id, BoatTypeEnum.EIGHT_ROWERS_COXED);
        }}
        description="Type -> 8x / 8+"
      >
        <ArrowsUpDownIcon className="h-4 w-4" /> 8
      </EditButton>
      <EditButton
        onClick={() => {
          updateBoatType(boat.id, BoatTypeEnum.OTHER);
        }}
        description="Type -> Autre"
        className=""
      >
        <ArrowsUpDownIcon className="h-4 w-4" /> X
      </EditButton>
      <EditButton
        variant="danger"
        onClick={async () => {
          if (
            await windowConfirm(
              `Voulez-vous vraiment supprimer définitivement le bateau "${boat.name}" ? Il ne sera plus possible de renseigner des sorties avec ce bateau mais les sorties déjà effectuées resteront enregistrées.`
            )
          ) {
            deleteBoat(boat.id);
          }
        }}
        description="Supprimer"
        className=" rounded-r mr-6"
      >
        <DeleteIcon className="h-4 w-4" />
      </EditButton>
    </div>
  );
});

const EditButton = ({
  children,
  onClick,
  description,
  className,
  variant = "normal",
}: {
  children: React.ReactNode;
  onClick: () => void;
  description: string;
  className?: string;
  variant?: "normal" | "danger";
}) => {
  return (
    <button
      className={cn(
        "hidden parent group-hover:flex items-center relative group/foo px-5",
        variant === "normal" &&
          "bg-blue-100 text-blue-400 hover:bg-blue-200 hover:text-blue-600 ",
        variant === "danger" &&
          "bg-error-100 text-error-400 hover:bg-error-200 hover:text-error-600 ",
        className
      )}
      onClick={onClick}
    >
      {children}

      <div className="absolute top-0 bottom-0 z-40 text-center left-1/2 transform -translate-x-1/2 translate-y-full hidden group-hover/foo:flex justify-center items-center">
        <div
          className="bg-white rounded px-2
        text-nowrap whitespace-nowrap border"
        >
          {description}
        </div>
      </div>
    </button>
  );
};

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
