import { v4 } from "uuid";

export const generateRowerId = () => {
  return `rower-${v4()}`;
};
