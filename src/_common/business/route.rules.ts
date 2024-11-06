import { v4 } from "uuid";

export const generateRoutesId = () => {
  return `route-${v4()}`;
};
