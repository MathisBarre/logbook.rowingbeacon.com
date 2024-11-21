import { v4 } from "uuid";

export const generateIncidenId = () => {
  return `incident-${v4()}`;
};
