import { v4 } from "uuid";

export const getIncidenId = () => {
  return `incident-${v4()}`;
};
