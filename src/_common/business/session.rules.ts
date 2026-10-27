import { v4 } from "uuid";

export const generateSessionId = () => {
  return v4();
};
