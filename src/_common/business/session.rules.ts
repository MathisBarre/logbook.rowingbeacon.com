import { v4 } from "uuid";

export const generateSessionId = () => {
  return `session-${v4()}`;
};
