import { Boat } from "../../../_common/business/boat.rules";
import { Route } from "../../../_common/business/route.rules";
import { Rower } from "../../../_common/business/rower.rules";
import { StartedSession } from "./StartSession.rules";

export interface SaveSessionPayload {
  boat: Boat;
  route: Route | null;
  rowers: Rower[];
  startDateTime: string;
  estimatedEndDateTime?: string | undefined;
  comment: string;
}

export interface IStartSessionRepository {
  saveSession(payload: SaveSessionPayload): Promise<void>;
  getBoat(boatId: string): Promise<Boat>;
  getStartedSessions(): Promise<StartedSession[]>;
  getRowersById(rowersId: string[]): Promise<Rower[]>;
  getRoute(routeId: string): Promise<Route>;
}
