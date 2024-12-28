import { Boat } from "../../_common/types/boat.type";
import { Route } from "../../_common/types/route.type";
import { Rower } from "../../_common/types/rower.type";
import { StartedSession } from "./StartedSession.business";

export interface IBoathouseRepository {
  saveSession(payload: {
    boat: Boat & { rowersQuantity: number | undefined };
    route: Route | null;
    rowers: Rower[];
    startDateTime: string;
    estimatedEndDateTime?: string | undefined;
    comment: string;
  }): Promise<void>;
  getBoat(boatId: string): Promise<Boat>;
  getStartedSessions(): Promise<StartedSession[]>;
  getRowersById(rowersId: string[]): Promise<Rower[]>;
  getRoute(routeId: string): Promise<Route>;
}
