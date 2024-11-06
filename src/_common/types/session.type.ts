import { Boat } from "./boat.type";
import { Route } from "./route.type";
import { Rower } from "./rower.type";

export interface Session {
  id: string;
  rowers: Rower[];
  route: Route;
  boat: Boat;
  startDateTime: string;
  estimatedEndDateTime: string;
  comment: string | null;
  endDateTime: string | null;
}
