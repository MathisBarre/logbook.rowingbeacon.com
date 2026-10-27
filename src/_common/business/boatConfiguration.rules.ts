import { BoatTypeEnum } from "./boat.rules";

/**
 * ----- Typing -----
 */

export type Rigging = "scull" | "sweep";

/**
 * One way of rigging a boat (4x, 4-, 4x+…). `seats` counts rowing seats
 * only; the cox is added when `coxed` is true.
 */
export interface BoatConfiguration {
  id: string;
  seats: number | null;
  rigging: Rigging | null;
  coxed: boolean;
  hullType?: string | null;
  isDefault: boolean;
  position: number;
}

/**
 * ----- Business rules -----
 */

export const getDefaultConfiguration = <
  T extends Pick<BoatConfiguration, "isDefault" | "position">,
>(
  configurations: T[]
): T | undefined => {
  return (
    configurations.find((configuration) => configuration.isDefault) ||
    [...configurations].sort((a, b) => a.position - b.position)[0]
  );
};

/**
 * Exactly one configuration is the default: the first one flagged, or
 * the first by position when none is.
 */
export const withSingleDefault = <
  T extends Pick<BoatConfiguration, "id" | "isDefault" | "position">,
>(
  configurations: T[]
): T[] => {
  const defaultId = getDefaultConfiguration(configurations)?.id;
  return configurations.map((configuration) => ({
    ...configuration,
    isDefault: configuration.id === defaultId,
  }));
};

/**
 * Configuration matching a v1 boat type. v1 merged scull and sweep
 * ("2x / 2-"), so the rigging stays unknown except where it is implied.
 */
export const getConfigurationFromLegacyType = (
  type: BoatTypeEnum | undefined
): Pick<BoatConfiguration, "seats" | "rigging" | "coxed"> => {
  switch (type) {
    case BoatTypeEnum.ONE_ROWER_COXLESS:
      return { seats: 1, rigging: "scull", coxed: false };
    case BoatTypeEnum.TWO_ROWERS_COXLESS:
      return { seats: 2, rigging: null, coxed: false };
    case BoatTypeEnum.TWO_ROWERS_COXED:
      return { seats: 2, rigging: "sweep", coxed: true };
    case BoatTypeEnum.FOUR_ROWERS_COXLESS:
      return { seats: 4, rigging: null, coxed: false };
    case BoatTypeEnum.FOUR_ROWERS_COXED:
      return { seats: 4, rigging: null, coxed: true };
    case BoatTypeEnum.EIGHT_ROWERS_COXED:
      return { seats: 8, rigging: null, coxed: true };
    default:
      return { seats: null, rigging: null, coxed: false };
  }
};

/**
 * Boat class used by the level system, sorting and grouping.
 */
export const getLegacyTypeFromConfiguration = (
  configuration: Pick<BoatConfiguration, "seats" | "coxed"> | undefined
): BoatTypeEnum => {
  if (!configuration || configuration.seats === null) {
    return BoatTypeEnum.OTHER;
  }

  const { seats, coxed } = configuration;

  if (seats === 1 && !coxed) return BoatTypeEnum.ONE_ROWER_COXLESS;
  if (seats === 2) {
    return coxed
      ? BoatTypeEnum.TWO_ROWERS_COXED
      : BoatTypeEnum.TWO_ROWERS_COXLESS;
  }
  if (seats === 4) {
    return coxed
      ? BoatTypeEnum.FOUR_ROWERS_COXED
      : BoatTypeEnum.FOUR_ROWERS_COXLESS;
  }
  if (seats === 8) return BoatTypeEnum.EIGHT_ROWERS_COXED;

  return BoatTypeEnum.OTHER;
};

/**
 * Short rowing notation: 1x, 2-, 4x+, 8+… Unknown rigging gives "4" / "4+".
 */
export const getConfigurationCode = (
  configuration: Pick<BoatConfiguration, "seats" | "rigging" | "coxed">
): string | null => {
  if (configuration.seats === null) {
    return null;
  }

  const rigging =
    configuration.rigging === "scull"
      ? "x"
      : configuration.rigging === "sweep" && !configuration.coxed
        ? "-"
        : "";

  return `${configuration.seats}${rigging}${configuration.coxed ? "+" : ""}`;
};

/**
 * Number of people in the crew, cox included.
 */
export const getCrewSize = (
  configuration: Pick<BoatConfiguration, "seats" | "coxed"> | undefined
): number | undefined => {
  if (!configuration || configuration.seats === null) {
    return undefined;
  }

  return configuration.seats + (configuration.coxed ? 1 : 0);
};

export const MAX_SEATS = 24;

export type ConfigurationError =
  | "invalidSeats"
  | "sweepNeedsEvenSeats"
  | "duplicateConfiguration";

/**
 * What is wrong with a configuration of the list, if anything. Seats are a
 * whole number from 1 to 24, even when rowed sweep. They may stay unknown
 * only on a configuration that was saved that way (v1 boat of type
 * "other"), when `saved` is given.
 */
export const getConfigurationError = (
  configuration: Pick<BoatConfiguration, "id" | "seats" | "rigging" | "coxed">,
  configurations: Pick<BoatConfiguration, "id" | "seats" | "rigging" | "coxed">[],
  saved?: Pick<BoatConfiguration, "id" | "seats">[]
): ConfigurationError | null => {
  const { seats } = configuration;

  const unknownSeatsAllowed =
    saved === undefined ||
    saved.some((s) => s.id === configuration.id && s.seats === null);
  const isValidSeats =
    seats === null
      ? unknownSeatsAllowed
      : Number.isInteger(seats) && seats >= 1 && seats <= MAX_SEATS;
  if (!isValidSeats) {
    return "invalidSeats";
  }

  if (configuration.rigging === "sweep" && seats !== null && seats % 2 !== 0) {
    return "sweepNeedsEvenSeats";
  }

  const sameAsEarlier = configurations
    .slice(
      0,
      configurations.findIndex((other) => other.id === configuration.id)
    )
    .some(
      (other) =>
        other.seats === seats &&
        other.rigging === configuration.rigging &&
        other.coxed === configuration.coxed
    );

  return sameAsEarlier ? "duplicateConfiguration" : null;
};

/**
 * A configuration whose rigging changed is a new configuration: past
 * outings keep the one they were rowed with (ADR 0001).
 */
export const renewChangedConfigurations = <T extends BoatConfiguration>(
  configurations: T[],
  saved: BoatConfiguration[],
  generateId: () => string
): T[] =>
  configurations.map((configuration) => {
    const before = saved.find((s) => s.id === configuration.id);
    const changed =
      before !== undefined &&
      (before.seats !== configuration.seats ||
        before.rigging !== configuration.rigging ||
        before.coxed !== configuration.coxed ||
        (before.hullType ?? null) !== (configuration.hullType ?? null));
    return changed ? { ...configuration, id: generateId() } : configuration;
  });
