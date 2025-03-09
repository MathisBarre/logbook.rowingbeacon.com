import { v4 } from "uuid";

/**
 * ----- Typing -----
 */

export interface Route {
  id: string;
  name: string;
}

/**
 * ----- Business rules -----
 */

export const generateRoutesId = () => {
  return `route-${v4()}`;
};
