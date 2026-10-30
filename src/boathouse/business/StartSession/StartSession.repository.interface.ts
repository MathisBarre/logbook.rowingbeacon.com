import { Boat } from "../../../_common/business/boat.rules";
import { BoatConfiguration } from "../../../_common/business/boatConfiguration.rules";
import { Route } from "../../../_common/business/route.rules";
import { Rower } from "../../../_common/business/rower.rules";
import { StartedSession } from "./StartSession.rules";

export type StartSessionBoat = Boat & {
  configurations?: BoatConfiguration[];
};

export interface SaveSessionPayload {
  boat: Boat;
  route: Route | null;
  rowers: (Rower & { role: "rower" | "cox" })[];
  boatConfigurationId: string | null;
  outingTypeCode: string | null;
  captainRowerId: string | null;
  startDateTime: string;
  estimatedEndDateTime?: string | undefined;
  comment: string;
}

export interface IStartSessionRepository {
  saveSession(payload: SaveSessionPayload): Promise<void>;
  getBoat(boatId: string): Promise<StartSessionBoat>;
  getStartedSessions(): Promise<StartedSession[]>;
  getRowersById(rowersId: string[]): Promise<Rower[]>;
  getRoute(routeId: string): Promise<Route>;
  /** Creates the hidden guest record of a name typed at departure. */
  createGuest(name: string): Promise<Rower>;
  /** The member or guest a typed name stands for, without changing anything. */
  findPersonByName(name: string): Promise<Rower | undefined>;
}
