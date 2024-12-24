import { Boat } from "../../_common/types/boat.type";
import { Route } from "../../_common/types/route.type";
import { Rower } from "../../_common/types/rower.type";
import { SimpleResult } from "../../_common/utils/error";
import { StartedSession } from "./StartedSession.business";

export interface IBoathouseRepository {
  saveSession(payload: {
    boat: Boat & { rowersQuantity: number | undefined };
    route: Route;
    rowers: Rower[];
    startDateTime: string;
    estimatedEndDateTime?: string | undefined;
    comment: string;
  }): Promise<SimpleResult<string, null>>;
  getBoat(boatId: string): Promise<SimpleResult<string, Boat>>;
  getStartedSessions(): Promise<SimpleResult<string, StartedSession[]>>;
  getRowersById(rowersId: string[]): Promise<SimpleResult<string, Rower[]>>;
  getRoute(routeId: string): Promise<SimpleResult<string, Route>>;
}
